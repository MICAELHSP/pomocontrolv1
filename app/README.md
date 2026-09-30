# Pauta (app desktop)

Electron + React + TypeScript, dados no Supabase (schema `demandas_app`, ver `../backend`).
Telas seguem `design/prototipo.html`: Hoje, Demandas (com detalhe), Rotinas e Foco, com a barra do cronômetro fixa no rodapé.

## Rodar

```bash
cd app
npm install
cp .env.example .env   # preencha URL e chave publicável do Supabase
npm run dev            # abre o Electron com recarga automática
```

Sem `.env`, o app pergunta a URL e a chave na primeira abertura e guarda só naquele computador.
No Supabase o schema `demandas_app` precisa estar em **Project Settings > API > Exposed schemas**.
Na primeira vez use "Criar conta" (e-mail e senha do Supabase Auth); cada usuário só vê os próprios dados (RLS).

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run dev:web` | Só a interface no navegador (http://localhost:5173) |
| `npm test` | Testes das regras no cliente (recorrência, pomodoro, conflito) |
| `npm run typecheck` | Checagem de tipos |
| `npm run dist:win` / `npm run dist:mac` | Gera o instalador em `release/` (rode no próprio sistema) |

## Como o tempo é contado

- O **cronômetro da atividade** grava trechos em `time_entries` (uma demanda ou uma atividade livre, como "E-mails").
- O **pomodoro** é um ritmo à parte (`pomodoros`). Cada trecho feito durante um foco guarda o `pomodoro_id`.
- **Trocar para…** (rodapé ou tela Foco) chama `start_activity`: fecha o trecho anterior e abre outro **no mesmo foco**, que fica dividido entre as atividades ("Este foco"). Com "Começar foco novo" nos ajustes, o foco atual fecha como interrompido.
- No intervalo, a troca só coloca a atividade na fila ("Próximo: …"); ela volta a contar no foco seguinte.
- O fim de cada fase passa sozinho para a próxima (foco → intervalo → foco; pausa longa a cada 4) e mostra uma notificação.
- **Pausar** grava o trecho e interrompe o foco atual; **Iniciar** começa um foco novo com a mesma atividade.
- **Parar e gravar** encerra a atividade e a fase.

Toda regra fica no banco (RPCs `start_activity`, `stop_activity`, `start_pomodoro`, `finish_pomodoro`); o app só mostra o relógio entre uma leitura e outra.

## Estrutura

```
electron/        processo principal e preload (sem acesso a Node no renderer)
src/lib/         tipos, formatação, recorrência, pomodoro, conflito (+ testes)
src/data/        leituras/escritas no Supabase (React Query) e modelo derivado
src/timer/       estado do cronômetro + pomodoro
src/components/  barra lateral, rodapé do cronômetro, linha de demanda, seletor de atividade
src/views/       Hoje, Demandas, Detalhe, Rotinas, Foco, Login
```

## Calendário do Outlook

O app lê as reuniões do Outlook (Microsoft Graph, só leitura) para a agenda de Hoje, o selo de conflito e o "Mover para". O login e as chamadas ficam no processo principal (`electron/outlook.cjs`); o renderer usa `useCalendar()` de `src/lib/outlook.ts`. Para conectar é preciso registrar o app no Azure: passo a passo em [docs/outlook.md](../docs/outlook.md). No `npm run dev:web` (navegador) o calendário fica indisponível.

## Ainda não feito

- Nova demanda com IA (captura por texto ou imagem, revisão e criação): próximo passo, com a tela Configurações > Inteligência artificial.
