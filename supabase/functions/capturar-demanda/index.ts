// Edge Function "capturar-demanda": recebe texto e/ou imagens, pede ao Gemini uma
// proposta de demanda e devolve a proposta SEM gravar nada. A gravação acontece
// depois da revisão, pelo app, via RPC demandas_app.create_demand_from_ai.
//
// Chave do Gemini: a que o usuário salvou no app (Configurações > IA, guardada no
// Supabase Vault e lida aqui via RPC get_ai_key com a service role). Sem chave
// salva, usa o segredo GEMINI_API_KEY da função, se existir. Modelo: o salvo pelo
// usuário, senão o segredo GEMINI_MODEL, senão o padrão abaixo.
// SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das Edge Functions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PROPOSTA_SCHEMA, SYSTEM_PROMPT } from "./prompt.ts";

const MODELO_PADRAO = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEZONE = "America/Sao_Paulo";
const MAX_TEXTO = 60_000; // caracteres
const MAX_ANEXOS = 5;
const MAX_ANEXO_BYTES = 5 * 1024 * 1024; // mantém o pedido inteiro abaixo de 20 MB (limite de dados inline)
const TIPOS_IMAGEM = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_SUBTAREFAS = 8;
const MAX_CHECKLIST = 12;
const MAX_PERGUNTAS = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Anexo = { media_type: string; data: string }; // data = base64 sem prefixo "data:"
type Pedido = {
  modo?: "criar" | "refinar" | "testar"; // testar: só confere se a chave salva funciona
  texto?: string;
  anexos?: Anexo[];
  proposta_atual?: unknown; // modo refinar: proposta já editada pelo usuário
  instrucao?: string; // modo refinar: "junte as duas primeiras subtarefas"
};

// Partes da API do Gemini (REST generateContent), só o que usamos
type Parte = { text: string } | { inlineData: { mimeType: string; data: string } };
type RespostaGemini = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

type Subtarefa = {
  ref: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  estimated_minutes: number | null;
  checklist: string[];
  depends_on: string[];
};
type Proposta = {
  summary: string;
  demand: {
    title: string;
    description: string | null;
    type_name: string | null;
    group_path: string | null;
    priority: number;
    due_date: string | null;
    due_time: string | null;
    estimated_minutes: number | null;
    external_ref: string | null;
    checklist: string[];
    // preenchidos aqui, não pelo modelo: null = não existe (o app mostra "novo")
    type_id?: string | null;
    group_id?: string | null;
  };
  subtasks: Subtarefa[];
  questions: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);

  // 1. Usuário logado. O cliente usa o token dele, então o RLS vale nas leituras.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ erro: "Faça login." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    db: { schema: "demandas_app" },
  });
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) return json({ erro: "Sessão inválida." }, 401);

  // Chave e modelo do usuário (o app só grava a chave; quem lê é a service role)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    db: { schema: "demandas_app" },
  });
  const { data: cfg, error: cfgErr } = await admin.rpc("get_ai_key", { p_owner: auth.user.id }).maybeSingle<{
    api_key: string;
    model: string | null;
  }>();
  if (cfgErr) console.error("get_ai_key", cfgErr.message);
  const chave = cfg?.api_key ?? Deno.env.get("GEMINI_API_KEY");
  const MODEL = cfg?.model ?? MODELO_PADRAO;
  if (!chave) return json({ erro: "Configure a chave do Gemini em Configurações > Inteligência artificial." }, 412);

  // 2. Pedido
  let pedido: Pedido;
  try {
    pedido = await req.json();
  } catch {
    return json({ erro: "Corpo inválido." }, 400);
  }
  const modo = pedido.modo ?? "criar";

  if (modo === "testar") {
    // Consulta o modelo com a chave: não gera nada nem gasta cota de geração
    const r = await fetch(`${GEMINI_BASE}/${MODEL}`, { headers: { "x-goog-api-key": chave } }).catch(() => null);
    if (r?.ok) return json({ ok: true, modelo: MODEL, origem: cfg ? "app" : "servidor" });
    if (r) console.error("testar", r.status, await r.text());
    const erro = !r
      ? "Não consegui falar com o Google. Tente de novo."
      : r.status === 404
      ? `A chave funciona, mas o modelo "${MODEL}" não existe. Escolha outro.`
      : "O Google recusou a chave. Confira se copiou a chave inteira.";
    return json({ ok: false, erro }, 200);
  }
  const texto = (pedido.texto ?? "").trim();
  const anexos = pedido.anexos ?? [];
  if (texto.length > MAX_TEXTO) return json({ erro: `Texto acima de ${MAX_TEXTO} caracteres.` }, 413);
  if (anexos.length > MAX_ANEXOS) return json({ erro: `No máximo ${MAX_ANEXOS} anexos.` }, 413);
  for (const a of anexos) {
    if (!TIPOS_IMAGEM.includes(a.media_type) && a.media_type !== "application/pdf") {
      return json({ erro: `Tipo de arquivo não aceito: ${a.media_type}` }, 415);
    }
    if ((a.data.length * 3) / 4 > MAX_ANEXO_BYTES) return json({ erro: "Anexo acima de 5 MB." }, 413);
  }
  if (modo === "criar" && !texto && anexos.length === 0) return json({ erro: "Envie um texto ou uma imagem." }, 400);
  if (modo === "refinar" && (!pedido.proposta_atual || !pedido.instrucao?.trim())) {
    return json({ erro: "Para ajustar, envie a proposta atual e o pedido de alteração." }, 400);
  }

  // 3. Contexto do usuário: tipos e grupos existentes (só nomes vão para o modelo)
  const [tiposRes, gruposRes] = await Promise.all([
    supabase.from("demand_types").select("id, name").order("position"),
    supabase.from("groups").select("id, name, parent_id").eq("archived", false).order("position"),
  ]);
  if (tiposRes.error || gruposRes.error) return json({ erro: "Falha ao ler tipos e grupos." }, 500);
  const tipos = tiposRes.data;
  const grupos = caminhosDosGrupos(gruposRes.data);

  const hoje = new Date();
  const dataHoje = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(hoje); // AAAA-MM-DD
  const diaSemana = new Intl.DateTimeFormat("pt-BR", { timeZone: TIMEZONE, weekday: "long" }).format(hoje);

  const contexto = [
    `Hoje é ${diaSemana}, ${dataHoje} (fuso ${TIMEZONE}).`,
    `Tipos existentes: ${tipos.length ? tipos.map((t) => t.name).join("; ") : "(nenhum)"}`,
    `Grupos existentes: ${grupos.length ? grupos.map((g) => g.path).join("; ") : "(nenhum)"}`,
  ].join("\n");

  // 4. Mensagem: contexto, anexos, depois o texto (imagens antes do texto funcionam melhor)
  const parts: Parte[] = [{ text: contexto }];
  for (const a of anexos) parts.push({ inlineData: { mimeType: a.media_type, data: a.data } });
  if (modo === "refinar") {
    parts.push({
      text: `Proposta atual, já editada pela pessoa:\n${JSON.stringify(pedido.proposta_atual)}\n\n` +
        `Pedido de alteração:\n${pedido.instrucao!.trim()}` +
        (texto ? `\n\nOrigem original (para consulta):\n<origem>\n${texto}\n</origem>` : ""),
    });
  } else {
    parts.push({
      text: texto
        ? `Material recebido:\n<origem>\n${texto}\n</origem>`
        : "Material recebido: somente o(s) anexo(s) acima.",
    });
  }

  // 5. Chamada ao Gemini com saída estruturada no formato da proposta
  let http: Response;
  try {
    http = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 16000,
          thinkingConfig: { thinkingLevel: "low" },
          responseFormat: { text: { mimeType: "application/json", schema: PROPOSTA_SCHEMA } },
        },
      }),
    });
  } catch (e) {
    console.error("gemini rede", e);
    return json({ erro: "Não consegui falar com o serviço de IA. Tente de novo." }, 502);
  }
  if (http.status === 429) {
    return json({ erro: "Limite gratuito do Gemini atingido. Tente em alguns minutos." }, 429);
  }
  if (!http.ok) {
    console.error("gemini", http.status, await http.text());
    const erro = http.status === 400 || http.status === 403
      ? "O Google recusou a chave ou o pedido. Confira a chave em Configurações > Inteligência artificial."
      : "O serviço de IA falhou. Tente de novo.";
    return json({ erro }, 502);
  }
  const resposta: RespostaGemini = await http.json();

  const candidato = resposta.candidates?.[0];
  if (resposta.promptFeedback?.blockReason || candidato?.finishReason === "SAFETY" || candidato?.finishReason === "PROHIBITED_CONTENT") {
    return json({ erro: "A IA não processou esse conteúdo. Crie a demanda manualmente." }, 422);
  }
  if (candidato?.finishReason === "MAX_TOKENS") {
    return json({ erro: "Proposta grande demais. Envie um trecho menor." }, 422);
  }
  // Partes com thought=true são raciocínio; a proposta é o texto restante
  const textoResposta = (candidato?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
  let proposta: Proposta;
  try {
    proposta = JSON.parse(textoResposta);
  } catch {
    return json({ erro: "Resposta da IA fora do formato. Tente de novo." }, 502);
  }

  validar(proposta);
  proposta.demand.type_id = acharId(tipos.map((t) => ({ id: t.id, nome: t.name })), proposta.demand.type_name);
  proposta.demand.group_id = acharId(grupos.map((g) => ({ id: g.id, nome: g.path })), proposta.demand.group_path);

  return json({
    proposta,
    uso: {
      modelo: MODEL,
      input_tokens: resposta.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: (resposta.usageMetadata?.candidatesTokenCount ?? 0) + (resposta.usageMetadata?.thoughtsTokenCount ?? 0),
    },
  });
});

// "Trabalho / Cliente X" para cada grupo, seguindo parent_id
function caminhosDosGrupos(rows: { id: string; name: string; parent_id: string | null }[]) {
  const porId = new Map(rows.map((r) => [r.id, r]));
  const caminho = (r: (typeof rows)[number], guarda = 0): string => {
    const pai = r.parent_id ? porId.get(r.parent_id) : undefined;
    return pai && guarda < 10 ? `${caminho(pai, guarda + 1)} / ${r.name}` : r.name;
  };
  return rows.map((r) => ({ id: r.id, path: caminho(r) }));
}

function acharId(lista: { id: string; nome: string }[], nome: string | null): string | null {
  if (!nome) return null;
  const alvo = nome.trim().toLocaleLowerCase("pt-BR");
  return lista.find((x) => x.nome.trim().toLocaleLowerCase("pt-BR") === alvo)?.id ?? null;
}

// Aplica os limites que o JSON schema não expressa e desfaz o que o banco recusaria.
function validar(p: Proposta) {
  const limpa = (s: string | null) => (s && s.trim() ? s.trim() : null);
  const lista = (xs: string[], max: number) => xs.map((x) => x.trim()).filter(Boolean).slice(0, max);
  const data = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) ? d : null);
  const hora = (h: string | null) => (h && /^([01]\d|2[0-3]):[0-5]\d$/.test(h) ? h : null);
  const minutos = (m: number | null) => (m && Number.isInteger(m) && m > 0 ? m : null);

  const d = p.demand;
  d.title = (d.title ?? "").trim().slice(0, 200) || "Revisar material recebido";
  d.description = limpa(d.description);
  d.type_name = limpa(d.type_name);
  d.group_path = limpa(d.group_path);
  d.priority = Math.min(4, Math.max(0, Math.round(d.priority ?? 2)));
  d.due_date = data(d.due_date);
  d.due_time = d.due_date ? hora(d.due_time) : null;
  d.estimated_minutes = minutos(d.estimated_minutes);
  d.external_ref = limpa(d.external_ref);
  d.checklist = lista(d.checklist ?? [], MAX_CHECKLIST);

  const vistos = new Set<string>();
  p.subtasks = (p.subtasks ?? []).filter((s) => s.title?.trim()).slice(0, MAX_SUBTAREFAS);
  p.subtasks.forEach((s, i) => {
    if (!s.ref || vistos.has(s.ref)) s.ref = `s${i + 1}_${i}`;
    vistos.add(s.ref);
    s.title = s.title.trim().slice(0, 200);
    s.description = limpa(s.description);
    s.due_date = data(s.due_date);
    s.due_time = s.due_date ? hora(s.due_time) : null;
    s.estimated_minutes = minutos(s.estimated_minutes);
    s.checklist = lista(s.checklist ?? [], MAX_CHECKLIST);
  });
  for (const s of p.subtasks) {
    s.depends_on = [...new Set(s.depends_on ?? [])].filter((r) => r !== s.ref && vistos.has(r));
  }
  quebrarCiclos(p.subtasks);
  p.questions = lista(p.questions ?? [], MAX_PERGUNTAS);
  p.summary = (p.summary ?? "").trim();
}

// Remove a aresta que fecha um ciclo (o banco recusaria a gravação inteira).
function quebrarCiclos(subs: Subtarefa[]) {
  const porRef = new Map(subs.map((s) => [s.ref, s]));
  const estado = new Map<string, "visitando" | "feito">();
  const visitar = (s: Subtarefa) => {
    estado.set(s.ref, "visitando");
    s.depends_on = s.depends_on.filter((r) => {
      if (estado.get(r) === "visitando") return false;
      if (!estado.has(r)) visitar(porRef.get(r)!);
      return true;
    });
    estado.set(s.ref, "feito");
  };
  for (const s of subs) if (!estado.has(s.ref)) visitar(s);
}
