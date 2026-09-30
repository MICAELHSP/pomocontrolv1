-- =============================================================================
-- Rotinas recorrentes, cronômetro e visões de leitura para o app.
-- =============================================================================

set search_path = demandas_app, public;

-- ---------------------------------------------------------------------------
-- A rotina ocorre na data d?
-- ---------------------------------------------------------------------------
create or replace function demandas_app.month_target_day(d date, m smallint, business_days_only boolean)
returns date language sql immutable set search_path = '' as $$
  with base as (
    select date_trunc('month', d)::date as first_day,
           (date_trunc('month', d) + interval '1 month - 1 day')::date as last_day
  ), t as (
    select first_day,
           case when m = -1 then last_day
                -- "dia 31" em mês de 30 dias cai no último dia do mês
                else least(first_day + (m - 1), last_day) end as target
      from base
  ), shifted as (
    select first_day,
           case when not business_days_only then target
                when extract(isodow from target) = 6 then target - 1
                when extract(isodow from target) = 7 then target - 2
                else target end as target,
           target as original
      from t
  )
  -- se antecipar cair no mês anterior (dia 1 no fim de semana), vai para a segunda seguinte
  select case when target < first_day then original + (8 - extract(isodow from original)::int) else target end
    from shifted
$$;

create or replace function demandas_app.routine_occurs_on(r demandas_app.routines, d date)
returns boolean language sql immutable set search_path = '' as $$
  select d >= r.start_date
     and (r.end_date is null or d <= r.end_date)
     and case r.freq
       when 'daily' then
         (d - r.start_date) % r.interval_n = 0
         and (not r.business_days_only or extract(isodow from d) < 6)
       when 'weekly' then
         extract(isodow from d)::smallint = any(r.by_weekday)
         and ((date_trunc('week', d)::date - date_trunc('week', r.start_date)::date) / 7) % r.interval_n = 0
       when 'monthly' then
         (   (extract(year from d) - extract(year from r.start_date)) * 12
           + (extract(month from d) - extract(month from r.start_date)))::int % r.interval_n = 0
         and exists (
           select 1 from unnest(r.by_monthday) m
            where demandas_app.month_target_day(d, m, r.business_days_only) = d)
       when 'yearly' then
         extract(month from d) = extract(month from r.start_date)
         and extract(day from d)::int = least(extract(day from r.start_date)::int,
                                              extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)
         and (extract(year from d) - extract(year from r.start_date))::int % r.interval_n = 0
     end
$$;

-- ---------------------------------------------------------------------------
-- Gera as demandas das rotinas de um dono até p_until (+ lead_days de cada rotina),
-- copiando o checklist padrão. Idempotente (índice único rotina+data).
-- Função interna: não exposta à API.
-- ---------------------------------------------------------------------------
create or replace function demandas_app._generate_routine_demands(p_owner uuid, p_until date)
returns integer language plpgsql set search_path = '' as $$
declare
  r        demandas_app.routines;
  d        date;
  from_d   date;
  to_d     date;
  new_id   uuid;
  created  integer := 0;
begin
  for r in
    select * from demandas_app.routines
     where owner_id = p_owner and active
     for update
  loop
    -- Primeira geração não cria ocorrências passadas (sem backlog retroativo).
    from_d := greatest(r.start_date, coalesce(r.generated_until + 1, current_date));
    to_d   := least(coalesce(r.end_date, p_until + r.lead_days), p_until + r.lead_days);
    continue when to_d < from_d;

    for d in select g::date from generate_series(from_d, to_d, interval '1 day') g loop
      continue when not demandas_app.routine_occurs_on(r, d);

      insert into demandas_app.demands
        (owner_id, group_id, type_id, routine_id, occurrence_date, title, description,
         priority, estimated_minutes, due_date, due_time)
      values
        (r.owner_id, r.group_id, r.type_id, r.id, d, r.title, r.description,
         r.priority, r.estimated_minutes, d, r.due_time)
      on conflict (routine_id, occurrence_date) where routine_id is not null do nothing
      returning id into new_id;

      if new_id is not null then
        insert into demandas_app.checklist_items (owner_id, demand_id, title, position)
        select r.owner_id, new_id, i.title, i.position
          from demandas_app.routine_checklist_items i
         where i.routine_id = r.id;
        created := created + 1;
      end if;
    end loop;

    update demandas_app.routines set generated_until = to_d where id = r.id;
  end loop;
  return created;
end $$;

revoke all on function demandas_app._generate_routine_demands(uuid, date) from public;

-- RPC chamada pelo app (ex.: ao abrir e uma vez por dia). Gera só para o usuário logado.
create or replace function demandas_app.generate_routine_demands(p_until date default current_date + 7)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  if p_until > current_date + 366 then
    raise exception 'horizonte máximo de 1 ano';
  end if;
  return demandas_app._generate_routine_demands(auth.uid(), p_until);
end $$;

-- Para agendar no pg_cron (roda para todos os donos). Não exposta à API.
create or replace function demandas_app.generate_routine_demands_all(p_until date default current_date + 7)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  o uuid;
  total integer := 0;
begin
  for o in select distinct owner_id from demandas_app.routines where active loop
    total := total + demandas_app._generate_routine_demands(o, p_until);
  end loop;
  return total;
end $$;

revoke all on function demandas_app.generate_routine_demands_all(date) from public;

-- Ao editar a regra de recorrência, recomeça a geração a partir de hoje
-- (não mexe nas ocorrências já criadas).
create or replace function demandas_app.routine_rule_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.freq, new.interval_n, new.by_weekday, new.by_monthday, new.business_days_only, new.start_date, new.end_date, new.lead_days)
     is distinct from
     (old.freq, old.interval_n, old.by_weekday, old.by_monthday, old.business_days_only, old.start_date, old.end_date, old.lead_days) then
    new.generated_until := least(old.generated_until, current_date - 1);
  end if;
  return new;
end $$;

create trigger trg_routines_rule_changed before update on demandas_app.routines
  for each row execute function demandas_app.routine_rule_changed();

-- ---------------------------------------------------------------------------
-- Cronômetro de atividade + pomodoro
--
-- O pomodoro é um ritmo independente. A atividade (demanda ou atividade livre)
-- roda em time_entries; o trecho feito durante um foco guarda pomodoro_id.
--   start_activity(demanda | livre)  troca a atividade (fecha a anterior)
--   stop_activity()                  para a atividade
--   start_pomodoro(tipo, ciclo)      inicia foco/intervalo/pausa longa
--   finish_pomodoro(status)          encerra a fase atual
-- Regras (pomodoro_settings):
--   on_switch = continue: trocar no meio do foco mantém o foco e divide o tempo.
--   on_switch = restart : trocar fecha o foco como interrompido e começa outro.
--   pause_demand_on_break: no intervalo a atividade para e fica na fila; trocar
--     durante o intervalo só muda a fila. O próximo foco retoma a fila.
-- ---------------------------------------------------------------------------
create or replace function demandas_app._settings()
returns demandas_app.pomodoro_settings language plpgsql set search_path = '' as $$
declare
  st demandas_app.pomodoro_settings;
begin
  select * into st from demandas_app.pomodoro_settings where owner_id = auth.uid();
  if not found then
    insert into demandas_app.pomodoro_settings (owner_id) values (auth.uid())
    on conflict (owner_id) do nothing;
    select * into st from demandas_app.pomodoro_settings where owner_id = auth.uid();
  end if;
  return st;
end $$;

create or replace function demandas_app._running_pomodoro()
returns demandas_app.pomodoros language sql stable set search_path = '' as $$
  select * from demandas_app.pomodoros where owner_id = auth.uid() and status = 'running'
$$;

-- Fecha o trecho rodando (se houver) e devolve-o.
create or replace function demandas_app._close_entry()
returns demandas_app.time_entries language plpgsql set search_path = '' as $$
declare
  e demandas_app.time_entries;
begin
  update demandas_app.time_entries set ended_at = now()
   where owner_id = auth.uid() and ended_at is null
  returning * into e;
  return e;
end $$;

create or replace function demandas_app._open_entry(p_demand_id uuid, p_free_activity text, p_pomodoro_id uuid, p_note text)
returns demandas_app.time_entries language plpgsql set search_path = '' as $$
declare
  e demandas_app.time_entries;
begin
  insert into demandas_app.time_entries (demand_id, free_activity, pomodoro_id, note)
  values (p_demand_id, nullif(trim(p_free_activity), ''), p_pomodoro_id, p_note)
  returning * into e;
  if p_demand_id is not null then
    update demandas_app.demands set status = 'in_progress' where id = p_demand_id and status = 'todo';
  end if;
  return e;
end $$;

create or replace function demandas_app._end_pomodoro(p demandas_app.pomodoros, p_status demandas_app.pomodoro_status)
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  r demandas_app.pomodoros;
begin
  update demandas_app.pomodoros
     set ended_at = now(),
         status = coalesce(p_status,
                    case when now() >= started_at + make_interval(mins => planned_minutes)
                         then 'completed' else 'interrupted' end::demandas_app.pomodoro_status)
   where id = p.id
  returning * into r;
  return r;
end $$;

create or replace function demandas_app.start_activity(
  p_demand_id uuid default null, p_free_activity text default null, p_note text default null)
returns demandas_app.time_entries language plpgsql set search_path = '' as $$
declare
  st   demandas_app.pomodoro_settings := demandas_app._settings();
  cp   demandas_app.pomodoros := demandas_app._running_pomodoro();
  prev demandas_app.time_entries;
begin
  if p_demand_id is not null and p_free_activity is not null then
    raise exception 'informe uma demanda OU uma atividade livre';
  end if;

  -- Intervalo com pausa: não conta tempo, só atualiza a fila.
  if cp.id is not null and cp.kind <> 'focus' and st.pause_demand_on_break then
    perform demandas_app._close_entry();
    update demandas_app.pomodoros
       set queued_demand_id = p_demand_id, queued_free_activity = nullif(trim(p_free_activity), '')
     where id = cp.id;
    return null;
  end if;

  prev := demandas_app._close_entry();

  if cp.id is not null and cp.kind = 'focus' and st.on_switch = 'restart'
     and prev.pomodoro_id = cp.id
     and (prev.demand_id, prev.free_activity) is distinct from (p_demand_id, nullif(trim(p_free_activity), '')) then
    perform demandas_app._end_pomodoro(cp, 'interrupted');
    insert into demandas_app.pomodoros (kind, cycle, planned_minutes)
    values ('focus', cp.cycle, st.focus_minutes)
    returning * into cp;
  end if;

  return demandas_app._open_entry(p_demand_id, p_free_activity,
                                  case when cp.kind = 'focus' then cp.id end, p_note);
end $$;

create or replace function demandas_app.stop_activity()
returns demandas_app.time_entries language plpgsql set search_path = '' as $$
begin
  update demandas_app.pomodoros set queued_demand_id = null, queued_free_activity = null
   where owner_id = auth.uid() and status = 'running';
  return demandas_app._close_entry();
end $$;

create or replace function demandas_app.start_pomodoro(
  p_kind demandas_app.pomodoro_kind default 'focus', p_cycle smallint default 1)
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  st   demandas_app.pomodoro_settings := demandas_app._settings();
  prev demandas_app.pomodoros := demandas_app._running_pomodoro();
  cur  demandas_app.pomodoros;
  e    demandas_app.time_entries;
begin
  if prev.id is not null then
    prev := demandas_app._end_pomodoro(prev, null);
  end if;

  insert into demandas_app.pomodoros (kind, cycle, planned_minutes)
  values (p_kind, p_cycle,
          case p_kind when 'focus' then st.focus_minutes
                      when 'short_break' then st.short_break_minutes
                      else st.long_break_minutes end)
  returning * into cur;

  e := demandas_app._close_entry();

  if p_kind = 'focus' then
    if e.id is not null then
      -- atividade que já rodava passa a contar dentro deste foco
      perform demandas_app._open_entry(e.demand_id, e.free_activity, cur.id, e.note);
    elsif prev.kind <> 'focus' and (prev.queued_demand_id is not null or prev.queued_free_activity is not null) then
      perform demandas_app._open_entry(prev.queued_demand_id, prev.queued_free_activity, cur.id, null);
    end if;
  elsif e.id is not null then
    if st.pause_demand_on_break then
      update demandas_app.pomodoros
         set queued_demand_id = e.demand_id, queued_free_activity = e.free_activity
       where id = cur.id
      returning * into cur;
    else
      perform demandas_app._open_entry(e.demand_id, e.free_activity, null, e.note);
    end if;
  end if;
  return cur;
end $$;

-- Encerra a fase atual. A atividade continua rodando, fora do pomodoro.
create or replace function demandas_app.finish_pomodoro(p_status demandas_app.pomodoro_status default null)
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  cp demandas_app.pomodoros := demandas_app._running_pomodoro();
  e  demandas_app.time_entries;
begin
  if cp.id is null then
    return null;
  end if;
  if p_status = 'running' then
    raise exception 'status final deve ser completed ou interrupted';
  end if;
  if cp.kind = 'focus' then
    select * into e from demandas_app.time_entries
     where owner_id = auth.uid() and ended_at is null and pomodoro_id = cp.id;
    if e.id is not null then
      perform demandas_app._close_entry();
      perform demandas_app._open_entry(e.demand_id, e.free_activity, null, e.note);
    end if;
  end if;
  return demandas_app._end_pomodoro(cp, p_status);
end $$;

-- ---------------------------------------------------------------------------
-- Visões (security_invoker: respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------------
create or replace view demandas_app.demand_overview
with (security_invoker = true) as
select
  d.*,
  g.name  as group_name,
  g.color as group_color,
  t.name  as type_name,
  coalesce(te.total_seconds, 0)  as total_seconds,
  coalesce(te.focus_seconds, 0)  as focus_seconds,
  coalesce(te.pomodoros, 0)      as pomodoros_count,
  te.running_since,
  coalesce(ck.total, 0) as checklist_total,
  coalesce(ck.done, 0)  as checklist_done,
  coalesce(dep.open, 0) as open_dependencies,
  coalesce(sub.open, 0) as open_subtasks,
  coalesce(sub.total, 0) as subtasks_total,
  (coalesce(dep.open, 0) + coalesce(sub.open, 0)) > 0 as is_blocked
from demandas_app.demands d
left join demandas_app.groups g       on g.id = d.group_id
left join demandas_app.demand_types t on t.id = d.type_id
left join lateral (
  select
    sum(extract(epoch from (coalesce(ended_at, now()) - started_at)))::bigint as total_seconds,
    sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) filter (where pomodoro_id is not null)::bigint as focus_seconds,
    count(distinct pomodoro_id) as pomodoros,
    max(started_at) filter (where ended_at is null) as running_since
  from demandas_app.time_entries where demand_id = d.id
) te on true
left join lateral (
  select count(*) as total, count(*) filter (where done) as done
  from demandas_app.checklist_items where demand_id = d.id
) ck on true
left join lateral (
  select count(*) as open
  from demandas_app.demand_dependencies dd
  join demandas_app.demands x on x.id = dd.depends_on_id
  where dd.demand_id = d.id and x.status not in ('done', 'canceled')
) dep on true
left join lateral (
  select count(*) as total, count(*) filter (where status not in ('done', 'canceled')) as open
  from demandas_app.demands s where s.parent_id = d.id
) sub on true;

-- Cada pomodoro com as atividades feitas dentro dele ("Este foco" / "Pomodoros de hoje")
create or replace view demandas_app.pomodoro_breakdown
with (security_invoker = true) as
select
  p.id as pomodoro_id, p.owner_id, p.kind, p.cycle, p.status, p.started_at, p.ended_at, p.planned_minutes,
  e.demand_id, dm.title as demand_title, e.free_activity,
  sum(extract(epoch from (coalesce(e.ended_at, now()) - e.started_at)))::bigint as seconds
from demandas_app.pomodoros p
left join demandas_app.time_entries e on e.pomodoro_id = p.id
left join demandas_app.demands dm on dm.id = e.demand_id
group by p.id, e.demand_id, dm.title, e.free_activity;

-- Tempo por dia e atividade (relatórios)
create or replace view demandas_app.daily_time
with (security_invoker = true) as
select
  owner_id,
  (started_at at time zone 'America/Sao_Paulo')::date as day,
  demand_id,
  free_activity,
  sum(extract(epoch from (coalesce(ended_at, now()) - started_at)))::bigint as seconds,
  sum(extract(epoch from (coalesce(ended_at, now()) - started_at))) filter (where pomodoro_id is not null)::bigint as focus_seconds
from demandas_app.time_entries
group by 1, 2, 3, 4;
