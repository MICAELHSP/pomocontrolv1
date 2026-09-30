-- Testes de regras. Roda como "authenticated" com o usuário A; falha no primeiro erro inesperado.
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

insert into groups (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Trabalho');
insert into demand_types (id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Processo');
insert into demands (id, title, group_id, type_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'Entregar relatório', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000002', 'Coletar dados', null, null),
  ('cccccccc-0000-0000-0000-000000000003', 'Revisar texto', null, null);
-- subtarefa
update demands set parent_id = 'cccccccc-0000-0000-0000-000000000001' where id = 'cccccccc-0000-0000-0000-000000000003';
-- dependência: relatório depende de coletar dados
insert into demand_dependencies (demand_id, depends_on_id) values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002');

select pg_temp.expect_error($$insert into demand_dependencies (demand_id, depends_on_id) values ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001')$$, 'circular');
select pg_temp.expect_error($$update demands set parent_id = 'cccccccc-0000-0000-0000-000000000003' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'não pode ter subtarefas'); -- com um nível só, o ciclo mãe-filha cai na regra de profundidade
select pg_temp.expect_error($$update demands set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'depende de Coletar dados');
update demands set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000002';
select pg_temp.expect_error($$update demands set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000001'$$, 'subtarefas abertas: Revisar texto');
update demands set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000003';

-- checklist
insert into checklist_items (demand_id, title, done) values ('cccccccc-0000-0000-0000-000000000001', 'Anexar planilha', true);

-- cronômetro: iniciar em uma põe em andamento; só um rodando por vez
select (start_activity('cccccccc-0000-0000-0000-000000000001')).id is not null as started;
select status = 'in_progress' as auto_in_progress from demands where id = 'cccccccc-0000-0000-0000-000000000001';
select pg_temp.expect_error($$insert into time_entries (free_activity) values ('x')$$, 'time_entries_one_running');
update demands set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000001';
select count(*) = 0 as timer_stopped_on_done from time_entries where ended_at is null;
select completed_at is not null as has_completed_at from demands where id = 'cccccccc-0000-0000-0000-000000000001';

-- nova subtarefa reabre a mãe concluída
insert into demands (title, parent_id) values ('Ajuste pedido pelo cliente', 'cccccccc-0000-0000-0000-000000000001');
select status = 'in_progress' and completed_at is null as parent_reopened from demands where id = 'cccccccc-0000-0000-0000-000000000001';

-- POMODORO (padrão: continuar o foco, pausar no intervalo)
select (start_activity('cccccccc-0000-0000-0000-000000000002')).pomodoro_id is null as fora_do_pomodoro;
select (start_pomodoro('focus', 1::smallint)).kind = 'focus' as foco_iniciado;
select count(*) = 1 as atividade_entrou_no_foco from time_entries
 where ended_at is null and pomodoro_id = (select id from pomodoros where status = 'running');
-- troca no meio do foco: mesmo pomodoro, tempo dividido
select (start_activity(null, 'E-mails')).pomodoro_id = (select id from pomodoros where status = 'running') as troca_mantem_foco;
select count(distinct coalesce(demand_id::text, free_activity)) = 2 as foco_dividido
  from pomodoro_breakdown where status = 'running';
-- intervalo: atividade para e vai para a fila; trocar no intervalo só muda a fila
select (start_pomodoro('short_break', 1::smallint)).queued_free_activity = 'E-mails' as fila_no_intervalo;
select count(*) = 0 as nada_rodando_no_intervalo from time_entries where ended_at is null;
select start_activity('cccccccc-0000-0000-0000-000000000002') is null as troca_no_intervalo_nao_conta;
select queued_demand_id = 'cccccccc-0000-0000-0000-000000000002' as fila_atualizada from pomodoros where status = 'running';
select (select status from pomodoros where kind = 'focus' order by started_at limit 1) = 'interrupted' as foco_curto_interrompido;
-- próximo foco retoma a fila
select (start_pomodoro('focus', 2::smallint)).cycle = 2 as foco_2;
select demand_id = 'cccccccc-0000-0000-0000-000000000002' and pomodoro_id is not null as fila_retomada
  from time_entries where ended_at is null;
-- modo reiniciar: troca fecha o foco como interrompido e abre outro
update pomodoro_settings set on_switch = 'restart';
select (start_activity(null, 'Reunião rápida')).pomodoro_id <> (select id from pomodoros where cycle = 2 and kind = 'focus' order by started_at limit 1) as reiniciou_foco;
select count(*) = 2 as dois_focos_ciclo2 from pomodoros where cycle = 2 and kind = 'focus';
-- encerrar pomodoro mantém a atividade, fora do pomodoro
select (finish_pomodoro('completed')).status = 'completed' as encerrado;
select pomodoro_id is null and free_activity = 'Reunião rápida' as atividade_segue from time_entries where ended_at is null;
select (stop_activity()).id is not null as parou;
select title, total_seconds >= 0 as ok, pomodoros_count, checklist_done, is_blocked from demand_overview order by title;

-- rotinas: todo dia 5 e último dia do mês; semanal seg/qua/sex
insert into routines (id, title, freq, by_monthday, start_date) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Fechamento mensal', 'monthly', '{5,-1}', '2026-01-01');
insert into routine_checklist_items (routine_id, title, position) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Conferir extratos', 1),
  ('eeeeeeee-0000-0000-0000-000000000001', 'Enviar para contabilidade', 2);
insert into routines (id, title, freq, by_weekday, start_date, due_time) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'Atualizar processos', 'weekly', '{1,3,5}', '2026-09-28', '17:00');
insert into routines (id, title, freq, by_monthday, start_date) values
  ('eeeeeeee-0000-0000-0000-000000000003', 'Dia 31', 'monthly', '{31}', '2026-09-01');
insert into routines (id, title, freq, by_monthday, business_days_only, start_date) values
  ('eeeeeeee-0000-0000-0000-000000000004', 'Último dia útil', 'monthly', '{-1}', true, '2026-09-01');
insert into routines (id, title, freq, business_days_only, start_date) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'Dias úteis', 'daily', true, '2026-09-30');
select pg_temp.expect_error($$insert into routines (title, freq, start_date) values ('sem dias', 'weekly', '2026-09-28')$$, 'routines_check');

-- gera da criação até 2026-10-31 (bypass: chamamos a interna como postgres abaixo)
reset role;
update demandas_app.routines set generated_until = null;
select demandas_app._generate_routine_demands('11111111-1111-1111-1111-111111111111', '2026-10-31') as geradas;
select demandas_app._generate_routine_demands('11111111-1111-1111-1111-111111111111', '2026-10-31') as geradas_de_novo_idempotente;
select r.title, string_agg(to_char(d.occurrence_date, 'MM-DD'), ' ' order by d.occurrence_date) as datas
  from demandas_app.demands d join demandas_app.routines r on r.id = d.routine_id
 where d.occurrence_date >= '2026-09-01'
 group by r.title order by r.title;
select due_date || ' ' || due_time as prazo
  from demandas_app.demands where routine_id = 'eeeeeeee-0000-0000-0000-000000000002' order by due_date limit 1;
select count(*) as checklist_copiado from demandas_app.checklist_items c
  join demandas_app.demands d on d.id = c.demand_id where d.routine_id = 'eeeeeeee-0000-0000-0000-000000000001';

-- RPC como usuário
set role authenticated;
select generate_routine_demands('2026-11-10') as rpc_geradas;

-- RLS: usuário B não vê nada e não consegue apontar para dados de A
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select count(*) as b_ve_demandas from demands;
select pg_temp.expect_error($$insert into demands (title, group_id) values ('x', 'aaaaaaaa-0000-0000-0000-000000000001')$$, 'não pertence');
select pg_temp.expect_error($$insert into demands (owner_id, title) values ('11111111-1111-1111-1111-111111111111', 'x')$$, 'row-level security');
update demands set title = 'hack'; -- afeta 0 linhas
reset role;
select count(*) = 0 as nada_alterado from demandas_app.demands where title = 'hack';

-- anon sem acesso
set role anon;
select pg_temp.expect_error($$select * from demandas_app.demands$$, 'permission denied');
reset role;
select 'TODOS OS TESTES PASSARAM' as resultado;
