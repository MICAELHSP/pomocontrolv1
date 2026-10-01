# Como instalar o Pauta no Windows

Leva uns 5 minutos. Não precisa instalar mais nada além do próprio app.

## 1. Baixar

1. Abra a página de versões: <https://github.com/MICAELHSP/pomocontrolv1/releases>
2. Na versão mais recente (no topo), em **Assets**, clique no arquivo que termina em **`.exe`** (ex.: `Pauta.Setup.1.0.0.exe`).

## 2. Instalar

1. Abra o arquivo baixado.
2. O Windows pode mostrar a tela azul **"O Windows protegeu o computador"**. Isso acontece porque o app ainda não tem assinatura digital paga, não porque tenha algo errado.
   Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. No instalador, clique em **Avançar** (pode manter a pasta sugerida) e depois em **Instalar**. No fim, o Pauta ganha um atalho na Área de Trabalho e no Menu Iniciar.

## 3. Primeira abertura

**Se aparecer a tela "URL do projeto" e "Chave publicável"** (só acontece quando o instalador foi gerado sem esses dados embutidos), copie e cole:

| Campo | Valor |
|---|---|
| URL do projeto | `https://xwdvbzexezsnwvattgnv.supabase.co` |
| Chave publicável (anon) | `sb_publishable_VdGHIobVhs4uQiWDghJrzg_7fofocLF` |

Clique em **Continuar**. Isso fica salvo no computador e não é pedido de novo.

**Criar a sua conta** (só na primeira vez):

1. Clique em **Primeira vez? Criar conta**.
2. Informe seu e-mail e uma senha (mínimo 6 caracteres) e clique em **Criar conta**.
3. Se o app avisar que enviou um e-mail de confirmação, abra o e-mail, clique no link e volte ao app para **Entrar**.

Pronto. Nas próximas vezes o app já abre logado.

## 4. Usar em outro computador

Instale do mesmo jeito e, em vez de criar conta, clique em **Entrar** com o mesmo e-mail e senha. Seus dados ficam na nuvem (Supabase), então aparecem iguais nos dois computadores.

## 5. Atualizar para uma versão nova

Baixe o `.exe` da versão mais recente (passo 1) e instale por cima, na mesma pasta. Seus dados não se perdem, porque ficam no Supabase, não no computador.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| "Erro de rede" ou nada carrega | Confira a internet. O app precisa de conexão para ler e gravar as demandas. |
| "Invalid login credentials" | E-mail ou senha errados. Se nunca criou conta neste e-mail, use **Criar conta**. |
| "Email not confirmed" | Abra o e-mail de confirmação e clique no link. |
| Mensagem citando `demandas_app` ou "schema" | O Supabase precisa expor o schema: no painel do Supabase, **Project Settings > API > Exposed schemas**, adicione `demandas_app` e salve. |
| Quero trocar de projeto Supabase | Na tela de login, clique em **Trocar projeto Supabase**. |
