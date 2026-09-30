-- Ordem manual (arrastar e soltar) e aninhamento de um nível.
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

insert into groups (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Trabalho'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Pessoal');
insert into demands (id, title, group_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'A', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000002', 'B', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000003', 'C', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands) = 'ABC', 'ordem de criação');

-- Soltar C entre A e B: ponto médio
update demands set sort_order = ((select sort_order from demands where title = 'A') + (select sort_order from demands where title = 'B')) / 2
 where title = 'C';
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands) = 'ACB', 'ponto médio reordena');

-- Subtarefas: entram no grupo da mãe e no fim da lista delas
insert into demands (id, title, parent_id, group_id) values
  ('dddddddd-0000-0000-0000-000000000011', 'A1', 'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('dddddddd-0000-0000-0000-000000000012', 'A2', 'dddddddd-0000-0000-0000-000000000001', null);
select pg_temp.check((select bool_and(group_id = 'aaaaaaaa-0000-0000-0000-000000000001') from demands where parent_id is not null), 'subtarefa herda grupo da mãe');
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands where parent_id is not null) = 'A1A2', 'ordem das subtarefas');

-- Um nível só
select pg_temp.expect_error($$insert into demands (title, parent_id) values ('neta', 'dddddddd-0000-0000-0000-000000000011')$$, 'não pode ter subtarefas');
select pg_temp.expect_error($$update demands set parent_id = 'dddddddd-0000-0000-0000-000000000002' where title = 'A'$$, 'não pode virar subtarefa');
select pg_temp.expect_error($$update demands set parent_id = id where title = 'B'$$, 'circular');

-- Mudar a mãe de grupo leva as filhas, mantendo a ordem delas
update demands set group_id = 'aaaaaaaa-0000-0000-0000-000000000002' where title = 'A';
select pg_temp.check((select bool_and(group_id = 'aaaaaaaa-0000-0000-0000-000000000002') from demands where parent_id = 'dddddddd-0000-0000-0000-000000000001'), 'filhas acompanham o grupo');
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands where parent_id is not null) = 'A1A2', 'filhas mantêm a ordem');

-- Arrastar B para dentro de A (uma update só): vira subtarefa no fim
update demands set parent_id = 'dddddddd-0000-0000-0000-000000000001', group_id = 'aaaaaaaa-0000-0000-0000-000000000001' where title = 'B';
select pg_temp.check((select group_id = 'aaaaaaaa-0000-0000-0000-000000000002' from demands where title = 'B'), 'grupo segue a mãe mesmo se o app mandar outro');
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands where parent_id is not null) = 'A1A2B', 'entra no fim da lista');

-- Tirar A2 de dentro: volta a ser principal no fim do grupo informado
update demands set parent_id = null, group_id = 'aaaaaaaa-0000-0000-0000-000000000001' where title = 'A2';
select pg_temp.check((select string_agg(title, '' order by sort_order) from demands where parent_id is null and group_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'CA2', 'sai de dentro para o fim do grupo');

-- Aninhar demanda aberta dentro de uma concluída reabre a mãe
update demands set status = 'done' where title = 'C';
update demands set parent_id = 'dddddddd-0000-0000-0000-000000000003' where title = 'A2';
select pg_temp.check((select status <> 'done' and completed_at is null from demands where title = 'C'), 'mãe concluída reabre');

-- Renumerar
update demands set sort_order = 10.0001 where title = 'A1';
select renormalize_demand_order('aaaaaaaa-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001') >= 0 as renumerado;
select pg_temp.check((select array_agg(sort_order order by sort_order) from demands where parent_id = 'dddddddd-0000-0000-0000-000000000001') = '{10,20}', 'renumera 10, 20');

\echo 'TODOS OS TESTES DE ORDEM PASSARAM'
