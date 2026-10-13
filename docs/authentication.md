# Entrada com Google, GitHub ou código por e-mail

O Comet oferece o mesmo fluxo para criar conta ou entrar. Não solicita idade nem
senha. O e-mail só cria a conta depois de confirmar um código válido. As rotas
antigas de cadastro/login por senha foram removidas; contas e dados existentes
permanecem no banco e podem ser acessados pelo código enviado ao mesmo e-mail.

## Configuração local

Execute `npm run db:setup` depois de atualizar o projeto. As novas tabelas são
adicionadas sem apagar usuários. Preencha os campos abaixo no `.env`, nunca no
frontend ou em arquivos publicados. Reinicie o Next.js após alterar a configuração.

`AUTH_ORIGIN` deve ser o endereço público exato, sem caminho: localmente,
`http://127.0.0.1:5001`; em produção, `https://seu-dominio`. Use esse mesmo
endereço para abrir o site. Em desenvolvimento na porta 3000, altere a origem e
registre também os callbacks da porta 3000 nos provedores.

## Google

No [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
configure a tela de consentimento e crie um cliente OAuth do tipo aplicativo Web.
Enquanto o aplicativo estiver em teste, cadastre as contas autorizadas como usuários
de teste. Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

URI de redirecionamento autorizada local:
`http://127.0.0.1:5001/api/auth/google/callback`.
No servidor público, substitua a origem pelo domínio HTTPS configurado.

O aplicativo pede somente identidade, nome e e-mail. Valida assinatura, emissor,
destinatário, validade e nonce do ID token. Para Google com e-mail externo ao Gmail
e sem domínio Workspace, a primeira entrada deve usar o código por e-mail:
nesses casos o Google não garante a posse atual da caixa postal.
[Documentação do Google](https://developers.google.com/identity/sign-in/web/backend-auth).

## GitHub

Em [Developer settings / OAuth Apps](https://github.com/settings/developers), crie
um aplicativo OAuth com Homepage URL igual a `AUTH_ORIGIN` e callback:
`http://127.0.0.1:5001/api/auth/github/callback`.
Preencha `GITHUB_CLIENT_ID` e `GITHUB_CLIENT_SECRET`.

São solicitados apenas `read:user` e `user:email`, sem acesso aos repositórios.
A conta precisa ter um e-mail principal verificado.
[Documentação do GitHub](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

As duas integrações usam state vinculado ao navegador, PKCE S256 e autorização de
uso único com dez minutos de validade. Tokens dos provedores não são persistidos.
Uma identidade externa não é associada automaticamente a uma conta existente só
porque os e-mails coincidem: nesse caso, a interface orienta entrar por código.
Não há uma tela adicional de vinculação de contas.

## Envio de códigos

Use um serviço SMTP próprio para envio transacional. Configure:

- `SMTP_HOST`: servidor do serviço.
- `SMTP_PORT`: normalmente 587 (STARTTLS) ou 465 (TLS direto).
- `SMTP_USER` e `SMTP_PASSWORD`: credenciais SMTP.
- `EMAIL_FROM`: endereço de e-mail simples do remetente, verificado no serviço.

Configure SPF, DKIM e DMARC conforme as instruções do provedor para o domínio
remetente. O transporte exige TLS 1.2 ou superior e valida o certificado; não há
modo de envio sem criptografia. Sem credenciais, a API retorna uma mensagem de
serviço não configurado e não cria uma sessão ou um código de demonstração.
[Transporte SMTP](https://nodemailer.com/smtp).

O código possui seis dígitos aleatórios, expira em dez minutos e pode ser usado
uma única vez, no navegador que o solicitou. É armazenado apenas como HMAC,
vinculado a um token aleatório em cookie HTTP-only. São permitidas até cinco
tentativas por código; reenvios invalidam o anterior. Cada endereço pode receber
um código por minuto e cinco por hora. Existem também limites por origem de
requisição. E-mails cadastrados e novos recebem o mesmo comportamento.

Em produção, use HTTPS, `SESSION_COOKIE_SECURE=true` e uma `SECRET_KEY` aleatória.
Cookies usam HttpOnly e SameSite=Lax, sessões são rotacionadas ao entrar e alterações
exigem CSRF. Configure `TRUST_PROXY=true` apenas com um proxy controlado que
sobrescreva X-Forwarded-For, X-Forwarded-Host e X-Forwarded-Proto. Sem proxy confiável,
visitantes compartilham o limite conservador local. Use também limites de tráfego
no proxy para um serviço público.

## Verificação

`npm run test:server` cobre expiração, reuso, tentativas, concorrência, rotação de
sessão, CSRF, assinatura dos tokens Google, PKCE e respostas OAuth inválidas.
O envio SMTP e as chamadas OAuth são simulados nos testes, sem enviar e-mails.
`npm run test:frontend` cobre as telas, colagem/autopreenchimento dos seis dígitos,
erros, fechamento durante requisições e redirecionamento após confirmação.

A entrega real de e-mails e a autorização nas contas Google/GitHub precisam ser
verificadas depois de preencher as credenciais dos serviços.
