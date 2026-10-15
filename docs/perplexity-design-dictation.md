# Referência de estilos e ditado

Implementado em 14/10/2026.

- CSS público atual: https://pplx-next-static-public.perplexity.ai/_spa/assets/style__v2-DVkwRsac.css. Captura complementar em artifacts/perplexity-design/styles.json. Organização por primitivas, papéis semânticos e escalas; sombras de cinco camadas adaptadas aos tokens existentes do Comet. 327 variáveis globais passaram a 121, preservando os consumidores.
- Evidência REA E3: ev_db4b9e56d56c15c6930cb80d73765c4db54ed87f76dab9edff873dc58116336a, módulo ask-input__v2-BBPXMWye.js, componente Qh (aproximadamente offsets 247900–250550). Máscara de borda de 1px, gradiente cônico transparente 135°, destaque 180°, transparente 225°, blur e rotação de 5s, proporção ajustada à caixa. Implementação do Comet segue essa estrutura.
- O bundle também usa AudioContext e AnalyserNode no fluxo de voz. O desenho exato das bolinhas não foi localizado; o Comet reconstrói o visual das imagens fornecidas, com RMS real do microfone, suavização e envelope central. Não há áudio sintético alimentando o efeito.
- O medidor só solicita áudio após iniciar o ditado; libera tracks e AudioContext ao finalizar, cancelar ou sair. Se o medidor não estiver disponível, a transcrição permanece funcional. Preferência de movimento reduzido mantém indicador estático.
- Fades existentes da navegação e das fontes agora combinam máscaras de opacidade com blur progressivo de 2px/5px, sem interceptar cliques.

Limite de evidência: a animação do ditado do Perplexity foi identificada no código entregue, não por gravação de uma sessão autenticada com microfone. O teste automatizado do Comet usa reconhecimento controlado, não valida a transcrição de fala em hardware real.
