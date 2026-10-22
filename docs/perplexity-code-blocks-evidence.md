# Blocos de código: referência do Perplexity

Alvo solicitado: https://www.perplexity.ai/search/5e25e61e-a8b8-4b5c-b1d9-600131f65115

A solicitação foi esclarecida pelo usuário como blocos de código na resposta. Não envolve execução de código.

## Evidências

- Análise REA estática: ev_cb9fe42162d32ddb51240fe661e5e4bb80101292a88ce6f51be310a5faf2bfb9, analyze_javascript_application, confidence derived, authority shipped-artifact. Registro completo local em artifacts/perplexity-code-reference/static-rea.json.
- Captura REA da conversa: ev_7bd1304b209672618f898ea3cfd350e719097e4cf63aa6bb00cccbeab2aa6008, capture_browser_scenario, confidence observed, authority controlled-replay. Registro completo local em artifacts/perplexity-code-reference/live-rea.json.
- Captura visual complementar: artifacts/perplexity-code-reference/code-block.png. Exibe Python com sintaxe colorida, linguagem no cabeçalho, copiar, quebra de linhas e ausência de números de linha.

- `CodeBlock__v2-D7aeobum.js`: SHA-256 `f85d98b87df3cc45ce7c84e7351d8d345afa100ad5c589d358c89aae3907bf68`.
- `codeTheme__v2-Ca3_d9FG.js`: SHA-256 `4f42991fab369e9cb08a8d3effd4bce7c60b053290c83127eaa7ce8c341a58a3`.

## Conclusões e limites

O bundle CodeBlock usa figure, figcaption, fonte monoespaçada, borda arredondada e fundo discreto. A linguagem fica à esquerda; a cópia fica à direita e muda de copy para check. HighlightedCode carrega sob demanda, recebe um tema claro ou escuro e possui fallback de texto. O bundle configura showLineNumbers como false. A quebra de linhas e o recolhimento são recursos opcionais.

A captura confirma a apresentação na conversa indicada. Não confirma execução do código Python. A prova complementar de clique/cópia não chegou a gerar runtime-measurements.json; portanto, não se afirma verificação interativa da cópia no site de referência. A captura REA tem eventos de rede incompletos e não demonstra a implementação do servidor.

## Implementação no Comet

Blocos Markdown com crases ou tils geram figure com linguagem, copiar e destaque seguro via highlight.js; linguagem desconhecida ou ausente usa texto literal. Código incompleto também é mostrado durante geração. HTML no código permanece texto. Os estilos respeitam ambos os temas e o scroll nativo. O Comet conserva seus próprios ícones e usa check.svg para confirmar a cópia. Cópia, segurança e layouts são verificados em testes de navegador locais.
