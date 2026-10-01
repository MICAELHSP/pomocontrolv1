# Backend do app de demandas (Supabase)

Tudo fica no schema **`demandas_app`**, separado do que já existe no Supabase da CG.
Cada linha tem `owner_id` (usuário do Supabase Auth) e o RLS garante que cada usuário só vê o que é dele.

## Tabelas

| Tabela | Para quê |
|---|---|
| `groups` | Grupos de demandas (podem ter subgrupos via `parent_id`) |
| `demand_types` | Tipos (Processo, Entrega, Reunião...) |
| `demands` | Demandas. `parent_id` = subtarefa; `status` (todo, in_progress, waiting, done, canceled); prioridade 0 a 4; prazo em `due_date` + `due_time` (hora opcional); estimativa; `external_ref` (nº do processo/link) |
| `demand_dependencies` | "A só conclui depois de B" |
| `checklist_items` | Checklist de cada demanda |
| `demand_updates` | Histórico de andamento/atualizações da demanda |
| `routines` | Rotinas recorrentes: diária (opção só dias úteis), semanal (dias da semana), mensal (todo dia X, `-1` = último dia; com `business_days_only` antecipa fim de semana para sexta, ex.: último dia útil), anual; a cada N períodos |
| `routine_checklist_items` | Checklist padrão copiado para cada ocorrência da rotina |
| `pomodoro_settings` | 25/5/15, ciclos, usar pomodoro, `pause_demand_on_break`, `on_switch` (`continue` ou `restart`) |
| `pomodoros` | O ritmo, independente de demanda: cada fase (foco, intervalo, pausa longa), ciclo, início/fim, `completed`/`interrupted`; fila "Próximo: …" no intervalo |
| `ai_settings` | Configuração de IA por usuário: provedor, modelo, final da chave e referência ao segredo no Vault (sem escrita direta pelo app) |
| `time_entries` | Sessões de tempo de uma demanda **ou** atividade livre (`free_activity`, ex.: E-mails). `pomodoro_id` = foco em que aconteceu (um foco pode ter várias). `ended_at` nulo = rodando |
| `work_settings` | Jornada por usuário: início/fim (08:00–17:00), almoço (60 min), dias úteis (`workdays`, 0 = domingo; padrão seg–sex), fuso (America/Sao_Paulo). Sem linha = padrão |
| `holidays` | Feriados nacionais 2025–2035 (inclui Sexta-feira Santa e 20/11). Compartilhada, só leitura para o app |
| `calendar_events` | Reuniões gravadas pelo app: `source` 'outlook' (cópia do Outlook) ou 'ics' (arquivo importado). Upsert por `owner_id, source, external_id`: início/fim, dia inteiro, `show_as`, local, link |

Visões (respeitam o RLS): `demand_overview` (demanda + tempo total, tempo em foco, pomodoros, checklist, bloqueios), `pomodoro_breakdown` (cada pomodoro com as atividades dentro dele: "Este foco" e "Pomodoros de hoje") `daily_time` (tempo por dia e atividade) e `time_entry_blocks` (cada sessão com título da demanda, grupo e cor, para o mapa semanal do Calendário).

## Regras garantidas pelo banco

- Demanda só vai para `done` se todas as dependências e subtarefas estiverem concluídas ou canceladas (erro com a lista do que falta).
- Sem ciclos em dependências, subtarefas ou grupos.
- Nova subtarefa aberta reabre a mãe que estava concluída.
- Arrastar e soltar: `demands.sort_order` é a ordem manual entre irmãos (mesmo grupo e mesma mãe); soltar entre A e B grava o ponto médio. Mudar de lista sem informar `sort_order` põe no fim.
- Aninhamento de um nível: subtarefa não tem subtarefas, e demanda com subtarefas não vira subtarefa. A subtarefa fica sempre no grupo da mãe, e mudar a mãe de grupo leva as filhas.
- Uma atividade e uma fase de pomodoro rodando por vez; concluir a demanda para o cronômetro dela.
- Referências cruzadas só entre dados do mesmo usuário.

## Funções (RPC) para o app

- `generate_routine_demands(p_until date default hoje+7)` gera as ocorrências das rotinas do usuário até a data (idempotente, não cria ocorrências passadas). O app chama ao abrir.
- `start_activity(p_demand_id | p_free_activity, p_note)` troca a atividade: grava a sessão anterior e começa outra. Durante um foco, a nova sessão entra no mesmo pomodoro (`on_switch = continue`) ou fecha o foco como interrompido e abre outro (`restart`). Durante um intervalo com pausa, não conta tempo: só muda a fila e retorna `null`.
- `stop_activity()` para a atividade ("Parar e gravar").
- `start_pomodoro(p_kind, p_cycle)` inicia foco/intervalo/pausa longa, encerrando a fase anterior (concluída se cumpriu o tempo, senão interrompida). No intervalo a atividade vai para a fila; no foco seguinte ela é retomada.
- `create_demand_from_ai(p jsonb)` grava a proposta revisada da captura com IA (demanda, checklist, subtarefas, dependências e histórico) numa transação só; formato em `/mnt/project-files/ia/README.md`.
- `set_ai_key(p_key, p_model)`, `set_ai_model(p_model)`, `clear_ai_key()` guardam, trocam e apagam a chave do Gemini do usuário no Supabase Vault. O app só vê o final da chave (`ai_settings.key_hint`); a leitura (`get_ai_key`) é exclusiva da service role, usada pela Edge Function.
- `renormalize_demand_order(p_group_id, p_parent_id)` renumera 10, 20, 30… uma lista de irmãos quando os intervalos da ordem manual ficam pequenos.
- `daily_occupancy(p_from, p_to)` devolve, por dia: se é dia útil, feriado, minutos da jornada, tempo registrado (demandas, atividades livres, por grupo), tempo de reunião sem sobreposição com o registrado e a % de ocupação. Até 400 dias por chamada. Reuniões de dia inteiro ou marcadas como livres não contam.
- `finish_pomodoro(p_status)` encerra a fase atual (ex.: "Pular fase"); a atividade segue rodando fora do pomodoro.

No cliente: `supabase.schema('demandas_app').rpc('start_activity', { p_demand_id })`.

## Onde está aplicado

Migrations 1 a 8 aplicadas em 2026-09-30 no projeto **central-gerencial-prod** (`xwdvbzexezsnwvattgnv`), que não é usado pela CG.
Não aplicar no `central-gerencial-dev`: é o banco que a CG usa de verdade.

- URL: `https://xwdvbzexezsnwvattgnv.supabase.co`
- Chave publicável (pode ir no app): `sb_publishable_VdGHIobVhs4uQiWDghJrzg_7fofocLF`
- Cliente: `createClient(URL, KEY, { db: { schema: 'demandas_app' } })`

## Como aplicar no Supabase

1. Rodar os arquivos de `migrations/` em ordem (SQL editor ou `supabase db push`).
2. Em **Project Settings > API > Exposed schemas**, adicionar `demandas_app`.
3. (Opcional) Agendar a geração para todos: `select cron.schedule('rotinas', '0 5 * * *', $$select demandas_app.generate_routine_demands_all(current_date + 7)$$);`

## Testes

`tests/` tem um stub mínimo do Supabase e testes de regras. Rodam contra um Postgres **local** (nunca no Supabase real):

```
PGURL="postgresql://postgres@localhost:5432/postgres" ./tests/run.sh
```

## Outlook

A thread do Outlook grava as reuniões em `calendar_events` (upsert por `owner_id, source, external_id`); o Calendário e `daily_occupancy` já as consideram.
