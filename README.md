# PomoControl

App desktop de uso pessoal para controle de demandas, rotinas recorrentes, cronômetro por atividade e pomodoro.

- `backend/`: schema `demandas_app` no Supabase (migrations, testes e documentação).
- `supabase/functions/capturar-demanda/`: Edge Function que usa o Gemini para propor uma demanda a partir de texto ou imagem (especificação em `docs/ia/`).
