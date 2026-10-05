# Página de gráficos

Abra `graficos.html` ou o item **Gráficos** no menu lateral.

## Renderização
A implementação usa TradingView Lightweight Charts 5.0.9, incluída localmente em
`static/js/vendor/`, com licença e NOTICE. Documentação:
https://tradingview.github.io/lightweight-charts/

A biblioteca interna da página https://www.perplexity.ai/finance/BTCUSD não pôde
ser confirmada: a inspeção pública foi bloqueada. Esta implementação reproduz
o visual da referência; não afirma usar a mesma biblioteca da Perplexity.

## Dados do site
Não há API financeira, banco de dados nem chamadas de rede para dados.
`static/js/chart-demo.js` fornece uma série fictícia determinística, identificada
na interface. A moeda da demonstração é BRL.

Substitua a demonstração por dados próprios antes de carregar `graficos.js`:

```js
window.CometChartData = {
    currency: "BRL",
    demo: false,
    points: [
        { time: 1789948800, open: 100, high: 125, low: 90, close: 120, volume: 15 }
    ],
    intraday: [] // opcional, mesma estrutura; usado em 1D e 5D
};
```

Também é possível atualizar a página já carregada com
`window.CometChart.setData(dados)`.
`time` é um timestamp UTC em segundos. Os valores devem ser números finitos;
o volume deve ser não negativo e high/low devem conter open/close.
Os pontos são ordenados e timestamps repetidos ficam com o último registro.
O intervalo é calculado em relação ao último ponto recebido, não à data do dispositivo.
Sem intraday, 1D e 5D usam os pontos disponíveis; não são inventadas amostras.

Tema e fontes são lidos das variáveis CSS existentes.
A página inclui somente Visão geral, períodos, linha/velas e volume.
