# Scroll do Perplexity

Alvo: https://www.perplexity.ai/search/6b703169-afaf-5308-af6d-6148f4f4d3fe
REA Evidence: ev_99540b4a1a88a4bcb20dd11642e9af70fa30726f8ee87701a987d92275146b31

Observação passiva REA identifica a página. Medições complementares de CSS e DOM via Playwright estão em artifacts/perplexity-scroll/browser.json e areas.json; não são resultados REA.

Observado: .scrollable-container usa overflow:auto, scrollbar-gutter:stable, scrollbar-width:thin; scrollbar-color usa fg-primary a 15% e trilho transparente. CSS WebKit define 8px. As regras são condicionadas a forced-colors:none. Nenhum botão de seta customizado foi encontrado nas regras coletadas.

Implementação: padrão nativo fino e transparente aplicado ao Comet; fg-primary mapeado ao token --text. Removidos overrides auto que anulavam o padrão global. Cores e formato nativo variam com navegador e sistema.

Limite: o sidebar da referência usa Radix ScrollArea; esta mudança replica o scroll principal da conversa, não reconstrói esse componente.
