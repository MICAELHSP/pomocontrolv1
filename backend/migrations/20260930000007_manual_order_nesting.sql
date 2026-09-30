-- =============================================================================
-- Arrastar e soltar na lista de demandas (design/especificacao-telas.md > Demandas).
-- - sort_order: ordem manual fracionária entre irmãos (mesmo grupo e mesmo pai).
--   Soltar entre A e B grava (A.sort_order + B.sort_order) / 2.
-- - Aninhamento de um nível só: subtarefa não tem subtarefas.
-- - Subtarefa sempre no grupo da mãe; mudar o grupo da mãe leva as filhas.
-- =============================================================================

alter table demandas_app.demands add column sort_order numeric;

-- Ordem inicial: a ordem de criação dentro de cada lista de irmãos.
update demandas_app.demands d
   set sort_order = o.rn * 10
  from (select id, row_number() over (partition by owner_id, group_id, parent_id
                                     order by position, created_at, id) as rn
          from demandas_app.demands) o
 where o.id = d.id;

alter table demandas_app.demands alter column sort_order set not null;
create index demands_manual_order_idx
  on demandas_app.demands (owner_id, group_id, parent_id, sort_order);

-- ---------------------------------------------------------------------------
-- Antes de gravar: grupo da subtarefa = grupo da mãe, um nível só, e
-- sort_order no fim da lista quando não informado (ou quando muda de lista).
-- ---------------------------------------------------------------------------
create or replace function demandas_app.demand_placement_rules()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent demandas_app.demands;
  moved  boolean;
begin
  if new.parent_id is not null then
    select * into parent from demandas_app.demands where id = new.parent_id;
    if parent.parent_id is not null then
      raise exception 'Uma subtarefa não pode ter subtarefas' using errcode = '23514', hint = 'nesting_depth';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from demandas_app.demands where parent_id = new.id) then
      raise exception 'Uma demanda com subtarefas não pode virar subtarefa' using errcode = '23514', hint = 'nesting_depth';
    end if;
    new.group_id := parent.group_id;
  end if;

  -- Mudou de lista (outra mãe, ou outro grupo sendo principal) sem posição nova:
  -- vai para o fim. Subtarefa que só acompanha a mãe de grupo mantém a ordem.
  moved := tg_op = 'UPDATE'
           and new.sort_order is not distinct from old.sort_order
           and (new.parent_id is distinct from old.parent_id
                or (new.parent_id is null and new.group_id is distinct from old.group_id));
  if new.sort_order is null or moved then
    select coalesce(max(sort_order), 0) + 10 into new.sort_order
      from demandas_app.demands
     where owner_id = new.owner_id
       and group_id is not distinct from new.group_id
       and parent_id is not distinct from new.parent_id
       and id <> new.id;
  end if;
  return new;
end $$;

-- Roda antes dos demais triggers de demands (ordem alfabética: "trg_a...").
create trigger trg_a_demands_placement before insert or update of parent_id, group_id, sort_order
  on demandas_app.demands for each row execute function demandas_app.demand_placement_rules();

-- Mudar o grupo de uma demanda principal leva as subtarefas junto.
create or replace function demandas_app.cascade_group_to_subtasks()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.parent_id is null and new.group_id is distinct from old.group_id then
    update demandas_app.demands
       set group_id = new.group_id
     where parent_id = new.id and group_id is distinct from new.group_id;
  end if;
  return null;
end $$;

create trigger trg_demands_cascade_group after update of group_id on demandas_app.demands
  for each row execute function demandas_app.cascade_group_to_subtasks();

-- ---------------------------------------------------------------------------
-- Renumera 10, 20, 30… uma lista de irmãos quando os intervalos ficam pequenos.
-- ---------------------------------------------------------------------------
create or replace function demandas_app.renormalize_demand_order(p_group_id uuid, p_parent_id uuid default null)
returns integer language plpgsql set search_path = '' as $$
declare
  n integer;
begin
  update demandas_app.demands d
     set sort_order = o.rn * 10
    from (select id, row_number() over (order by sort_order, created_at, id) as rn
            from demandas_app.demands
           where owner_id = auth.uid()
             and group_id is not distinct from p_group_id
             and parent_id is not distinct from p_parent_id) o
   where o.id = d.id and d.sort_order <> o.rn * 10;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function demandas_app.renormalize_demand_order(uuid, uuid) from public, anon;
grant execute on function demandas_app.renormalize_demand_order(uuid, uuid) to authenticated;
