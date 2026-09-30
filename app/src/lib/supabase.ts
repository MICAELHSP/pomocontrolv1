// Cliente Supabase apontando para o schema demandas_app.
// URL e chave publicável vêm do .env (VITE_SUPABASE_URL / VITE_SUPABASE_KEY)
// ou, se não houver, do que o usuário informou na tela de conexão.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LS_KEY = 'pauta.conn';

export interface Conn { url: string; key: string }

export function getConn(): Conn | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  if (url && key) return { url, key };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Conn;
  } catch { /* sem armazenamento */ }
  return null;
}

export function saveConn(c: Conn) {
  localStorage.setItem(LS_KEY, JSON.stringify(c));
}

export function clearConn() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ok */ }
}

let client: SupabaseClient<any, 'demandas_app'> | null = null;

export function sb(): SupabaseClient<any, 'demandas_app'> {
  if (!client) {
    const c = getConn();
    if (!c) throw new Error('Supabase não configurado');
    client = createClient<any, 'demandas_app'>(c.url, c.key, {
      db: { schema: 'demandas_app' },
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pauta.auth' },
    });
  }
  return client;
}

/** Mensagem legível de um erro do PostgREST / Postgres. */
export function errMsg(e: unknown): string {
  if (!e) return 'Erro desconhecido';
  if (typeof e === 'string') return e;
  const any = e as { message?: string; details?: string; hint?: string };
  return any.message || any.details || String(e);
}

/** Lança se o Supabase devolveu erro; devolve data. */
export function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}
