# Conectar o calendário do Outlook ao Pauta

O Pauta lê as reuniões do seu Outlook (só leitura) para mostrar na agenda da tela Hoje e avisar quando o prazo de uma demanda cai em cima de uma reunião. Nada é alterado no Outlook. Uma cópia das reuniões (assunto, início, fim, local e link) fica no Supabase do Pauta, atualizada a cada 5 minutos, para o histórico do Calendário e o cálculo de ocupação; reuniões canceladas ou recusadas são apagadas da cópia. Não importa se você usa o Outlook no navegador ou instalado: o Pauta lê direto da sua conta Microsoft.

Para isso a Microsoft exige que você registre o Pauta como um "aplicativo" na sua conta. É grátis e leva uns 5 minutos.

## 1. Descubra qual conta tem as suas reuniões

- **Conta do trabalho** (e-mail da empresa, Outlook do Microsoft 365): siga o caminho A.
- **Conta pessoal** (@outlook.com, @hotmail.com, @live.com): siga o caminho B.

## 2A. Conta do trabalho

1. Entre em <https://entra.microsoft.com> com o e-mail da empresa.
2. Menu da esquerda: **Identidade > Aplicativos > Registros de aplicativo > Novo registro**.
   - Se aparecer que você não tem permissão, a empresa bloqueou o registro de aplicativos. Peça ao TI para registrar com os dados abaixo, ou para liberar.
3. Preencha:
   - **Nome**: `Pauta`
   - **Tipos de conta com suporte**: *Contas somente neste diretório organizacional*
   - **URI de Redirecionamento**: escolha a plataforma *Cliente público/nativo (móvel e área de trabalho)* e digite `http://localhost`
4. Clique em **Registrar**.
5. Na página que abre (Visão geral), copie dois valores:
   - **ID do aplicativo (cliente)**
   - **ID do diretório (locatário)**
6. Vá para o passo 3.

## 2B. Conta pessoal

1. Entre em <https://entra.microsoft.com> (ou <https://portal.azure.com>) com a sua conta pessoal. Se pedir para criar um diretório ou uma assinatura gratuita do Azure, aceite a opção gratuita.
2. **Identidade > Aplicativos > Registros de aplicativo > Novo registro**.
3. Preencha:
   - **Nome**: `Pauta`
   - **Tipos de conta com suporte**: *Contas em qualquer diretório organizacional e contas pessoais da Microsoft*
   - **URI de Redirecionamento**: plataforma *Cliente público/nativo (móvel e área de trabalho)*, valor `http://localhost`
4. **Registrar** e copie o **ID do aplicativo (cliente)**.

## 3. Permissões (os dois caminhos)

1. No registro, abra **Permissões de APIs > Adicionar uma permissão > Microsoft Graph > Permissões delegadas**.
2. Marque `Calendars.Read`, `User.Read` e `offline_access` e clique em **Adicionar permissões**.
3. Abra **Autenticação** e confira:
   - Em *Aplicativos móveis e da área de trabalho* aparece `http://localhost`.
   - *Permitir fluxos de clientes públicos*: **Sim**. Salve.

## 4. No Pauta

1. Na tela **Hoje**, no título "Agenda do dia", clique em **Conectar Outlook**.
2. Cole o **ID do aplicativo (cliente)**.
3. Em **Locatário**:
   - conta do trabalho: cole o **ID do diretório (locatário)**;
   - conta pessoal: deixe `common`.
4. Clique em **Conectar com a Microsoft**. O navegador abre; entre na conta e aceite as permissões.
5. Quando o navegador disser "Outlook conectado ao Pauta", volte ao app. As reuniões aparecem na agenda.

O login fica guardado cifrado no seu computador. As reuniões são lidas de ontem até 60 dias à frente e atualizam a cada 5 minutos (ou em "Atualizar agora").

## Problemas comuns

| Mensagem | O que fazer |
| --- | --- |
| O endereço de retorno não confere (AADSTS50011) | Refaça o passo 3.3: plataforma móvel/área de trabalho com `http://localhost`. |
| O Azure está pedindo segredo (AADSTS7000218) | Em Autenticação, *Permitir fluxos de clientes públicos* = Sim. |
| O ID do aplicativo não foi encontrado (AADSTS700016) | Confira o ID copiado e o locatário. Conta pessoal usa `common`. |
| Essa conta não é aceita (AADSTS50020) | O tipo de conta do registro não inclui a sua. Conta pessoal precisa do caminho B. |
| Sua empresa exige que um administrador aprove (AADSTS90094) | Peça ao TI para dar consentimento de administrador ao aplicativo "Pauta" (só leitura do calendário). |

## O que o Pauta considera reunião

Entram os eventos marcados como ocupado, provisório, fora do escritório ou trabalhando em outro lugar. Ficam de fora eventos cancelados, marcados como "livre" e eventos de dia inteiro.
