> Registro histórico da migração anterior. O frontend atual usa Next.js, React e Tailwind CSS; veja `README.md`. Os caminhos abaixo descrevem a estrutura anterior, removida após a migração para Next.js.

# Migração para TypeScript

## Resultado

Os 31 scripts próprios e os três testes CommonJS foram migrados. O site continua
com Flask, MySQL, Jinja, CSS e scripts clássicos, sem React ou bundler.
O TypeScript usa `strict: true`, `noEmitOnError: true`, ES2022, DOM/DOM.Iterable
 e remove comentários da saída. Não foram adicionados `any`, `@ts-ignore`
ou afirmações de não nulidade. Os acessos obrigatórios ao DOM são validados.

`static/ts/types/app.d.ts` centraliza os contratos compartilhados, modelos financeiros,
conversas, anexos, provedores, eventos de streaming e APIs do navegador.
`static/ts/api-data.ts` valida respostas e armazenamento recebidos como `unknown`.
`static/ts/dom.ts` valida elementos e campos antes de usá-los.

Os valores monetários das APIs continuam como strings decimais. Os IDs de conversa
anônima continuam nulos. As URLs `/static/js/*.js`, a ordem dos scripts e as chaves
do `WorkspaceNavigation` foram preservadas. Os helpers são carregados antes dos scripts.

## Arquivos migrados

Cada item abaixo foi de `static/js/<nome>.js` para `static/ts/<nome>.ts`:

- `attachments`
- `auth`
- `chat-greeting`
- `chat-preview`
- `chat-search`
- `computer`
- `computer-service`
- `cookies`
- `dictation`
- `discovery-panel`
- `finance-data`
- `finance-parser`
- `graficos`
- `graph-composer`
- `header`
- `message-navigator`
- `model-menu`
- `news`
- `notifications`
- `overlay-scrollbars` (removido posteriormente; rolagem nativa)
- `profile-menu`
- `recent-chats`
- `response-details`
- `sessions`
- `settings`
- `sidebar`
- `theme`
- `tooltips`
- `typewriter`
- `weather`
- `workspace-navigation`

Os testes em `tests/frontend` passaram de `.cjs` para `.cts`:

- `finance-parser.test.cts`
- `navigation.test.cts`
- `recent-chats.test.cts`

`tsconfig.tests.json` emite CommonJS em `artifacts/tests`. Essa pasta tem a mesma
profundidade da pasta de testes original; a resolução `../..` continua apontando
para a raiz. As declarações geradas em `artifacts/types` permitem que os testes usem
os mesmos contratos do site, sem duplicá-los.

## Desenvolvimento

Requisitos: Python 3.10+, MySQL 8+, Node.js 22+ e npm 10+.

```console
npm ci
npm run typecheck
npm run build
npm run test:frontend
npm run watch
```

`npm run build:tests` compila somente as declarações e os testes. `typecheck` não
sobrescreve o JavaScript do site. Não havia lint no projeto e nenhum foi adicionado.

O `iniciar.bat` usa `scripts/console_servidor.py` para compilar depois do mutex de
instância única. A instalação com `npm ci` acontece quando necessária e quando
muda o hash do lockfile. R compila antes de parar o servidor. Uma falha conserva
o servidor em execução e os scripts anteriores. Não há instalação global.

## Verificações

- `npm ci`, `npm run typecheck`, `npm run build` e compilação dos testes passaram.
- Backend: 136 testes existentes aprovados; mais seis testes do iniciador aprovados.
- Frontend: 28 testes aprovados, sem falhas. A referência tinha 24 aprovados
  e duas falhas em 26 testes; ambas também foram corrigidas a pedido do usuário.
- Os dois cenários novos cobrem streaming anônimo com ID nulo e restauração de
  anexos/fontes. O cenário de anexos também verifica upload e remoção.
- Navegação com lateral persistente, streaming, preferências, seleção/exclusão
  de chats, registro/exclusão financeira e animações passaram nos testes.
- Dez comparações de screenshots (landing, recentes, computer, finanças e
  descobrir; 1280px e 390px): nenhuma diferença de pixels, erro JavaScript ou
  transbordamento horizontal nos estados simulados.
- Um erro TypeScript foi introduzido temporariamente para testar `noEmitOnError`:
  o compilador rejeitou o build e os hashes de todos os scripts gerados ficaram
  idênticos. O arquivo temporário foi removido.
- Foram testados mutex duplicado/liberado, primeiro build, instalação por hash,
  falta de Node, reinício e falha de compilação. Os testes do fluxo do servidor
  usam mocks para não encerrar uma instância real em uso; o mutex Windows foi
  exercitado diretamente com uma identidade temporária.

As APIs de IA e notícias dos testes de navegador são simuladas; nenhuma resposta
paga foi solicitada. Os testes de integração do backend passaram com o banco local.
Os logs e screenshots ficam em `artifacts`, ignorado no Git.

## Falhas anteriores corrigidas

A rolagem personalizada foi removida após novos problemas relatados pelo usuário.
Página, lateral, menus e diálogos usam as barras nativas do navegador. A largura
ocupada pela barra pode reduzir o espaço do conteúdo, conforme a nova preferência.
Não há mais elementos sobrepostos nem observadores para desenhar barras artificiais.
Os testes verificam roda do mouse, teclado, lateral independente e header fixa
em desktop e celular, em vez de exigir margens invariáveis.

O painel de notificações era posicionado apenas no evento assíncrono `toggle`.
Agora a abertura pelo botão posiciona o painel no mesmo clique. A verificação
inclui reabertura e medição imediata, sem esperar o evento assíncrono.

As asserções de margens invariáveis e de barra artificial foram substituídas
por verificações de rolagem nativa, conforme a nova solicitação. Os testes passaram na suíte
completa; screenshots adicionais em 1280px e 390px confirmaram a rolagem e o
painel dentro da tela, sem erros JavaScript. As dez comparações idênticas acima
se referem à migração antes destas correções visuais solicitadas posteriormente.

## JavaScript remanescente

Apenas a biblioteca vendorizada `static/js/vendor/lightweight-charts.js` (5.0.9)
e os arquivos gerados pelo compilador permanecem em JavaScript. A biblioteca,
sua LICENSE e seu NOTICE foram comparados byte a byte e permanecem intactos.
Os scripts gerados e `node_modules` estão ignorados no Git; os scripts anteriormente
rastreados foram retirados do índice, mantendo os arquivos locais para executar o site.
Os fontes próprios são mantidos exclusivamente em TypeScript.

## Remoção posterior do registro por texto

A pedido do usuário, o interpretador local e o fluxo de IA para criar/excluir
transações foram removidos, junto das duas rotas exclusivas desse fluxo e dos
testes correspondentes. A caixa de finanças não envia comandos. A API estruturada,
histórico, dados armazenados e gráficos permanecem preservados.
