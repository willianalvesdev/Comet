# Dados de criptomoedas

O Comet mantém apenas as abas Minhas finanças e Cripto. A página Mercados, os catálogos de ações, índices, setores e renda fixa, e as integrações Yahoo Finance e Financial Modeling Prep foram removidos. A interface é nativa e não usa os endpoints privados da Perplexity.

## Configuração

O uso pessoal e de teste solicitado utiliza a API pública **CoinGecko** sem chave. `COINGECKO_API_KEY` é opcional e aceita uma chave **Demo**, enviada no header `x-cg-demo-api-key`. Chaves Pro não são compatíveis com esse host. Nenhum plano pago é contratado automaticamente. Consultas passam pelo servidor autenticado do Comet; a chave permanece no servidor e nenhum dado financeiro pessoal é enviado ao provedor.

## Cobertura

- O painel lista até 100 moedas ordenadas por capitalização, com preços, volume e variação de 24 horas em USD. Os minigráficos mostram os últimos 7 dias.
- A pesquisa consulta o catálogo de criptomoedas da CoinGecko e busca preços para até 8 resultados por consulta. Sem texto, mostra as 6 primeiras moedas do painel. Moedas sem cotação preservam valor nulo; não são usados dados simulados.
- Páginas individuais identificam moedas pelo ID CoinGecko, como `bitcoin`, e podem consultar moedas que não estão entre as primeiras 100. IDs desconhecidos retornam erro de não encontrado.
- Histórico: 1 dia, 5 dias, 1 mês, 6 meses e 1 ano, com granularidade automática da CoinGecko e até 500 pontos. Horários são milissegundos Unix; dados inválidos, duplicados ou futuros são descartados. Gráficos unem as amostras disponíveis e exibem indisponibilidade quando não há série suficiente.

Dados são agregados pelo provedor: não representam uma corretora específica. Não estão incluídos funding rates, variação do volume em 24 horas, negociações, previsões, sentimento ou relatórios privados. Notícias aparecem apenas no painel de Cripto, usando a infraestrutura existente do Comet. A página da moeda usa o mesmo FinancePlot e FinanceNumber de Minhas finanças, com USD, seleção, zoom, animação, tema, menus, exportação e tela cheia. As velas resumem amostras por intervalo; não representam o fluxo completo de negócios de uma corretora. A linha do tempo destaca as cinco maiores variações entre as últimas amostras de cada dia (hora no intervalo 1D), em ordem cronológica inversa, com preço anterior/atual, período UTC e fonte. Ela descreve variações medidas e não atribui causas econômicas sem evidências. Falhas e histórico em cache continuam identificados; avisos rotineiros de USD/provedor foram removidos do topo e da busca.

## Cache e limites

Cache compartilhado por processo e configuração, válido por 5 minutos. Consultas simultâneas iguais compartilham a mesma chamada. Após falha, a última consulta pode ser exibida com `stale: true` por até 15 minutos desde a coleta original. Existem limites de 128 entradas, 12 consultas simultâneas, 4 MB por resposta e timeout de 12 segundos. HTTP 429/5xx aplica espera; 401/403 bloqueia novas consultas à fonte por 15 minutos. O cache não é compartilhado entre processos ou réplicas.

Pesquisas aceitam até 80 caracteres; IDs aceitam apenas letras minúsculas, números e hífen, até 100 caracteres. Hosts e rotas externas são fixos; URLs informadas pelo usuário não são consultadas. Não há contorno de bloqueios nem substituição silenciosa por outro provedor.

## Custos

Uso pessoal/de teste autorizado pelo usuário. Os limites verificados em 18/10/2026 estão em [CoinGecko API pricing](https://www.coingecko.com/en/api/pricing): o Demo gratuito anuncia 10 mil chamadas/mês, 100/minuto e 1 ano de histórico. O acesso público sem chave não oferece a mesma previsibilidade de cota. Há link de atribuição na interface. A [licença comercial](https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses) requer plano pago; não é necessária uma assinatura comercial para o cenário pessoal/de teste solicitado.

## Endpoints

Do Comet, autenticados:

- `GET /api/finance/crypto`: painel.
- `GET /api/finance/crypto/search?q=bitcoin`: pesquisa; consulta vazia mostra populares.
- `GET /api/finance/crypto/asset?id=bitcoin`: cotação e metadados individuais.
- `GET /api/finance/crypto/history?id=bitcoin&range=1m`: histórico.

Do provedor: [coins/markets](https://docs.coingecko.com/reference/coins-markets), [search](https://docs.coingecko.com/reference/search-data) e [market_chart](https://docs.coingecko.com/reference/coins-id-market-chart).

Os testes de servidor cobrem cache, falhas, limites, normalização, pesquisa real simulada, detalhe direto, proteção das chaves e remoção das rotas de ações. As evidências da referência estão em [perplexity-finance-evidence.md](perplexity-finance-evidence.md).
