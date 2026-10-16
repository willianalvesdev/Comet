# Modelos gratuitos via OpenRouter

Adicione OPENROUTER_API_KEY ao arquivo .env do servidor e reinicie o Comet. A chave nunca vai para o navegador. Não envie a chave em mensagens nem a versione no Git.

O seletor Pesquisar limita a lista aos 11 modelos definidos em `curatedModels` em `server/ai/openrouter.ts`, agrupados por empresa. Nomes e ícones são locais; somente modelos ainda disponíveis e gratuitos entram na lista. A disponibilidade é verificada no catálogo de modelos gratuitos de https://openrouter.ai/api/v1/models. O catálogo é atualizado a cada cinco minutos, sem precisar editar o código. São aceitos apenas IDs terminados em :free, com entrada e saída de texto e todos os preços informados iguais a zero. A requisição também fixa preço máximo zero para tokens, requisição e imagem; não há fallback para modelo pago. Modelos gratuitos têm limites e disponibilidade definidos pelo OpenRouter.

OPENROUTER_DEFAULT_MODEL é opcional: use o ID original do catálogo (sem o prefixo interno openrouter:). Se estiver ausente ou indisponível, o primeiro modelo com suporte a imagens é escolhido; na ausência dele, o primeiro da lista. O usuário pode escolher outro e a preferência é salva por conta no navegador. O identificador exato é salvo nos metadados da resposta, preservando histórico e versões.

Sem a chave, o Gemini já configurado continua disponível. Ao configurar OpenRouter, a lista online passa a mostrar apenas seus modelos gratuitos. O modo Computer e os modelos Ollama locais continuam disponíveis. GEMINI_API_KEY e conversas antigas não são removidos.

A pesquisa usa o SEARXNG_URL existente para modelos OpenRouter. Não são ativados plugins nem ferramentas de pesquisa cobradas pelo OpenRouter. Documentos extraídos viram texto; imagens exigem um modelo com suporte a imagens. Um modelo incompatível recebe uma mensagem de erro, sem troca silenciosa para Gemini. A interpretação financeira usa o modelo selecionado, com validação JSON e as validações financeiras existentes.

O backend trata respostas SSE, raciocínio opcional, cancelamento, limites de tamanho, erros de autenticação e cota. Não repete solicitações após resposta parcial. A chave ausente ou catálogo indisponível produz uma mensagem explícita.

Documentação oficial: https://openrouter.ai/docs/api/reference/streaming e https://openrouter.ai/docs/guides/routing/model-variants/free
