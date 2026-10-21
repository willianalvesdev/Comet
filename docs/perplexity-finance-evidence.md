# Perplexity Finance: evidências para reconstrução no Comet

Observação em 17/10/2026 das páginas públicas `/finance`, `/finance/crypto`, `/finance/BTCUSD` e `/finance/AAPL`. Nenhuma conta conectada, assinatura ou credencial usada. As capturas são referências de comportamento; dados, notícias e marca do Perplexity não devem virar dados estáticos do Comet.

## Evidências e limites

- **REA M**: `ev_19741a6ac5d0db68b1211f6715405aac8d904f6df8fb9bd49d290705058640c4`, em `artifacts/perplexity-finance/markets-evidence.json`. Cenário em Edge, 1440 × 1000, tema escuro, abertura pública e espera de 6 segundos.
- **REA C**: `ev_246c965112d2e1832d33c1bad45a837daa58e6b34dc545c58105309a12f4dfed`, em `artifacts/perplexity-finance/crypto-evidence.json`, mesmo ambiente.
- **PW I**: observações ativas com Playwright comum, em `interactions-observed.json`, capturas `market-region`, `top-assets-region`, `heatmap-expanded`, `crypto-exchanges`, `crypto-sort`, `detail-BTCUSD` e `detail-AAPL`. Não são evidências REA.
- **PW D**: `detail-interactions-observed.json` e capturas `chart-*`, `historical-data`, `crypto-all-exchanges`; conferir eventuais erros registrados antes de inferir sucesso.
- Ambas as evidências REA marcam o fluxo de rede **incompleto**: havia requisições pendentes ao terminar. O DOM e as capturas registram o estado observado. Não há prova de toda a arquitetura interna, atualização contínua, plano comercial, preços ou direitos de redistribuição dos fornecedores.
- Rede nesta investigação é relatada somente por origem/caminho e código HTTP. Nenhum cookie, cabeçalho de autenticação ou parâmetro de acesso foi coletado no complemento Playwright.

## Funcionalidades observadas

| Área | Observação | Evidência |
| --- | --- | --- |
| Navegação | Barra de busca global de ativos e navegação por áreas. As duas páginas compartilham o cabeçalho e uma composição de conteúdo principal com lateral de widgets. | REA M/C, PNG inicial |
| Mercados | Cards de índices com preço, variação e pequenos gráficos; resumo com acordeões e fontes; mapa de calor; carrossel de notícias; destaques; favoritos; altas/baixas/atividade; setores, renda fixa e cripto popular. | REA M |
| Região principal | Menu da aba oferece mercados dos EUA e Índia. | PW I, `market-region-aria.txt` |
| Grupo de ativos | Menu separado oferece EUA, Europa, Ásia, moedas, cripto, futuros e seleção personalizada. Não confundir com região da página inteira. | PW I, `top-assets-region-aria.txt` |
| Mapa de calor | Botão de ampliar abre sobreposição grande com botão de fechar. Valores/cores representam variação e retângulos agrupam setores. A fórmula exata do dimensionamento não foi investigada. | REA M + PW I, `heatmap-expanded.png` |
| Cripto | Cards de Bitcoin, Ethereum e Solana, resumo, ranking, notícias e destaques; widgets laterais semelhantes aos de mercados. | REA C |
| Fonte do ranking | Opções Coinbase e todas as corretoras. O estado inicial cita transações à vista na Coinbase. Trocar para todas as corretoras substitui as colunas de variação de volume/funding por capitalização: volume, preço, capitalização e variação de preço. | PW I + PW D, `crypto-exchanges-aria.txt`, `crypto-all-exchanges-aria.txt` |
| Ordenação do ranking | Cabeçalhos de volume em 24 h, variação de volume, preço, variação de preço e funding são botões. Variação de preço: primeiro clique ordenou descendente, segundo ascendente. A ordenação trouxe moedas além das dez inicialmente visíveis. | PW I, `cryptoSort` |
| Detalhe do ativo | Linhas/cards abrem rota por símbolo. Cripto tem visão geral, previsões e histórico; ação também apresenta finanças, resultados, detentores e análise. | PW I, detalhes BTCUSD/AAPL |
| Gráfico do ativo | Menu de período com 1D, 5D, 1M, 6M, YTD, 1Y, 5Y, MAX e intervalo personalizado. Interface oferece linha/velas, comparação, captura e expansão. Grade de estatísticas logo abaixo. A existência dos controles não comprova que todos foram executados. | PW D, `chart-period-menu-aria.txt`; PW I, detalhes |
| Histórico | A aba navega para `/finance/BTCUSD/historical-data` e apresenta OHLCV, períodos, intervalo personalizado, download e paginação. A navegação e tabela foram observadas; download não executado. | PW D, `historical-data-aria.txt` |
| Velas e comparação | O seletor mudou visualmente o gráfico para velas. Nesse estado o botão de comparação sumiu; a tentativa posterior de clicar nele terminou por timeout. A comparação em modo de linha permaneceu sem execução. | PW D, `chart-candle.png`, `detail-interactions-observed.json` |
| Contexto dos preços | Linha do tempo de movimentos relevantes com textos e fontes, mais mercados de previsão relacionados. | PW I, detalhes |
| Favoritos | Botões de acompanhar e editar lista estão presentes. Persistência autenticada não foi exercitada. | REA M/C + PW I |

## Rede observada (caminhos sanitizados)

A interface consulta serviços próprios do Perplexity, incluindo:

- `/rest/finance/top-indices/{market,crypto,crypto_sidebar}`
- `/rest/finance/market-sentiment/{market,crypto}` e `/rest/finance/market-summary/{market,crypto}`
- `/rest/finance/market-movers`, `/rest/finance/top-movers/market`, `/rest/finance/top-z-scores/{market,crypto}`
- `/rest/finance/leaderboard/crypto`, `/rest/finance/discover-catalog/{us_homepage,crypto_homepage}`
- `/rest/finance/equity-sectors`, `/rest/finance/fixed-income`, `/rest/finance/watchlist`
- `/rest/finance/quote/{symbol}`, `/rest/finance/history/COIN50USD`, `/rest/finance/timeline/{symbol}/entries`
- `/rest/finance/profile/{symbol}`, `/rest/finance/financials/{symbol}`, `/rest/finance/earnings/{symbol}`, `/rest/finance/analyst-ratings/{symbol}`
- `/rest/finance/prediction-markets/tag/{finance,crypto}` e `/rest/finance/prediction-markets/{symbol}/trending-ticker`
- `/rest/autosuggest/finance/list-autosuggest`

Os caminhos comprovam chamadas vistas nesta sessão, não APIs públicas liberadas para integrar ao Comet. A reconstrução deve usar fornecedores documentados e uma API própria do Comet.

## Fornecedores declarados pela interface

O rodapé atribui dados financeiros ao [Financial Modeling Prep](https://site.financialmodelingprep.com/), opções ao [Unusual Whales](https://unusualwhales.com/), transcrições/áudio/documentos ao [Quartr](https://quartr.com/), dados de resultados ao [Fiscal.ai](https://fiscal.ai/), estimativas ao [FactSet](https://www.factset.com/), previsões ao [Polymarket](https://polymarket.com/) e algumas visualizações do Computer ao [TradingView](https://www.tradingview.com/). O ranking cripto ainda identifica a [Coinbase](https://www.coinbase.com/).

**Observado:** esses nomes estão no rodapé. **Inferência limitada:** há serviços distintos para cotações, notícias/resumos, documentos e previsões. **Desconhecido nesta análise:** contratos, custo efetivo ao Perplexity, cobertura exata por fornecedor e permissão para redistribuição. A disponibilidade e os limites de alternativas gratuitas precisam ser verificados na documentação de cada fornecedor antes de prometer equivalência.

## Adaptação solicitada

Na etapa inicial, a organização aceita foi **Minhas finanças / Mercados / Cripto**. A revisão de 18/10/2026 abaixo substitui essa organização. Manter dados pessoais e transações na primeira aba. Recriar controles e layout com componentes/cores do Comet; cotação, notícia, sentimento e resumo devem identificar fonte e atualização reais. Não simular dados ausentes. Um mapa amostral não deve ser rotulado como índice completo, e uma lista de uma corretora não representa o mercado agregado.


## Revisão de 18/10/2026: apenas Cripto

O usuário solicitou remover Mercados por completo, compartilhar o compositor de Minhas finanças, centralizar a busca com menu/carregamento, abrir páginas individuais de moedas e paginar Descobrir com setas e pontos.

**Observado pela REA:** `capture_browser_scenario`, Evidence `ev_7921dc9e6c6af978f9445894e08f18309e74852b8e26df5c5b00350d3e48cbdc`, arquivo `artifacts/perplexity-finance/search-visible-evidence.json`. Ao focar o campo central, o menu mais largo mostra sugestões. Ao digitar Bitcoin, aparece painel com indicador de carregamento e depois linhas com nome, símbolo, cotação, variação e seta. Capturas `search-visible-search-focus.png`, `search-visible-search-query.png`, `search-visible-search-results.png`. São estados observados, não uma medição dos tempos internos ou do código da busca.

**Observado anteriormente:** `detail-BTCUSD.png` e os registros de detalhes acima mostram a rota própria `/finance/BTCUSD`, sem modal. A acessibilidade do carrossel identifica páginas e botões para a esquerda/direita; as imagens fornecidas pelo usuário mostram os pontos centrais. A tentativa adicional `crypto-search-carousel-observed.json` não conseguiu executar as interações: nessa navegação a referência tratou `crypto` como símbolo e não exibiu os controles esperados. Portanto, não comprova comportamento das teclas, ciclo das setas ou persistência. Escape, teclado e limites de paginação são decisões de acessibilidade da implementação do Comet.

**Implementado no Comet:** abas Minhas finanças/Cripto, rotas `/finance/crypto` e `/finance/crypto/bitcoin` (ID estável da CoinGecko, para evitar símbolos ambíguos), pesquisa com debounce e cancelamento, estados vazios/erro e novas tentativas; compositor compartilhado com controles existentes de modelo, modos e ditado; carrossel paginado por setas/pontos. Endpoints privados da referência não são usados. Integrações de ações e rotas de Mercados foram removidas. Favoritos de criptomoedas anteriores são migrados no mesmo navegador.

**Verificação local:** build de produção e testes de navegador cobrem busca centralizada, carregamento, erro/repetição, teclado, resultados antigos cancelados, detalhe direto/reload/Voltar, gráfico, favoritos isolados por usuário, migração, compositor e envio único com modelo selecionado; layout claro/escuro em 390/1440 px; carrossel sem barra horizontal. Os dados controlados desses testes não representam cotações reais.

**Consulta pública real após a implementação:** `artifacts/crypto-live-report.json`, 18/10/2026. Sem chave Demo configurada, o painel recebeu 100 moedas, a pesquisa Bitcoin retornou 8 resultados e o detalhe `/finance/crypto/bitcoin` carregou histórico de um mês. Todos os endpoints consultados responderam 200, sem erros JavaScript. Bootstrap, conversas/modelos e notícias foram controlados apenas nessa sessão de verificação; esse resultado verifica a integração CoinGecko e não constitui um teste de notícias ao vivo nem da autenticação.

## Comparação de gráficos — 19/10/2026

**Alvo solicitado:** `https://www.perplexity.ai/finance/NQUSD?comparing=NQUSD%2CTRUP%2CVFC%2CLPX%2CDECK`.

**Evidência REA:** `ev_02ffe49aa1f0b1fed8afe9ceccd103ebaf43139384f5462e3c38a1c443b8143c`, em `artifacts/perplexity-finance/compare-baseline-evidence.json`. Capturou página com cinco séries, legenda e menu aberto. Eventos de rede incompletos no término; isso não invalida DOM/acessibilidade capturados, mas não demonstra todas as respostas posteriores.

**Observações ativas adicionais, separadas de REA:** `compare-runtime-observed.json` e `compare-limit-observed.json`, scripts `compare-runtime.cjs`/`compare-limit.cjs`, imagens `compare-*.png`. Usaram navegador próprio encerrado no final. Registraram somente página pública, geometria/valores visuais e campos financeiros públicos; não cookies ou credenciais. O índice `compare-findings.json` contém SHA-256 dos arquivos principais.

- O menu abre sob Comparar, com campo de pesquisa, spinner transitório, cinco sugestões iniciais e linhas com logo/nome/símbolo/mercado/cotação/variação/seta. Os resultados podem incluir ativos selecionados; clicar novamente fecha o menu e mantém a seleção, sem duplicar nem remover. Adicionar fecha o menu.
- Até sete ativos no total, incluindo primário. Adicionar o oitavo substitui o último secundário: de `NQUSD,TRUP,VFC,LPX,DECK,CBRS,AAPL` para `NQUSD,TRUP,VFC,LPX,DECK,CBRS,MSFT`. Confirmado no runtime e no módulo público `FinanceStockHistoryShared__v2-BzJrwzUU.js` (`V=7`, deduplicação com Set, `splice(-2,1)` no excesso).
- Adição e remoção chamam `history.replaceState`, sem aumentar o histórico do navegador. `comparing` é CSV e mantém o primário primeiro. Após remover o último secundário, permanece `?comparing=NQUSD`, embora a legenda deixe de aparecer. Cada linha da legenda navega para seu ativo e o promove a primeiro na CSV, preservando os outros.
- A linha do primário não oferece remoção. Os outros têm X. Passar o cursor no gráfico atualiza cotações/variações de todas as linhas. Selecionar velas oculta legenda e Comparar, preservando escolhas no endereço; voltar à linha restaura a comparação.
- Cores são atribuídas por posição, não por ativo: remover o segundo desloca todas as cores seguintes. Escuro (1→7): `oklch(71.92% .112 205.51)`, `oklch(70.73% .133 38.31)`, `oklch(83.9% .132 96.6)`, `oklch(72.5% .119 316.63)`, `oklch(68.18% .207 22.93)`, `oklch(80.62% .151 67.71)`, `oklch(84.44% .092 .32)`. Claro: `oklch(55.27% .086 208.61)`, `oklch(52.75% .13 37.37)`, `oklch(69.87% .123 97.59)`, `oklch(54.3% .097 316.69)`, `oklch(51.72% .199 21.85)`, `oklch(65.87% .163 54.96)`, `oklch(49.39% .109 9.38)`. Tokens confirmados por estilos computados. O módulo público `get-line-color__v2-Cyh0kLsp.js` contém nove cores por tema e índice modular; o fluxo de adição limita a sete.

**Código público, não observação de execução:** `FinanceStockHistoryShared__v2-BzJrwzUU.js` normaliza cada série usando `historicalPreviousClose || history[0].close`, com `(close-base)/base`; o hover usa o preço histórico e essa variação. A resposta pública BTCUSD 1D observada trouxe `historicalPreviousClose=81930.22`, primeira abertura `81930.22` e primeiro fechamento `81953.30`: portanto a referência não usa necessariamente o primeiro fechamento. O mesmo módulo usa cache por símbolo/período (30 segundos) e conserva os dados anteriores enquanto carrega. Não são inferências sobre servidores internos.

**Adaptação deliberada no Comet:** o parâmetro usa IDs estáveis da CoinGecko, evitando colisões de símbolos. Como essa fonte não fornece `historicalPreviousClose` nesse endpoint, gráfico percentual e hover usam a primeira amostra válida de cada série. A legenda sem hover exibe cotação/variação de 24 horas; seleção arrastada compara seus próprios extremos. O Comet mantém sua API pública existente e seu cache, sem consumir endpoints privados do Perplexity. A igualdade visual e de interação não implica igualdade da granularidade, das cotações ou do referencial da fonte.

**Limites:** não foram medidos todos os tempos de animação nem o comportamento de teclado completo na referência. URLs manuais com mais de sete símbolos não foram exercitadas; sete é o limite confirmado do fluxo de adição. Não se deduz equivalência exata de amostragem ou calendário entre fontes diferentes.

**Implementação e verificação no Comet (19/10/2026):** menu de pesquisa com carregamento/erro/teclado, até sete moedas, substituição do último secundário, paletas claras/escuras por posição, destaque da série pela legenda, cotações sincronizadas no hover, promoção do ativo clicado, persistência via `replaceState` e reabertura por URL. O carregamento de uma comparação não refaz o histórico primário nem descarta o rascunho. Testes de navegador cobriram recarga, Voltar, remoção/duplicatas, troca de período, falha isolada/repetição, moedas fora do catálogo, tela cheia, temas e largura móvel. Build de produção aprovado. Capturas em `artifacts/crypto-comparison.png` e `crypto-compare-menu-{390,1440}.png`; dados controlados de teste não são cotações reais.
