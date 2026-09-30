-- Teste da RPC create_demand_from_ai. Roda depois do stub, das migrations e de
-- create_demand_from_ai.sql (ver ia/sql/run.sh). Falha no primeiro erro inesperado.
\set ON_ERROR_STOP 1
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set search_path = demandas_app, public;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ESPERAVA ERRO (%): %', needle, sql;
exception when others then
  if sqlerrm like 'ESPERAVA ERRO%' or position(needle in sqlerrm) = 0 then raise; end if;
  raise notice 'ok (erro esperado): %', sqlerrm;
end $$;

create or replace function pg_temp.check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', what; end if;
  return 'ok: ' || what;
end $$;

insert into demand_types (id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Processo');

-- 1. Proposta completa: tipo existente pelo nome, grupo novo, 3 subtarefas, s3 depende de s1 e s2
select create_demand_from_ai($j${
  "demand": {"title": "Protocolar recurso do processo 123", "description": "Pedido do cliente X",
             "type_name": "processo", "group_path": "Clientes", "priority": 3,
             "due_date": "2026-10-15", "due_time": "17:00", "estimated_minutes": null,
             "external_ref": "0001234-56.2026.8.26.0100", "checklist": ["Conferir prazo", " ", "Avisar cliente"]},
  "subtasks": [
    {"ref": "s1", "title": "Redigir recurso", "description": null, "due_date": null, "due_time": null,
     "estimated_minutes": 120, "checklist": ["Revisar jurisprudência"], "depends_on": []},
    {"ref": "s2", "title": "Colher assinatura", "description": null, "due_date": "2026-10-14", "due_time": null,
     "estimated_minutes": 15, "checklist": [], "depends_on": []},
    {"ref": "s3", "title": "Protocolar no sistema", "description": null, "due_date": null, "due_time": null,
     "estimated_minutes": 20, "checklist": [], "depends_on": ["s1", "s2"]}
  ],
  "note": "Criada com IA a partir de e-mail."
}$j$::jsonb) as main_id \gset

select pg_temp.check((select count(*) from demands where parent_id = :'main_id') = 3, 'tres subtarefas');
select pg_temp.check((select type_id from demands where id = :'main_id') = 'bbbbbbbb-0000-0000-0000-000000000001', 'reaproveitou tipo pelo nome');
select pg_temp.check((select count(*) from demand_types) = 1, 'nao duplicou tipo');
select pg_temp.check((select g.name from demands d join groups g on g.id = d.group_id where d.id = :'main_id') = 'Clientes', 'criou grupo novo');
select pg_temp.check((select count(*) from checklist_items where demand_id = :'main_id') = 2, 'checklist sem item vazio');
select pg_temp.check((select count(*) from demand_dependencies) = 2, 'duas dependencias');
select pg_temp.check((select count(*) from demand_updates where demand_id = :'main_id') = 1, 'historico');
select pg_temp.check((select bool_and(priority = 3 and group_id is not null) from demands where parent_id = :'main_id'), 'subtarefas herdam grupo e prioridade');
select pg_temp.check((select due_time = '17:00' from demands where id = :'main_id'), 'hora do prazo');

-- Regras do banco continuam valendo: s3 não conclui antes de s1 e s2
select pg_temp.expect_error(format($$update demands set status = 'done' where parent_id = %L and title = 'Protocolar no sistema'$$, :'main_id'), 'depende de');

-- 2. Mesmo grupo e tipo novo pelo nome: reaproveita o grupo, cria o tipo uma vez
select create_demand_from_ai('{"demand": {"title": "Outra", "type_name": "Entrega", "group_path": "clientes"}, "subtasks": []}') is not null as ok_simples;
select pg_temp.check((select count(*) from groups) = 1, 'reaproveitou grupo sem diferenciar maiusculas');
select pg_temp.check((select count(*) from demand_types) = 2, 'criou tipo novo');

-- 3. Ciclo na proposta: nada é gravado
select count(*) as antes from demands \gset
select pg_temp.expect_error($$select create_demand_from_ai('{"demand": {"title": "Ciclo"}, "subtasks": [
  {"ref": "a", "title": "A", "depends_on": ["b"]}, {"ref": "b", "title": "B", "depends_on": ["a"]}]}')$$, 'circular');
select pg_temp.check((select count(*) from demands) = :antes, 'ciclo desfaz tudo');

-- 4. Ref inexistente e título vazio
select pg_temp.expect_error($$select create_demand_from_ai('{"demand": {"title": "X"}, "subtasks": [{"ref": "a", "title": "A", "depends_on": ["z"]}]}')$$, 'ref inexistente');
select pg_temp.expect_error($$select create_demand_from_ai('{"demand": {"title": " "}}')$$, 'título');

-- 5. Grupo de outro usuário por id: recusado
reset role;
insert into demandas_app.groups (id, owner_id, name) values ('aaaaaaaa-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Do B');
set role authenticated;
select pg_temp.expect_error($$select create_demand_from_ai('{"demand": {"title": "X", "group_id": "aaaaaaaa-0000-0000-0000-00000000000b"}}')$$, 'não pertence ao usuário');

\echo 'TODOS OS TESTES DA RPC PASSARAM'
