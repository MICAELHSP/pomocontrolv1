-- =============================================================================
-- Regras de negócio: dono consistente, bloqueio por dependência/subtarefa,
-- ciclos, cronômetro e checklist.
-- =============================================================================

set search_path = demandas_app, public;

-- ---------------------------------------------------------------------------
-- Garante que as FKs apontam para linhas do MESMO dono (FKs ignoram RLS).
-- Uso: enforce_same_owner('coluna:tabela', ...)
-- ---------------------------------------------------------------------------
create or replace function demandas_app.enforce_same_owner()
returns trigger language plpgsql set search_path = '' as $$
declare
  spec   text;
  col    text;
  tbl    text;
  ref_id uuid;
  ok     boolean;
begin
  foreach spec in array TG_ARGV loop
    col := split_part(spec, ':', 1);
    tbl := split_part(spec, ':', 2);
    execute format('select ($1).%I', col) using new into ref_id;
    if ref_id is not null then
      execute format('select exists(select 1 from demandas_app.%I where id = $1 and owner_id = $2)', tbl)
        using ref_id, new.owner_id into ok;
      if not ok then
        raise exception '% (%) não pertence ao usuário', col, ref_id using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end $$;

create trigger trg_groups_owner    before insert or update on demandas_app.groups
  for each row execute function demandas_app.enforce_same_owner('parent_id:groups');
create trigger trg_routines_owner  before insert or update on demandas_app.routines
  for each row execute function demandas_app.enforce_same_owner('group_id:groups', 'type_id:demand_types');
create trigger trg_rci_owner       before insert or update on demandas_app.routine_checklist_items
  for each row execute function demandas_app.enforce_same_owner('routine_id:routines');
create trigger trg_demands_owner   before insert or update on demandas_app.demands
  for each row execute function demandas_app.enforce_same_owner('parent_id:demands', 'group_id:groups', 'type_id:demand_types', 'routine_id:routines');
create trigger trg_deps_owner      before insert or update on demandas_app.demand_dependencies
  for each row execute function demandas_app.enforce_same_owner('demand_id:demands', 'depends_on_id:demands');
create trigger trg_checklist_owner before insert or update on demandas_app.checklist_items
  for each row execute function demandas_app.enforce_same_owner('demand_id:demands');
create trigger trg_updates_owner   before insert or update on demandas_app.demand_updates
  for each row execute function demandas_app.enforce_same_owner('demand_id:demands');
create trigger trg_pomo_owner      before insert or update on demandas_app.pomodoros
  for each row execute function demandas_app.enforce_same_owner('queued_demand_id:demands');
create trigger trg_time_owner      before insert or update on demandas_app.time_entries
  for each row execute function demandas_app.enforce_same_owner('demand_id:demands', 'pomodoro_id:pomodoros');

-- ---------------------------------------------------------------------------
-- Ciclos: grupos e subtarefas (parent_id) e dependências
-- ---------------------------------------------------------------------------
create or replace function demandas_app.prevent_parent_cycle()
returns trigger language plpgsql set search_path = '' as $$
declare
  found boolean;
begin
  if new.parent_id is null then
    return new;
  end if;
  execute format($q$
    with recursive up as (
      select id, parent_id from demandas_app.%1$I where id = $1
      union all
      select t.id, t.parent_id from demandas_app.%1$I t join up on t.id = up.parent_id
    )
    select exists(select 1 from up where id = $2)$q$, TG_TABLE_NAME)
    using new.parent_id, new.id into found;
  if found then
    raise exception 'Hierarquia circular em %', TG_TABLE_NAME using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_groups_cycle  before insert or update of parent_id on demandas_app.groups
  for each row execute function demandas_app.prevent_parent_cycle();
create trigger trg_demands_cycle before insert or update of parent_id on demandas_app.demands
  for each row execute function demandas_app.prevent_parent_cycle();

create or replace function demandas_app.prevent_dependency_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive chain as (
      select depends_on_id as id from demandas_app.demand_dependencies where demand_id = new.depends_on_id
      union
      select d.depends_on_id from demandas_app.demand_dependencies d join chain c on d.demand_id = c.id
    )
    select 1 from chain where id = new.demand_id
  ) or new.depends_on_id = new.demand_id then
    raise exception 'Dependência circular entre demandas' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_deps_cycle before insert or update on demandas_app.demand_dependencies
  for each row execute function demandas_app.prevent_dependency_cycle();

-- ---------------------------------------------------------------------------
-- Conclusão: só conclui se todas as dependências e subtarefas estiverem
-- concluídas (ou canceladas). Mantém completed_at coerente.
-- ---------------------------------------------------------------------------
create or replace function demandas_app.demand_status_rules()
returns trigger language plpgsql set search_path = '' as $$
declare
  pending text;
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    select string_agg(d.title, ', ') into pending
      from demandas_app.demand_dependencies dd
      join demandas_app.demands d on d.id = dd.depends_on_id
     where dd.demand_id = new.id and d.status not in ('done', 'canceled');
    if pending is not null then
      raise exception 'Não é possível concluir: depende de %', pending using errcode = 'P0001', hint = 'blocked_by_dependency';
    end if;

    select string_agg(s.title, ', ') into pending
      from demandas_app.demands s
     where s.parent_id = new.id and s.status not in ('done', 'canceled');
    if pending is not null then
      raise exception 'Não é possível concluir: subtarefas abertas: %', pending using errcode = 'P0001', hint = 'blocked_by_subtask';
    end if;

    new.completed_at := coalesce(new.completed_at, now());
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger trg_demands_status before insert or update of status on demandas_app.demands
  for each row execute function demandas_app.demand_status_rules();

-- Ao concluir/cancelar, para cronômetros abertos dessa demanda.
create or replace function demandas_app.stop_timers_on_close()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('done', 'canceled') and old.status not in ('done', 'canceled') then
    update demandas_app.time_entries
       set ended_at = now()
     where demand_id = new.id and ended_at is null;
  end if;
  return null;
end $$;

create trigger trg_demands_stop_timers after update of status on demandas_app.demands
  for each row execute function demandas_app.stop_timers_on_close();

-- Nova subtarefa aberta em uma demanda concluída reabre a mãe.
create or replace function demandas_app.reopen_parent_on_new_subtask()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is not null and new.status not in ('done', 'canceled') then
    update demandas_app.demands
       set status = 'in_progress'
     where id = new.parent_id and status = 'done';
  end if;
  return null;
end $$;

create trigger trg_demands_reopen_parent after insert or update of parent_id, status on demandas_app.demands
  for each row execute function demandas_app.reopen_parent_on_new_subtask();

-- Checklist: done_at automático
create or replace function demandas_app.checklist_done_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end $$;

create trigger trg_checklist_done_at before insert or update of done on demandas_app.checklist_items
  for each row execute function demandas_app.checklist_done_at();
