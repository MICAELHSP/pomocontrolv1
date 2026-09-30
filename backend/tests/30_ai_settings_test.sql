-- Teste da chave do Gemini salva pelo app (ai_settings.sql). Ver run.sh.
\set ON_ERROR_STOP 1
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set search_path = demandas_app, public;

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'ESPERAVA ERRO (%): %', needle, sql;
exception when others then
  if sqlerrm like 'ESPERAVA ERRO%' or position(needle in sqlerrm) = 0 then raise; end if;
  raise notice 'ok (erro esperado): %', sqlerrm;
end $$;
create or replace function pg_temp.check(ok boolean, what text) returns text language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', what; end if;
  return 'ok: ' || what;
end $$;

select pg_temp.expect_error($$select set_ai_key('curta')$$, 'Chave inválida');
select pg_temp.expect_error($$select set_ai_key('AIzaSy com espaço 1234567890')$$, 'Chave inválida');
select pg_temp.check(set_ai_key('  AIzaSyA-primeira-chave-0000000001  ') = '…0001', 'salva e devolve só o final');
select pg_temp.check((select key_hint from ai_settings) = '…0001', 'app vê o final da chave');
select pg_temp.expect_error($$select vault_secret_id from ai_settings$$, 'permission denied');
select pg_temp.expect_error($$insert into ai_settings (key_hint) values ('x')$$, 'permission denied');
select pg_temp.expect_error($$select * from get_ai_key('11111111-1111-1111-1111-111111111111')$$, 'permission denied');
select pg_temp.expect_error($$select * from vault.decrypted_secrets$$, 'permission denied');

select pg_temp.check(set_ai_key('AIzaSyA-segunda-chave-000000002', 'gemini-3.8-flash') = '…0002', 'troca a chave');
select set_ai_model('gemini-3.5-flash');

-- Outro usuário não vê nada do primeiro
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.check((select count(*) from ai_settings) = 0, 'RLS isola usuários');
select clear_ai_key();  -- não tem chave: não faz nada

-- Edge Function (service_role) lê a chave certa
reset role;
set role service_role;
select pg_temp.check((select api_key = 'AIzaSyA-segunda-chave-000000002' and model = 'gemini-3.5-flash'
                        from demandas_app.get_ai_key('11111111-1111-1111-1111-111111111111')), 'service_role lê chave e modelo atuais');
reset role;
select pg_temp.check((select count(*) from vault.secrets) = 1, 'troca reaproveita o mesmo segredo');

-- Remover
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select clear_ai_key();
reset role;
select pg_temp.check((select count(*) from vault.secrets) = 0 and (select count(*) from demandas_app.ai_settings) = 0, 'remover apaga do Vault');

\echo 'TODOS OS TESTES DA CHAVE PASSARAM'
