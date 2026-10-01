-- Teste de ponta a ponta no Supabase REAL, sem deixar rastro.
-- Cole no SQL Editor do projeto e rode. Cria dois usuários de teste, faz o fluxo do app
-- como "authenticated" (demandas, dependência, cronômetro + pomodoro, rotina, IA, RLS)
-- e termina com um erro proposital "E2E_RESULT (rollback): ..." que desfaz tudo.
-- Resultado esperado: todos os itens "=true"/"=ok", foco_dividido=2, retomou=1, rls_outro_usuario_ve=0.
-- Não é pego pelo run.sh (que só roda tests/[1-9]*_test.sql num Postgres local).
do $t$
declare
  u  uuid := '0e2e0e2e-0000-4000-8000-000000000001';
  u2 uuid := '0e2e0e2e-0000-4000-8000-000000000002';
  r  text := '';
  a uuid; b uuid; p1 uuid; e record; n int; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (u,  'authenticated', 'authenticated', 'e2e-a@teste.invalid'),
    (u2, 'authenticated', 'authenticated', 'e2e-b@teste.invalid');
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || 'uid=' || (auth.uid() = u) || '; ';

  insert into demandas_app.demands (title) values ('E2E relatório') returning id into a;
  insert into demandas_app.demands (title) values ('E2E dados') returning id into b;
  insert into demandas_app.demand_dependencies (demand_id, depends_on_id) values (a, b);
  begin
    update demandas_app.demands set status = 'done' where id = a;
    r := r || 'dep_bloqueia=FALHOU; ';
  exception when others then r := r || 'dep_bloqueia=ok; ';
  end;
  insert into demandas_app.checklist_items (demand_id, title) values (a, 'item');

  -- troca de atividade no meio do foco mantém o mesmo pomodoro
  perform demandas_app.start_activity(a);
  p1 := (demandas_app.start_pomodoro('focus', 1::smallint)).id;
  e := demandas_app.start_activity(b);
  r := r || 'troca_mesmo_foco=' || (e.pomodoro_id = p1) || '; ';
  select count(distinct coalesce(demand_id::text, free_activity)) into n from demandas_app.time_entries where pomodoro_id = p1;
  r := r || 'foco_dividido=' || n || '; ';
  ok := (demandas_app.start_pomodoro('short_break', 1::smallint)).queued_demand_id = b;
  r := r || 'fila_intervalo=' || ok || '; ';
  perform demandas_app.start_pomodoro('focus', 2::smallint);
  select count(*) into n from demandas_app.time_entries where ended_at is null and demand_id = b and pomodoro_id is not null;
  r := r || 'retomou=' || n || '; ';
  perform demandas_app.stop_activity();
  perform demandas_app.finish_pomodoro(null);
  select count(*) into n from demandas_app.demand_overview;
  r := r || 'overview=' || n || '; ';

  begin
    insert into demandas_app.routines (title, freq, by_monthday, business_days_only, start_date)
      values ('E2E fechamento', 'monthly', '{-1}', true, current_date);
    n := demandas_app.generate_routine_demands(current_date + 60);
    r := r || 'rotina_geradas=' || n || '; ';
  exception when others then r := r || 'rotina_ERRO=' || sqlerrm || '; ';
  end;

  begin
    a := demandas_app.create_demand_from_ai('{"demand":{"title":"E2E IA"},"checklist":[{"title":"passo 1"}]}'::jsonb);
    r := r || 'ia=' || (a is not null) || '; ';
  exception when others then r := r || 'ia_ERRO=' || sqlerrm || '; ';
  end;

  -- outro usuário não enxerga nada do primeiro
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from demandas_app.demands;
  r := r || 'rls_outro_usuario_ve=' || n || '; ';

  raise exception 'E2E_RESULT (rollback): %', r;
end $t$;
