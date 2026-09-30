-- =============================================================================
-- RLS: cada usuário só enxerga e altera as próprias linhas.
-- Acesso somente para "authenticated"; "anon" não tem nada neste schema.
-- =============================================================================

set search_path = demandas_app, public;

do $$
declare
  t text;
begin
  foreach t in array array[
    'groups', 'demand_types', 'routines', 'routine_checklist_items', 'demands',
    'demand_dependencies', 'checklist_items', 'demand_updates',
    'pomodoro_settings', 'pomodoros', 'time_entries'
  ] loop
    execute format('alter table demandas_app.%I enable row level security', t);
    execute format($p$
      create policy owner_all on demandas_app.%I
        for all to authenticated
        using (owner_id = (select auth.uid()))
        with check (owner_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- Permissões
revoke all on schema demandas_app from public, anon;
grant usage on schema demandas_app to authenticated, service_role;

revoke all on all tables in schema demandas_app from public, anon;
grant select, insert, update, delete on all tables in schema demandas_app to authenticated;
grant all on all tables in schema demandas_app to service_role;


revoke all on all functions in schema demandas_app from public, anon, authenticated;
grant execute on function demandas_app.generate_routine_demands(date)       to authenticated;
grant execute on function demandas_app.start_activity(uuid, text, text)    to authenticated;
grant execute on function demandas_app.stop_activity()                     to authenticated;
grant execute on function demandas_app.start_pomodoro(demandas_app.pomodoro_kind, smallint) to authenticated;
grant execute on function demandas_app.finish_pomodoro(demandas_app.pomodoro_status) to authenticated;
grant execute on function demandas_app.routine_occurs_on(demandas_app.routines, date) to authenticated;
grant execute on function demandas_app.month_target_day(date, smallint, boolean) to authenticated;
-- Auxiliares usadas pelas RPCs (rodam como o usuário e só tocam as linhas dele)
grant execute on function demandas_app._settings()          to authenticated;
grant execute on function demandas_app._running_pomodoro()  to authenticated;
grant execute on function demandas_app._close_entry()       to authenticated;
grant execute on function demandas_app._open_entry(uuid, text, uuid, text) to authenticated;
grant execute on function demandas_app._end_pomodoro(demandas_app.pomodoros, demandas_app.pomodoro_status) to authenticated;
-- Funções de trigger rodam no contexto da tabela; não precisam de grant.

alter default privileges in schema demandas_app revoke all on tables    from public, anon;
alter default privileges in schema demandas_app revoke all on functions from public, anon;
