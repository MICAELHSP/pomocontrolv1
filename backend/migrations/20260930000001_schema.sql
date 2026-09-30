-- =============================================================================
-- App de demandas: schema isolado "demandas_app"
-- Tudo fica neste schema para não misturar com o que já existe no Supabase da CG.
-- Cada linha pertence a um usuário (owner_id = auth.users.id); ver RLS em 0002.
-- =============================================================================

create schema if not exists demandas_app;

set search_path = demandas_app, public;

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------
create type demandas_app.demand_status as enum (
  'todo',         -- a fazer
  'in_progress',  -- em andamento
  'waiting',      -- aguardando terceiros
  'done',         -- concluída
  'canceled'      -- cancelada
);

create type demandas_app.recurrence_freq as enum ('daily', 'weekly', 'monthly', 'yearly');

create type demandas_app.pomodoro_kind as enum ('focus', 'short_break', 'long_break');
create type demandas_app.pomodoro_status as enum ('running', 'completed', 'interrupted');
create type demandas_app.pomodoro_switch_mode as enum (
  'continue',  -- trocar de atividade mantém o foco atual e divide o tempo dele
  'restart'    -- trocar fecha o foco como interrompido e começa outro
);

-- ---------------------------------------------------------------------------
-- Função utilitária: updated_at automático
-- ---------------------------------------------------------------------------
create or replace function demandas_app.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Grupos (ex.: "Cliente X", "Pessoal", "Financeiro"). Podem ser aninhados.
-- ---------------------------------------------------------------------------
create table demandas_app.groups (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id   uuid references demandas_app.groups(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text,
  icon        text,
  position    integer not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique nulls not distinct (owner_id, parent_id, name)
);
create index on demandas_app.groups (owner_id);

-- ---------------------------------------------------------------------------
-- Tipos de demanda (ex.: "Processo", "Reunião", "Entrega", "Rotina")
-- ---------------------------------------------------------------------------
create table demandas_app.demand_types (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text,
  icon        text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, name)
);

-- ---------------------------------------------------------------------------
-- Rotinas (modelos recorrentes). Geram demandas via generate_routine_demands().
--   daily   + interval_n            -> a cada N dias
--   weekly  + by_weekday {1..7}     -> dias da semana (ISO: 1=seg ... 7=dom), a cada N semanas
--   monthly + by_monthday {1..31,-1}-> "todo dia X" (-1 = último dia do mês), a cada N meses
--   yearly                          -> mesmo dia/mês de start_date, a cada N anos
-- ---------------------------------------------------------------------------
create table demandas_app.routines (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null check (length(trim(title)) > 0),
  description        text,
  group_id           uuid references demandas_app.groups(id) on delete set null,
  type_id            uuid references demandas_app.demand_types(id) on delete set null,
  priority           smallint not null default 2 check (priority between 0 and 4),
  estimated_minutes  integer check (estimated_minutes > 0),
  freq               demandas_app.recurrence_freq not null,
  interval_n         integer not null default 1 check (interval_n >= 1),
  by_weekday         smallint[] check (by_weekday <@ array[1,2,3,4,5,6,7]::smallint[]),
  -- -1 = último dia do mês; dia 31 em mês curto cai no último dia
  by_monthday        smallint[] check (by_monthday <@ array[-1,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]),
  -- daily: só dias úteis (seg a sex). monthly: se cair em sábado/domingo,
  -- antecipa para a sexta anterior (ex.: "último dia útil" = {-1} + true).
  business_days_only boolean not null default false,
  start_date         date not null default current_date,
  end_date           date,
  due_time           time,            -- hora do prazo no dia da ocorrência (opcional)
  timezone           text not null default 'America/Sao_Paulo',
  lead_days          integer not null default 0 check (lead_days >= 0), -- criar a demanda N dias antes
  active             boolean not null default true,
  generated_until    date,            -- última data já gerada
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (freq <> 'weekly'  or coalesce(array_length(by_weekday, 1), 0) > 0),
  check (freq <> 'monthly' or coalesce(array_length(by_monthday, 1), 0) > 0)
);
create index on demandas_app.routines (owner_id) where active;

-- Checklist padrão da rotina (copiado para cada demanda gerada)
create table demandas_app.routine_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  routine_id  uuid not null references demandas_app.routines(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index on demandas_app.routine_checklist_items (routine_id, position);

-- ---------------------------------------------------------------------------
-- Demandas. parent_id = subtarefa (a mãe só conclui quando as filhas concluírem).
-- ---------------------------------------------------------------------------
create table demandas_app.demands (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id          uuid references demandas_app.demands(id) on delete cascade,
  group_id           uuid references demandas_app.groups(id) on delete set null,
  type_id            uuid references demandas_app.demand_types(id) on delete set null,
  routine_id         uuid references demandas_app.routines(id) on delete set null,
  occurrence_date    date,            -- data da ocorrência, quando gerada por rotina
  title              text not null check (length(trim(title)) > 0),
  description        text,
  status             demandas_app.demand_status not null default 'todo',
  priority           smallint not null default 2 check (priority between 0 and 4), -- 0 baixa .. 4 urgente
  planned_start      timestamptz,
  due_date           date,            -- prazo (dia)
  due_time           time,            -- hora do prazo, opcional; usada para conflito com reuniões
  estimated_minutes  integer check (estimated_minutes > 0),
  completed_at       timestamptz,
  position           integer not null default 0,
  external_ref       text,            -- nº do processo, link, ticket etc.
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (parent_id is null or parent_id <> id),
  check (routine_id is null or occurrence_date is not null),
  check (due_time is null or due_date is not null)
);
create index on demandas_app.demands (owner_id, status);
create index on demandas_app.demands (owner_id, due_date) where status not in ('done', 'canceled');
create index on demandas_app.demands (parent_id);
create index on demandas_app.demands (group_id);
create index on demandas_app.demands (type_id);
-- Uma ocorrência por rotina por dia (torna a geração idempotente)
create unique index demands_routine_occurrence_uq
  on demandas_app.demands (routine_id, occurrence_date) where routine_id is not null;

-- ---------------------------------------------------------------------------
-- Dependências: demand_id só pode ser concluída depois de depends_on_id.
-- ---------------------------------------------------------------------------
create table demandas_app.demand_dependencies (
  demand_id      uuid not null references demandas_app.demands(id) on delete cascade,
  depends_on_id  uuid not null references demandas_app.demands(id) on delete cascade,
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (demand_id, depends_on_id),
  check (demand_id <> depends_on_id)
);
create index on demandas_app.demand_dependencies (depends_on_id);

-- ---------------------------------------------------------------------------
-- Checklist da demanda
-- ---------------------------------------------------------------------------
create table demandas_app.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demand_id   uuid not null references demandas_app.demands(id) on delete cascade,
  title       text not null check (length(trim(title)) > 0),
  done        boolean not null default false,
  done_at     timestamptz,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on demandas_app.checklist_items (demand_id, position);

-- ---------------------------------------------------------------------------
-- Atualizações / andamento da demanda (histórico de "atualização de processos")
-- ---------------------------------------------------------------------------
create table demandas_app.demand_updates (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demand_id   uuid not null references demandas_app.demands(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);
create index on demandas_app.demand_updates (demand_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Pomodoro: configuração por usuário
-- ---------------------------------------------------------------------------
create table demandas_app.pomodoro_settings (
  owner_id               uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled                boolean not null default true,  -- "usar pomodoro"
  focus_minutes          integer not null default 25 check (focus_minutes between 1 and 240),
  short_break_minutes    integer not null default 5  check (short_break_minutes between 1 and 120),
  long_break_minutes     integer not null default 15 check (long_break_minutes between 1 and 240),
  cycles_before_long     integer not null default 4  check (cycles_before_long between 1 and 12),
  pause_demand_on_break  boolean not null default true,  -- tempo da demanda pausa no intervalo
  on_switch              demandas_app.pomodoro_switch_mode not null default 'continue',
  auto_start_breaks      boolean not null default false,
  auto_start_focus       boolean not null default false,
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pomodoros: o ritmo, independente de demanda. Cada linha é uma fase
-- (foco, intervalo ou pausa longa). As atividades feitas durante um foco
-- apontam para ele em time_entries.pomodoro_id.
-- ---------------------------------------------------------------------------
create table demandas_app.pomodoros (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         demandas_app.pomodoro_kind not null default 'focus',
  cycle        smallint not null default 1 check (cycle between 1 and 12),
  planned_minutes integer not null check (planned_minutes > 0),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  status       demandas_app.pomodoro_status not null default 'running',
  -- Intervalo com "pausar tempo da demanda": atividade na fila ("Próximo: …"),
  -- retomada automaticamente quando o próximo foco começar.
  queued_demand_id      uuid references demandas_app.demands(id) on delete set null,
  queued_free_activity  text,
  created_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check ((status = 'running') = (ended_at is null))
);
create index on demandas_app.pomodoros (owner_id, started_at desc);
create unique index pomodoros_one_running on demandas_app.pomodoros (owner_id) where status = 'running';

-- ---------------------------------------------------------------------------
-- Sessões de tempo: cada trecho em que uma atividade esteve rodando.
-- Atividade = uma demanda OU uma atividade livre (ex.: "E-mails").
-- pomodoro_id = foco durante o qual o trecho aconteceu (um foco pode ter
-- vários trechos de atividades diferentes). ended_at nulo = rodando.
-- ---------------------------------------------------------------------------
create table demandas_app.time_entries (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  demand_id            uuid references demandas_app.demands(id) on delete set null,
  free_activity        text check (free_activity is null or length(trim(free_activity)) > 0),
  pomodoro_id          uuid references demandas_app.pomodoros(id) on delete set null,
  started_at           timestamptz not null default now(),
  ended_at             timestamptz,
  duration_seconds     integer generated always as (
                         case when ended_at is null then null
                              else extract(epoch from (ended_at - started_at))::integer end
                       ) stored,
  note                 text,
  created_at           timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (demand_id is null or free_activity is null)
);
create index on demandas_app.time_entries (owner_id, started_at desc);
create index on demandas_app.time_entries (demand_id);
create index on demandas_app.time_entries (pomodoro_id);
create unique index time_entries_one_running
  on demandas_app.time_entries (owner_id) where ended_at is null;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at
-- ---------------------------------------------------------------------------
create trigger trg_groups_touch        before update on demandas_app.groups           for each row execute function demandas_app.touch_updated_at();
create trigger trg_types_touch         before update on demandas_app.demand_types     for each row execute function demandas_app.touch_updated_at();
create trigger trg_routines_touch      before update on demandas_app.routines         for each row execute function demandas_app.touch_updated_at();
create trigger trg_demands_touch       before update on demandas_app.demands          for each row execute function demandas_app.touch_updated_at();
create trigger trg_checklist_touch     before update on demandas_app.checklist_items  for each row execute function demandas_app.touch_updated_at();
create trigger trg_pomo_settings_touch before update on demandas_app.pomodoro_settings for each row execute function demandas_app.touch_updated_at();
