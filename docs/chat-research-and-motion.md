# Chat: animações, transmissão e pesquisa

O seletor Gemini/Computer usa um componente React (`ProviderToggle`) e um estado compartilhado pequeno para integrar os controladores existentes. A cápsula de seleção e as larguras acompanham uma mola de tensão 700 e atrito 50, com limite para impedir ultrapassagem do destino. O conteúdo é medido por `ResizeObserver`; o ícone inativo permanece em 36 px e o nome muda de opacidade. Movimento reduzido aplica o estado final imediatamente. A landing continua demonstrativa, com os controles inertes.

Os menus flutuantes compartilham abertura/fechamento de 150 ms, opacidade e escala 0,95–1, com as curvas medidas na análise. Popovers conservam fechamento externo e pelo teclado. No chat novo vazio, o painel de opções expande sua altura em 220 ms. Chats existentes mantêm o popover de anexos.

## Resposta e persistência

Os deltas recebidos do provedor são enviados pelo endpoint NDJSON imediatamente. O servidor guarda o texto parcial durante a geração e salva a resposta completa antes do evento `done`. Cancelamento ou erro conserva o conteúdo parcial com o estado correspondente. A tela exibe os trechos recebidos e respeita quem rolou para cima; o efeito de digitação simulada foi removido.

As citações `[n]` são associadas à lista numerada de fontes da própria resposta. Links são construídos com APIs do DOM e URLs HTTPS validadas, nunca com HTML produzido pelo modelo. IDs inexistentes não viram links. Código delimitado por crases é preservado literalmente. Versões e histórico reutilizam os metadados de suas respectivas respostas. Uma citação válida não garante, por si só, que a afirmação esteja correta: o modelo continua responsável pela associação semântica.

## Pesquisa e ferramentas

`server/ai/search.ts` coordena as passagens do modelo sem teto fixo de rodadas, dentro do prazo operacional da resposta. Antes de começar a resposta final, ele pode solicitar pesquisa, leitura de uma fonte já encontrada ou cálculo aritmético. Não há execução de JavaScript, shell, SQL ou operações bancárias pelo chat.

- Não há teto fixo de quantidade de buscas, leituras ou rodadas. A resposta completa conserva o prazo operacional de cinco minutos e o cancelamento pelo usuário. Chamadas idênticas repetidas são interrompidas para evitar ciclos sem progresso.
- SearXNG fornece até 60 candidatos por consulta, com deduplicação e diversidade de domínios. Todas as fontes válidas retornadas pelo adaptador são incorporadas, com deduplicação, sem teto total por resposta.
- Três páginas são lidas antecipadamente por busca, no máximo três simultaneamente; o modelo pode solicitar as demais sem um teto total de leituras. Cada leitura tem limite de sete segundos, 768 KB, três redirecionamentos e 16 mil caracteres extraídos. São enviados ao modelo trechos selecionados pela relevância para a consulta, respeitando o orçamento de contexto.
- Pesquisar (Gemini e modelos remotos) usa Tavily Search via REST, inclusive na aba Imagens. Computer (Ollama) mantém SearXNG. A escolha usa o modo/modelo solicitado, antes de adaptações para anexos. Não há troca silenciosa de motor em caso de falha.
- Tavily recebe apenas a consulta pública filtrada, nunca a conversa completa ou a chave do modelo. Usa busca `basic`, até oito resultados, sem resposta sintetizada ou conteúdo bruto; mantém IDs estáveis para as citações do Comet.
- `TAVILY_API_KEY` é opcional e exclusiva do servidor. Sem ela, o Comet usa `X-Tavily-Access-Mode: keyless`, documentado no [guia Tavily](https://tavily.com/agent-setup/SKILL.md), sujeito a limites. Uma chave configurada usa sua própria cota. Quota, autenticação e indisponibilidade aparecem como limitação da pesquisa. Não há instalação do CLI no runtime.
- Páginas que exigem JavaScript, login, formatos não suportados ou recusam acesso continuam como resumos de busca, com essa limitação indicada na interface. Não há contorno desses bloqueios.
- Fontes mantêm IDs estáveis durante todas as consultas e aparecem em eventos de progresso. Conteúdo externo é tratado como dado não confiável.
- A leitura aceita apenas HTTPS público, verifica todos os endereços DNS e fixa o endereço aprovado na conexão. Cada redirecionamento repete a validação. Não envia cookies, autorização ou credenciais a páginas externas.
- A opção de desativar pesquisa e pedidos explícitos para não pesquisar são respeitados. Consultas removem padrões comuns de credenciais, e-mails e identificadores numéricos; isso não é uma garantia de anonimização de qualquer texto.

O ciclo é de pesquisa, leitura e cálculo dentro de uma resposta. Não implementa tarefas persistentes em segundo plano, navegação com cliques, conectores de contas ou uma infraestrutura de múltiplos agentes como a do Perplexity.

## Contexto e memória

`OLLAMA_CONTEXT_LENGTH` permite 4.096–32.768 tokens, com padrão 8.192, limitado também à capacidade anunciada pelo modelo. Aumentar esse valor aumenta o uso de memória do Ollama. Evidências têm orçamento separado para reduzir a perda de histórico.

A memória automática continua local à conta, desativável e editável. Correções explícitas de nome, cidade e profissão substituem os dados anteriores dessas categorias; pedidos para não guardar e para esquecer todas as memórias são respeitados. Até 12 entradas relevantes/recentes, limitadas a 2.500 caracteres, são incluídas no contexto. Isso não treina nem altera os pesos do modelo.

## Validação

Os testes cobrem transmissão antes do fim da geração, cancelamento e persistência, pesquisa complementar, estabilidade das citações, pesquisa além dos limites antigos, bloqueio de endereços privados, extração de páginas, cálculos restritos, memória, teclado, celular, movimento reduzido e cliques rápidos. As chamadas de modelos nesses testes usam respostas controladas, não medem a qualidade dos modelos instalados.


## Validação Tavily — 20/10/2026

Build de produção aprovado. Passaram 21 testes de servidor (pesquisa, provedores, imagens e Tavily) e quatro cenários de navegador (alinhamento e rolagem de Finanças, roteamento e falhas da aba Imagens, em desktop e celular). A consulta real pelo gerador de pesquisa retornou seis fontes Tavily; a rota de imagens retornou cinco imagens. A validação real parou antes da geração do modelo, que foi coberta com respostas simuladas. O acesso utilizado foi keyless; uma primeira consulta de imagens retornou lista vazia, situação tratada pela interface, e a consulta seguinte trouxe resultados. Não há garantia de resultados ou cota ilimitada.

## Citações e instruções — 20/10/2026

Citações adjacentes aparecem como uma etiqueta de domínio com contagem de fontes adicionais. O clique abre a fonte selecionada; hover ou foco abre uma prévia com título, trecho e navegação entre as fontes. O painel cabe em telas pequenas, aceita teclado e fecha ao trocar de chat. Conteúdo externo é inserido como texto e links inseguros não viram citações clicáveis. O inventário dos prompts está em [instrucoes-ia-comet.md](instrucoes-ia-comet.md).

Validação desta alteração: build de produção e 27 testes de servidor aprovados. Quatro cenários de navegador aprovados, cobrindo citações e Markdown em 1280 e 390 px, temas claro/escuro, navegação por teclado, clique abrindo a fonte, descarte do painel ao trocar de chat ou remover a citação, IDs acima de 99 e conteúdo não confiável. Os testes de pesquisa usam respostas simuladas; não avaliam a qualidade das respostas de um modelo real.
