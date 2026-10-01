# Pauta (app desktop)

Electron + React + TypeScript, dados no Supabase (schema `demandas_app`, ver `../backend`).
Telas seguem `design/prototipo.html`: Hoje, Calendário, Demandas (com detalhe), Rotinas, Foco, Configurações e Nova demanda com IA, com a barra do cronômetro fixa no rodapé.

## Instalar (Windows)

1. Em [Releases](https://github.com/MICAELHSP/pomocontrolv1/releases), baixe `Pauta-Setup-x.y.z.exe` e execute (passo a passo em `../docs/INSTALAR.md`). O Windows pode avisar que o editor é desconhecido (o instalador não é assinado): clique em **Mais informações > Executar assim mesmo**.
2. Na primeira abertura, informe a **URL do projeto** e a **chave publicável** do Supabase (Supabase > Project Settings > API; ver `../backend/README.md`). Ficam guardadas só neste computador.
3. Crie a conta (e-mail e senha) ou entre.
4. Para a IA: **Configurações > Inteligência artificial**, cole a chave do Gemini (https://aistudio.google.com/apikey) e clique em "Salvar e testar". A função `capturar-demanda` precisa estar publicada no Supabase (ver `../ia/`).

Nova versão do instalador: suba `version` no package.json e envie uma tag (`git tag v1.0.1 && git push origin v1.0.1`); o workflow `release` gera o .exe e cria a Release (segredos opcionais `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` deixam o endereço embutido).

## Rodar em desenvolvimento

```bash
cd app
npm install
# opcional: crie .env com VITE_SUPABASE_URL=... e VITE_SUPABASE_KEY=... (não vai para o Git)
npm run dev            # abre o Electron com recarga automática
```

Sem `.env`, o app pergunta a URL e a chave na primeira abertura e guarda só naquele computador.
No Supabase o schema `demandas_app` precisa estar em **Project Settings > API > Exposed schemas**.
Na primeira vez use "Criar conta" (e-mail e senha do Supabase Auth); cada usuário só vê os próprios dados (RLS).

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm run dev:web` | Só a interface no navegador (http://localhost:5173) |
| `npm test` | Testes das regras no cliente (recorrência, pomodoro, conflito, ocupação, ordem, proposta da IA) |
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

## Arrastar, ordenar e aninhar

- Cada linha de Demandas tem uma alça (⋮⋮). Soltar na borda de cima ou de baixo de outra linha reordena; se for outro grupo, muda de grupo. Soltar no título de um grupo leva para o fim dele.
- Segurar 1 segundo no meio de outra demanda arma "virar subtarefa" (um nível só). O detalhe tem o mesmo pelo menu **Mover**.
- Toda mudança mostra **Desfazer** por 6 segundos. A ordem manual fica em `demands.sort_order`; o seletor **Ordenar** também aceita Prazo, Nome e Tempo gasto.

## Calendário

- **Semana**: o tempo registrado em cada demanda aparece como blocos coloridos pelo grupo, das 08h às 18h, com as entregas do dia.
- **Mês**: cada dia pintado pela ocupação da jornada. **Relatório do dia**: ocupação, demandas, atividades livres, reuniões, tempo sem registro e o tempo por demanda.
- Ocupação = (tempo registrado + reuniões fora desse tempo) ÷ jornada. A jornada (padrão 08:00–17:00, 60 min de almoço, seg–sex) fica em Configurações > Jornada (tabela `work_settings`); feriados nacionais ficam fora.
- Reuniões vêm do Outlook (Configurações > Calendário (Outlook); ver `../docs/outlook.md`).

Toda regra fica no banco (RPCs `start_activity`, `stop_activity`, `start_pomodoro`, `finish_pomodoro`); o app só mostra o relógio entre uma leitura e outra.

## Estrutura

```
electron/        processo principal e preload (sem acesso a Node no renderer)
src/lib/         tipos, formatação, recorrência, pomodoro, conflito (+ testes)
src/data/        leituras/escritas no Supabase (React Query) e modelo derivado
src/timer/       estado do cronômetro + pomodoro
src/components/  barra lateral, rodapé do cronômetro, linha de demanda, seletor de atividade
src/views/       Hoje, Calendário, Demandas, Detalhe, Rotinas, Foco, Configurações, Nova com IA, Login
build/           ícone do instalador
```

## Calendário do Outlook

O app lê as reuniões do Outlook (Microsoft Graph, só leitura) para a agenda de Hoje, o selo de conflito e o "Mover para". O login e as chamadas ficam no processo principal (`electron/outlook.cjs`); o renderer usa `useCalendar()` de `src/lib/outlook.ts`. Para conectar é preciso registrar o app no Azure: passo a passo em [docs/outlook.md](../docs/outlook.md). No `npm run dev:web` (navegador) o calendário fica indisponível.
