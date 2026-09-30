-- Chave do Gemini configurada pelo app, guardada no Supabase Vault.
-- Origem: thread "Criar tarefas com IA" (ia/README.md). O app só escreve a chave;
-- quem lê é a Edge Function capturar-demanda, com a service role.

create table demandas_app.ai_settings (
  owner_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  provider         text not null default 'gemini' check (provider in ('gemini')),
  model            text,           -- null = padrão da Edge Function
  key_hint         text,           -- "…a1B2", só para exibir
  vault_secret_id  uuid,           -- id em vault.secrets; o conteúdo só sai por get_ai_key
  updated_at       timestamptz not null default now()
);

alter table demandas_app.ai_settings enable row level security;
create policy owner_select on demandas_app.ai_settings
  for select to authenticated using (owner_id = (select auth.uid()));
-- Sem insert/update/delete direto: só pelas funções abaixo.
revoke all on demandas_app.ai_settings from public, anon, authenticated;
grant select (owner_id, provider, model, key_hint, updated_at) on demandas_app.ai_settings to authenticated;
grant all on demandas_app.ai_settings to service_role;

-- Salva ou troca a chave (e, opcionalmente, o modelo) do usuário logado.
create or replace function demandas_app.set_ai_key(p_key text, p_model text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_key  text := trim(p_key);
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'Faça login' using errcode = '42501';
  end if;
  if v_key is null or length(v_key) < 20 or length(v_key) > 200 or v_key ~ '\s' then
    raise exception 'Chave inválida: cole a chave inteira, sem espaços';
  end if;

  select vault_secret_id into v_id from demandas_app.ai_settings where owner_id = v_uid;
  if v_id is null then
    v_id := vault.create_secret(v_key, 'demandas_app_ai_key_' || v_uid, 'Chave do Gemini (app Pauta)');
  else
    perform vault.update_secret(v_id, v_key);
  end if;

  insert into demandas_app.ai_settings (owner_id, model, key_hint, vault_secret_id, updated_at)
  values (v_uid, nullif(trim(p_model), ''), '…' || right(v_key, 4), v_id, now())
  on conflict (owner_id) do update
    set model = excluded.model, key_hint = excluded.key_hint,
        vault_secret_id = excluded.vault_secret_id, updated_at = now();

  return '…' || right(v_key, 4);
end $$;

-- Troca só o modelo, mantendo a chave.
create or replace function demandas_app.set_ai_model(p_model text)
returns void
language sql
security definer
set search_path = ''
as $$
  update demandas_app.ai_settings
     set model = nullif(trim(p_model), ''), updated_at = now()
   where owner_id = auth.uid();
$$;

-- Remove a chave do usuário logado.
create or replace function demandas_app.clear_ai_key()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  delete from demandas_app.ai_settings where owner_id = auth.uid() returning vault_secret_id into v_id;
  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
end $$;

-- Lê a chave. SOMENTE service_role (Edge Function); nunca o app.
create or replace function demandas_app.get_ai_key(p_owner uuid)
returns table (api_key text, model text)
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret, s.model
    from demandas_app.ai_settings s
    join vault.decrypted_secrets ds on ds.id = s.vault_secret_id
   where s.owner_id = p_owner;
$$;

revoke all on function demandas_app.set_ai_key(text, text)  from public, anon;
revoke all on function demandas_app.set_ai_model(text)      from public, anon;
revoke all on function demandas_app.clear_ai_key()          from public, anon;
revoke all on function demandas_app.get_ai_key(uuid)        from public, anon, authenticated;
grant execute on function demandas_app.set_ai_key(text, text) to authenticated;
grant execute on function demandas_app.set_ai_model(text)     to authenticated;
grant execute on function demandas_app.clear_ai_key()         to authenticated;
grant execute on function demandas_app.get_ai_key(uuid)       to service_role;
