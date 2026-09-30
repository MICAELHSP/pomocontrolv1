-- =============================================================================
-- Calendário e ocupação diária (design/especificacao-telas.md, item 8).
-- - work_settings: jornada por usuário (padrão 08:00–17:00, 60 min de almoço, seg–sex).
-- - holidays: feriados nacionais (compartilhados, só leitura para o app).
-- - calendar_events: reuniões vindas do Outlook, gravadas pelo app.
-- - daily_occupancy(de, até): por dia, tempo por grupo, livres, reuniões sem
--   sobreposição com tempo registrado, jornada e % de ocupação.
-- - time_entry_blocks: sessões de tempo com demanda e grupo, para o mapa da semana.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Jornada de trabalho. workdays: 0=domingo … 6=sábado.
-- ---------------------------------------------------------------------------
create table demandas_app.work_settings (
  owner_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  work_start     time not null default '08:00',
  work_end       time not null default '17:00',
  lunch_minutes  integer not null default 60 check (lunch_minutes between 0 and 600),
  workdays       smallint[] not null default '{1,2,3,4,5}'
                 check (workdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  timezone       text not null default 'America/Sao_Paulo',
  updated_at     timestamptz not null default now(),
  check (work_end > work_start),
  check (extract(epoch from (work_end - work_start)) / 60 > lunch_minutes)
);

create trigger trg_work_settings_touch before update on demandas_app.work_settings
  for each row execute function demandas_app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Feriados nacionais (Brasil). Fixos + Sexta-feira Santa (móvel).
-- ---------------------------------------------------------------------------
create table demandas_app.holidays (
  day   date primary key,
  name  text not null
);

create or replace function demandas_app.easter_sunday(p_year integer)
returns date language plpgsql immutable set search_path = '' as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_year, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

create or replace function demandas_app.seed_national_holidays(p_from_year integer, p_to_year integer)
returns integer language plpgsql set search_path = '' as $$
declare
  y int;
  n int := 0;
  c int;
begin
  for y in p_from_year .. p_to_year loop
    insert into demandas_app.holidays (day, name) values
      (make_date(y, 1, 1),   'Confraternização Universal'),
      (demandas_app.easter_sunday(y) - 2, 'Sexta-feira Santa'),
      (make_date(y, 4, 21),  'Tiradentes'),
      (make_date(y, 5, 1),   'Dia do Trabalho'),
      (make_date(y, 9, 7),   'Independência do Brasil'),
      (make_date(y, 10, 12), 'Nossa Senhora Aparecida'),
      (make_date(y, 11, 2),  'Finados'),
      (make_date(y, 11, 15), 'Proclamação da República'),
      (make_date(y, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra'),
      (make_date(y, 12, 25), 'Natal')
    on conflict (day) do nothing;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return n;
end $$;

select demandas_app.seed_national_holidays(2025, 2035);

-- ---------------------------------------------------------------------------
-- Reuniões do calendário externo (Outlook). O app faz upsert por external_id.
-- ---------------------------------------------------------------------------
create table demandas_app.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source       text not null default 'outlook' check (source in ('outlook')),
  external_id  text not null,
  subject      text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  is_all_day   boolean not null default false,
  show_as      text,   -- free | tentative | busy | oof | workingElsewhere (Microsoft Graph)
  location     text,
  web_link     text,
  synced_at    timestamptz not null default now(),
  check (ends_at >= starts_at),
  unique (owner_id, source, external_id)
);
create index on demandas_app.calendar_events (owner_id, starts_at);

-- ---------------------------------------------------------------------------
-- Sessões de tempo com demanda e grupo (mapa da semana e relatório do dia).
-- ---------------------------------------------------------------------------
create or replace view demandas_app.time_entry_blocks
with (security_invoker = true) as
select
  e.id, e.owner_id, e.started_at, e.ended_at,
  extract(epoch from (coalesce(e.ended_at, now()) - e.started_at))::bigint as seconds,
  e.ended_at is null as running,
  e.demand_id, d.title as demand_title, d.parent_id as demand_parent_id,
  d.group_id, g.name as group_name, g.color as group_color,
  e.free_activity, e.pomodoro_id, e.note
from demandas_app.time_entries e
left join demandas_app.demands d on d.id = e.demand_id
left join demandas_app.groups  g on g.id = d.group_id;

-- ---------------------------------------------------------------------------
-- Ocupação por dia no intervalo [p_from, p_to], no fuso da jornada do usuário.
-- ocupação = (tempo registrado + reuniões fora do tempo registrado) / jornada
-- ---------------------------------------------------------------------------
create or replace function demandas_app._multirange_seconds(m tstzmultirange)
returns bigint language sql immutable set search_path = '' as $$
  select sum(extract(epoch from (upper(r) - lower(r))))::bigint from unnest(m) r
$$;

create or replace function demandas_app.daily_occupancy(p_from date, p_to date)
returns table (
  day                   date,
  is_workday            boolean,
  holiday_name          text,
  workday_minutes       integer,
  tracked_seconds       bigint,   -- todo tempo registrado (demandas + livres)
  demand_seconds        bigint,
  free_seconds          bigint,   -- atividades livres (e sessões sem demanda)
  seconds_by_group      jsonb,    -- {"<group_id>": s, "none": s}
  meeting_seconds       bigint,   -- reuniões que não coincidem com tempo registrado
  meeting_total_seconds bigint,   -- duração total das reuniões do dia
  occupancy_pct         numeric   -- null quando o dia não tem jornada
)
language sql stable set search_path = '' as $$
  with ws as (
    select coalesce(w.work_start, '08:00'::time)   as work_start,
           coalesce(w.work_end, '17:00'::time)     as work_end,
           coalesce(w.lunch_minutes, 60)           as lunch_minutes,
           coalesce(w.workdays, '{1,2,3,4,5}')     as workdays,
           coalesce(w.timezone, 'America/Sao_Paulo') as tz
      from (select 1) one
      left join demandas_app.work_settings w on w.owner_id = auth.uid()
  ),
  days as (
    select g::date as day,
           (g::date)::timestamp at time zone ws.tz       as day_start,
           (g::date + 1)::timestamp at time zone ws.tz   as day_end,
           ws.*
      from ws, generate_series(p_from, p_to, interval '1 day') g
     where p_to - p_from <= 400
  ),
  entries as (
    select dd.day,
           e.demand_id, dm.group_id, e.free_activity,
           tstzrange(greatest(e.started_at, dd.day_start),
                     least(coalesce(e.ended_at, now()), dd.day_end)) as r
      from days dd
      join demandas_app.time_entries e
        on e.started_at < dd.day_end and coalesce(e.ended_at, now()) > dd.day_start
      left join demandas_app.demands dm on dm.id = e.demand_id
     where e.owner_id = auth.uid()
  ),
  per_group as (
    select day, coalesce(group_id::text, 'none') as k,
           sum(extract(epoch from (upper(r) - lower(r))))::bigint as s
      from entries where demand_id is not null
     group by 1, 2
  ),
  meetings as (
    select dd.day,
           tstzrange(greatest(c.starts_at, dd.day_start), least(c.ends_at, dd.day_end)) as r
      from days dd
      join demandas_app.calendar_events c
        on c.starts_at < dd.day_end and c.ends_at > dd.day_start
     where c.owner_id = auth.uid()
       and not c.is_all_day
       and coalesce(c.show_as, 'busy') <> 'free'
  ),
  agg as (
    select dd.day,
           (select range_agg(r) from entries  x where x.day = dd.day) as entry_mr,
           (select range_agg(r) from meetings m where m.day = dd.day) as meet_mr
      from days dd
  )
  select
    dd.day,
    (h.day is null and extract(dow from dd.day)::smallint = any(dd.workdays)) as is_workday,
    h.name as holiday_name,
    case when h.day is null and extract(dow from dd.day)::smallint = any(dd.workdays)
         then (extract(epoch from (dd.work_end - dd.work_start)) / 60)::integer - dd.lunch_minutes
         else 0 end as workday_minutes,
    coalesce(t.tracked, 0) as tracked_seconds,
    coalesce(t.demand, 0)  as demand_seconds,
    coalesce(t.free, 0)    as free_seconds,
    coalesce((select jsonb_object_agg(pg.k, pg.s) from per_group pg where pg.day = dd.day), '{}'::jsonb) as seconds_by_group,
    coalesce(demandas_app._multirange_seconds(
      case when a.entry_mr is null then a.meet_mr else a.meet_mr - a.entry_mr end), 0) as meeting_seconds,
    coalesce(demandas_app._multirange_seconds(a.meet_mr), 0) as meeting_total_seconds,
    case when h.day is null and extract(dow from dd.day)::smallint = any(dd.workdays)
         then round(100.0 * (coalesce(t.tracked, 0)
                             + coalesce(demandas_app._multirange_seconds(
                                 case when a.entry_mr is null then a.meet_mr else a.meet_mr - a.entry_mr end), 0))
                    / (60.0 * ((extract(epoch from (dd.work_end - dd.work_start)) / 60) - dd.lunch_minutes)), 1)
    end as occupancy_pct
  from days dd
  left join demandas_app.holidays h on h.day = dd.day
  left join agg a on a.day = dd.day
  left join lateral (
    select sum(extract(epoch from (upper(r) - lower(r))))::bigint as tracked,
           sum(extract(epoch from (upper(r) - lower(r)))) filter (where demand_id is not null)::bigint as demand,
           sum(extract(epoch from (upper(r) - lower(r)))) filter (where demand_id is null)::bigint as free
      from entries x where x.day = dd.day
  ) t on true
  order by dd.day
$$;

-- ---------------------------------------------------------------------------
-- RLS e permissões
-- ---------------------------------------------------------------------------
alter table demandas_app.work_settings   enable row level security;
alter table demandas_app.calendar_events enable row level security;
alter table demandas_app.holidays        enable row level security;

create policy owner_all on demandas_app.work_settings for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy owner_all on demandas_app.calendar_events for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy read_all on demandas_app.holidays for select to authenticated using (true);

revoke all on demandas_app.work_settings, demandas_app.calendar_events, demandas_app.holidays from public, anon;
grant select, insert, update, delete on demandas_app.work_settings, demandas_app.calendar_events to authenticated;
grant select on demandas_app.holidays to authenticated;
revoke insert, update, delete, truncate on demandas_app.holidays from authenticated;
grant all on demandas_app.work_settings, demandas_app.calendar_events, demandas_app.holidays to service_role;
revoke all on demandas_app.time_entry_blocks from public, anon;
grant select on demandas_app.time_entry_blocks to authenticated;

revoke all on function demandas_app.daily_occupancy(date, date)              from public, anon;
revoke all on function demandas_app._multirange_seconds(tstzmultirange)      from public, anon;
revoke all on function demandas_app.easter_sunday(integer)                   from public, anon;
revoke all on function demandas_app.seed_national_holidays(integer, integer) from public, anon, authenticated;
grant execute on function demandas_app.daily_occupancy(date, date)         to authenticated;
grant execute on function demandas_app._multirange_seconds(tstzmultirange) to authenticated;
grant execute on function demandas_app.easter_sunday(integer)              to authenticated;
