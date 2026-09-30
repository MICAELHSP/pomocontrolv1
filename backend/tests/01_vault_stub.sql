-- Simula o mínimo do Supabase Vault para testar localmente (sem criptografia).
-- NÃO rodar no Supabase real, onde o Vault já existe.
create schema vault;
create table vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  description text,
  secret      text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
revoke all on schema vault from public;
