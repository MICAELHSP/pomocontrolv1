-- Calendário: jornada, feriados, reuniões e ocupação diária.
\set ON_ERROR_STOP 1
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set search_path = demandas_app, public;
set timezone = 'UTC';

create or replace function pg_temp.check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', what; end if;
  return 'ok: ' || what;
end $$;
create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ESPERAVA ERRO (%): %', needle, sql;
exception when others then
  if sqlerrm like 'ESPERAVA ERRO%' or position(needle in sqlerrm) = 0 then raise; end if;
  raise notice 'ok (erro esperado): %', sqlerrm;
end $$;

-- Feriados: fixos e Sexta-feira Santa
select pg_temp.check((select name from holidays where day = '2026-04-03') = 'Sexta-feira Santa', 'sexta-feira santa 2026');
select pg_temp.check((select name from holidays where day = '2027-03-26') = 'Sexta-feira Santa', 'sexta-feira santa 2027');
select pg_temp.check((select count(*) from holidays where extract(year from day) = 2026) = 10, '10 feriados em 2026');
select pg_temp.expect_error($$insert into holidays values ('2026-06-01', 'x')$$, 'permission denied');

insert into groups (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Trabalho');
insert into demands (id, title, group_id) values ('dddddddd-0000-0000-0000-000000000001', 'Relatório', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Quinta 2026-10-01 (horário de Brasília = UTC-3):
--  09:00–11:00 Relatório (2h), 11:00–11:30 E-mails (30 min)
--  reunião 10:30–12:00: 30 min coincidem com o Relatório e 30 com E-mails; sobram 30 min (11:30–12:00)
--  reunião dia inteiro: ignorada; reunião "free": ignorada
insert into time_entries (demand_id, started_at, ended_at) values
  ('dddddddd-0000-0000-0000-000000000001', '2026-10-01 12:00+00', '2026-10-01 14:00+00');
insert into time_entries (free_activity, started_at, ended_at) values
  ('E-mails', '2026-10-01 14:00+00', '2026-10-01 14:30+00');
insert into calendar_events (external_id, subject, starts_at, ends_at) values
  ('m1', 'Alinhamento', '2026-10-01 13:30+00', '2026-10-01 15:00+00');
insert into calendar_events (external_id, subject, starts_at, ends_at, is_all_day) values
  ('m2', 'Dia todo', '2026-10-01 03:00+00', '2026-10-02 03:00+00', true);
insert into calendar_events (external_id, subject, starts_at, ends_at, show_as) values
  ('m3', 'Livre', '2026-10-01 18:00+00', '2026-10-01 19:00+00', 'free');
-- Sessão que atravessa a meia-noite local (quinta 23:00 → sexta 01:00)
insert into time_entries (free_activity, started_at, ended_at) values
  ('Plantão', '2026-10-02 02:00+00', '2026-10-02 04:00+00');

select * from daily_occupancy('2026-10-01', '2026-10-04');

select pg_temp.check((select tracked_seconds = 3*3600 + 1800 from daily_occupancy('2026-10-01','2026-10-01')), 'quinta: 2h30 + 1h de plantão');
select pg_temp.check((select demand_seconds = 7200 and free_seconds = 5400 from daily_occupancy('2026-10-01','2026-10-01')), 'demandas x livres');
select pg_temp.check((select (seconds_by_group->>'aaaaaaaa-0000-0000-0000-000000000001')::bigint = 7200 from daily_occupancy('2026-10-01','2026-10-01')), 'tempo por grupo');
select pg_temp.check((select meeting_seconds = 1800 and meeting_total_seconds = 5400 from daily_occupancy('2026-10-01','2026-10-01')), 'reunião sem sobreposição');
select pg_temp.check((select workday_minutes = 480 and occupancy_pct = round(100.0 * (12600 + 1800) / 28800, 1) from daily_occupancy('2026-10-01','2026-10-01')), 'jornada 8h e %');
select pg_temp.check((select tracked_seconds = 3600 from daily_occupancy('2026-10-02','2026-10-02')), 'sexta: 1h do plantão');
select pg_temp.check((select not is_workday and workday_minutes = 0 and occupancy_pct is null from daily_occupancy('2026-10-03','2026-10-03')), 'sábado sem jornada');
select pg_temp.check((select holiday_name = 'Nossa Senhora Aparecida' and not is_workday from daily_occupancy('2026-10-12','2026-10-12')), 'feriado fora da jornada');

-- Jornada personalizada: 09–18, 90 min de almoço, seg–sáb
insert into work_settings (work_start, work_end, lunch_minutes, workdays) values ('09:00', '18:00', 90, '{1,2,3,4,5,6}');
select pg_temp.check((select workday_minutes = 450 and is_workday from daily_occupancy('2026-10-03','2026-10-03')), 'sábado com jornada personalizada');

-- Mapa da semana
select pg_temp.check((select count(*) = 3 and bool_or(group_name = 'Trabalho') from time_entry_blocks), 'blocos com grupo');

-- Outro usuário não vê nada
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check((select sum(tracked_seconds) = 0 and sum(meeting_total_seconds) = 0 from daily_occupancy('2026-10-01','2026-10-02')), 'isolado por usuário');

\echo 'TODOS OS TESTES DE CALENDÁRIO PASSARAM'
