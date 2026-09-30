-- Captura com IA: grava a proposta revisada (demanda, checklist, subtarefas,
-- dependências e histórico) numa transação só. Origem: thread "Criar tarefas com IA" (ia/README.md).

create or replace function demandas_app.create_demand_from_ai(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = demandas_app, public
as $$
declare
  d        jsonb := p->'demand';
  v_type   uuid  := nullif(d->>'type_id', '')::uuid;
  v_group  uuid  := nullif(d->>'group_id', '')::uuid;
  v_name   text;
  v_main   uuid;
  v_sub    uuid;
  v_prio   smallint := coalesce((d->>'priority')::smallint, 2);
  refs     jsonb := '{}'::jsonb;   -- ref -> uuid
  s        jsonb;
  s_ord    bigint;
  dep      text;
begin
  if d is null or coalesce(trim(d->>'title'), '') = '' then
    raise exception 'A demanda precisa de um título';
  end if;

  -- Tipo: reaproveita pelo nome (sem diferenciar maiúsculas) ou cria
  v_name := nullif(trim(d->>'type_name'), '');
  if v_type is null and v_name is not null then
    select id into v_type from demand_types
     where owner_id = auth.uid() and lower(name) = lower(v_name);
    if v_type is null then
      insert into demand_types (name) values (v_name) returning id into v_type;
    end if;
  end if;

  -- Grupo novo entra na raiz. Caminhos existentes chegam como group_id.
  v_name := nullif(trim(d->>'group_path'), '');
  if v_group is null and v_name is not null then
    select id into v_group from groups
     where owner_id = auth.uid() and parent_id is null and lower(name) = lower(v_name);
    if v_group is null then
      insert into groups (name) values (v_name) returning id into v_group;
    end if;
  end if;

  insert into demands (title, description, group_id, type_id, priority,
                       due_date, due_time, estimated_minutes, external_ref)
  values (trim(d->>'title'), nullif(trim(d->>'description'), ''), v_group, v_type, v_prio,
          (d->>'due_date')::date, (d->>'due_time')::time,
          (d->>'estimated_minutes')::integer, nullif(trim(d->>'external_ref'), ''))
  returning id into v_main;

  insert into checklist_items (demand_id, title, position)
  select v_main, trim(x), (n - 1)::integer
    from jsonb_array_elements_text(coalesce(d->'checklist', '[]')) with ordinality as t(x, n)
   where trim(x) <> '';

  -- Subtarefas herdam grupo, tipo e prioridade da demanda principal
  for s, s_ord in
    select value, ordinality from jsonb_array_elements(coalesce(p->'subtasks', '[]')) with ordinality
  loop
    if coalesce(trim(s->>'title'), '') = '' then
      raise exception 'Subtarefa % sem título', s_ord;
    end if;
    if coalesce(s->>'ref', '') = '' or refs ? (s->>'ref') then
      raise exception 'Subtarefa "%" sem ref ou com ref repetido', s->>'title';
    end if;

    insert into demands (parent_id, title, description, group_id, type_id, priority,
                         due_date, due_time, estimated_minutes, position)
    values (v_main, trim(s->>'title'), nullif(trim(s->>'description'), ''), v_group, v_type,
            coalesce((s->>'priority')::smallint, v_prio),
            (s->>'due_date')::date, (s->>'due_time')::time,
            (s->>'estimated_minutes')::integer, (s_ord - 1)::integer)
    returning id into v_sub;
    refs := refs || jsonb_build_object(s->>'ref', v_sub);

    insert into checklist_items (demand_id, title, position)
    select v_sub, trim(x), (n - 1)::integer
      from jsonb_array_elements_text(coalesce(s->'checklist', '[]')) with ordinality as t(x, n)
     where trim(x) <> '';
  end loop;

  -- Dependências depois de todas as subtarefas existirem (ordem não importa)
  for s in select value from jsonb_array_elements(coalesce(p->'subtasks', '[]')) loop
    for dep in select jsonb_array_elements_text(coalesce(s->'depends_on', '[]')) loop
      if not refs ? dep then
        raise exception 'Subtarefa "%" depende de ref inexistente "%"', s->>'title', dep;
      end if;
      insert into demand_dependencies (demand_id, depends_on_id)
      values ((refs->>(s->>'ref'))::uuid, (refs->>dep)::uuid)
      on conflict do nothing;
    end loop;
  end loop;

  if nullif(trim(p->>'note'), '') is not null then
    insert into demand_updates (demand_id, body) values (v_main, trim(p->>'note'));
  end if;

  return v_main;
end $$;

revoke all on function demandas_app.create_demand_from_ai(jsonb) from public, anon;
grant execute on function demandas_app.create_demand_from_ai(jsonb) to authenticated;
