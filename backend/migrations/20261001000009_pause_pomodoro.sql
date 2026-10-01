-- Pausar de verdade: a fase fica parada com o tempo que faltava, sem virar "interrompida".
-- Só o Parar (finish_pomodoro) encerra a fase.

alter table demandas_app.pomodoros
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds integer not null default 0 check (paused_seconds >= 0);

comment on column demandas_app.pomodoros.paused_at is 'Quando a fase foi pausada (null = correndo).';
comment on column demandas_app.pomodoros.paused_seconds is 'Segundos já passados em pausas anteriores desta fase.';

-- Encerrar desconta o tempo pausado ao decidir se a fase foi concluída.
create or replace function demandas_app._end_pomodoro(p demandas_app.pomodoros, p_status demandas_app.pomodoro_status)
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  r demandas_app.pomodoros;
begin
  update demandas_app.pomodoros
     set ended_at = now(),
         paused_at = null,
         paused_seconds = paused_seconds
           + coalesce(floor(extract(epoch from now() - paused_at))::integer, 0),
         status = coalesce(p_status,
                    case when now() >= started_at + make_interval(mins => planned_minutes)
                                      + make_interval(secs => paused_seconds
                                          + coalesce(floor(extract(epoch from now() - paused_at)), 0))
                         then 'completed' else 'interrupted' end::demandas_app.pomodoro_status)
   where id = p.id
  returning * into r;
  return r;
end $$;

-- Pausa: fecha o trecho de tempo e congela a fase. A fila do intervalo fica como está.
create or replace function demandas_app.pause_pomodoro()
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  cp demandas_app.pomodoros := demandas_app._running_pomodoro();
begin
  perform demandas_app._close_entry();
  if cp.id is null or cp.paused_at is not null then
    return cp;
  end if;
  update demandas_app.pomodoros set paused_at = now() where id = cp.id
  returning * into cp;
  return cp;
end $$;

-- Retomar: a fase volta a correr de onde parou. A atividade é reaberta com start_activity.
create or replace function demandas_app.resume_pomodoro()
returns demandas_app.pomodoros language plpgsql set search_path = '' as $$
declare
  cp demandas_app.pomodoros := demandas_app._running_pomodoro();
begin
  if cp.id is null or cp.paused_at is null then
    return cp;
  end if;
  update demandas_app.pomodoros
     set paused_seconds = paused_seconds + floor(extract(epoch from now() - paused_at))::integer,
         paused_at = null
   where id = cp.id
  returning * into cp;
  return cp;
end $$;

revoke all on function demandas_app.pause_pomodoro()  from public, anon;
revoke all on function demandas_app.resume_pomodoro() from public, anon;
grant execute on function demandas_app.pause_pomodoro()  to authenticated;
grant execute on function demandas_app.resume_pomodoro() to authenticated;
