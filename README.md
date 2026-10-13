# Comet

Aplicação Next.js com React, TypeScript e Tailwind CSS. O mesmo processo Node.js
serve as páginas, a autenticação e as APIs. Os dados são armazenados no PostgreSQL.

## Iniciar no Windows

1. Instale Node.js 22.12 ou superior, com npm 10+, e tenha PostgreSQL disponível.
2. Copie `.env.example` para `.env`, configure `DATABASE_URL` para um banco e usuário
   próprios do Comet e substitua `SECRET_KEY` por uma chave aleatória de pelo menos
   32 caracteres. Nunca publique esse arquivo.
3. Execute `configurar_banco.bat` para instalar as dependências e criar as tabelas.
   O banco indicado pela URL já deve existir, e a conta usada nessa etapa precisa
   de permissão para criar tabelas. O configurador é idempotente e não apaga dados.
4. Execute `iniciar.bat`. Ele compila o site, inicia o Next.js e abre o navegador.
   O endereço padrão é `http://127.0.0.1:5001`. Mantenha a janela aberta.

O iniciador aceita **R + Enter** para compilar e reiniciar e **S + Enter** para
encerrar. Durante a recompilação, o servidor fica parado; se houver erro, corrija-o
e use R para tentar novamente. A porta e o endereço são definidos por `APP_PORT` e `APP_HOST`.

Esta instalação usa um banco PostgreSQL novo. Não há importação automática de
contas, conversas ou transações de outro banco. O cadastro cria a conta no banco
configurado atualmente. Faça backup do PostgreSQL e de `instance/attachments/`
para preservar tanto os registros quanto os anexos.

## PostgreSQL com Docker

A configuração em `infra/postgres/compose.yaml` inicia um PostgreSQL exclusivo do
Comet, exposto apenas em `127.0.0.1`. Defina `POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD` e `POSTGRES_PORT` no `.env`, e configure `DATABASE_URL` com os
mesmos valores. Se a porta 5432 já estiver ocupada, escolha outra em `POSTGRES_PORT`
(por exemplo 5433) e repita essa porta em `DATABASE_URL`. Senhas com caracteres
reservados precisam ser codificadas para URL.

```console
docker compose --env-file .env -f infra/postgres/compose.yaml up -d
npm run db:setup
```

O banco usa um volume persistente. Encerrar o contêiner não apaga esse volume.
Mudar `POSTGRES_PASSWORD` depois da primeira inicialização não muda automaticamente
a senha já criada no banco. Para usar um PostgreSQL externo, basta configurar
`DATABASE_URL`; as variáveis `POSTGRES_*` servem somente ao contêiner local.

## Desenvolvimento e verificação

```console
npm ci
npm run db:setup
npm run dev
```

O modo de desenvolvimento atende em `http://127.0.0.1:3000`, incluindo as APIs.
Não é necessário iniciar um segundo servidor. Para produção:

```console
npm run build
npm start
```

Comandos de verificação:

```console
npm run typecheck
npm run test:server
npm run test:frontend
npm run test:production
```

A suíte de navegador usa o build real de produção do Next.js e simula somente os
serviços e dados das APIs. Os testes de servidor não devem ser apontados para um
banco que contenha dados importantes; eles usam `DATABASE_URL` do `.env`, criam
contas temporárias e removem os próprios registros ao final. Serviços pagos não são necessários nas verificações simuladas.

A verificação de produção compila o Next.js e envia PDF e DOCX pelas APIs reais.
Ela também exige PostgreSQL, cria uma conta temporária e remove essa conta e seus
anexos ao terminar.

## Estrutura

- `app/`: páginas, layout e rotas HTTP do Next.js.
- `frontend/components/` e `frontend/pages/`: interface React.
- `frontend/controllers/`: interações, navegação, streaming e validação das respostas.
- `server/`: autenticação, PostgreSQL, notícias e serviços de IA e finanças.
- `static/css/`: estilos e variáveis importados pelo build Tailwind.
- `static/img/`, `static/fonts/` e `static/schemas/`: recursos públicos.
- `scripts/`: inicialização, configuração e geração dos recursos dos testes.
- `setup_banco.sql`: esquema idempotente do PostgreSQL.
- `tests/frontend/` e `tests/server/`: testes TypeScript.

Antes de `dev` e `build`, `scripts/sync-static.mjs` copia apenas os recursos públicos
necessários para `public/`. Os estilos entram no build pelo import da aplicação.
`.next/`, `public/static/` e `artifacts/` são gerados e não devem ser editados.
As URLs existentes, como `/novo.html`, `/recentes.html` e `/descobrir.html`,
continuam válidas. `/principal.html` abre um novo chat; `/personalizar.html` abre
as configurações de personalização.

## Autenticação e proteção de dados

A entrada usa Google, GitHub ou código por e-mail, sem idade ou senha. Sessões são
mantidas em cookies HTTP-only e verificadas no PostgreSQL. Alterações exigem CSRF.
Códigos expiram em dez minutos, são de uso único e possuem limites de envio e de
tentativas. As credenciais OAuth e SMTP ficam exclusivamente no servidor.
Consulte [Configurar autenticação](docs/authentication.md) para ativar os serviços.
Em produção, use HTTPS, `SESSION_COOKIE_SECURE=true`, uma `SECRET_KEY` exclusiva
e um PostgreSQL com acesso restrito. A conta normal do site pode usar permissões
somente de leitura e escrita após a criação do esquema. Para mais de uma instância,
compartilhe PostgreSQL e armazenamento privado dos anexos. Mantenha `TRUST_PROXY=false`
no acesso direto. Use `TRUST_PROXY=true` somente atrás de um proxy controlado que
sobrescreva `X-Forwarded-For`, `X-Forwarded-Host` e `X-Forwarded-Proto`. Esses cabeçalhos identificam o cliente e a origem pública usados nas verificações de acesso.

## Computer, Gemini e Ollama

A página Computer usa Gemini ou os modelos instalados no Ollama do servidor.
`OLLAMA_BASE_URL`, `OLLAMA_MODEL` e `OLLAMA_TIMEOUT_SECONDS` configuram o serviço
local. O seletor consulta o catálogo do Ollama e acompanha modelos adicionados ou
removidos; em acesso remoto, os modelos são os da máquina que hospeda o Comet.

Gemini usa `GEMINI_API_KEY` e `GEMINI_MODEL`. `GEMINI_FALLBACK_MODELS` define uma
lista de alternativas, separadas por vírgula, para erros de cota antes de iniciar
a resposta. Um valor vazio desativa a troca. As cotas e cobranças continuam sendo
as do projeto do provedor. Reinicie o servidor depois de alterar `.env`.

Os modelos locais podem pesquisar pelo SearXNG configurado em `SEARXNG_URL`.
Gemini usa a pesquisa da própria API. O painel de fontes mostra os links da
conversa. A execução exige sessão, valida os dados e mantém o histórico da conta
separado de outras contas. Recentes permite abrir, fixar, renomear e excluir chats.

O modo anônimo mantém o histórico somente na página atual, sem salvar no banco
nem alimentar a memória. A personalização e a memória podem ser editadas nas
configurações, incluindo a opção de desativar ou limpar a memória.

O botão + aceita até quatro anexos por mensagem, com limite de 8 MB por arquivo:
PNG/JPEG/WebP, PDF com texto, DOCX e texto UTF-8. Imagens são normalizadas, e os
arquivos ficam privados em `instance/attachments/`. Pré-visualizações exigem a
conta proprietária. A referência e o conteúdo necessário acompanham a mensagem
nos limites de contexto do provedor.

## Finanças

As transações são armazenadas no PostgreSQL e isoladas por conta. Valores monetários
circulam como strings decimais e são armazenados em `NUMERIC(14,2)`. Datas e horários
seguem as regras descritas em `docs/graficos.md`. Não há conexão bancária automática.

As APIs mantêm os contratos existentes para histórico, painel, interpretação e
execução de ações. Lotes são validados e gravados atomicamente; um `operation_id`
UUID evita duplicar o mesmo pedido. Exclusão comum envia para a lixeira, restauração
preserva o ID e exclusão definitiva requer a ação correspondente. Eventos de
auditoria são gravados na mesma transação e não participam dos cálculos.

## Notícias e clima

Execute `configurar_noticias.bat` para salvar uma chave NewsAPI no `.env` sem exibi-la
na tela. A chave fica exclusivamente no servidor. A API mantém filtros de temas,
idiomas e conteúdo, busca páginas de até 100 resultados por idioma e limita a dez
páginas. O cache dura 30 minutos; após falha, pode mostrar o cache anterior por até
24 horas com indicação de desatualização. Novas tentativas aguardam cinco minutos.

O clima consulta Open-Meteo no navegador. A localização exige permissão e é enviada
com precisão reduzida. A previsão fica em cache local por conta, e o usuário pode
alternar entre Celsius e Fahrenheit.