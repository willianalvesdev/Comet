# Busca local do Comet

O Comet usa diretamente a API do SearXNG. Open WebUI é opcional e não é necessário para o chat existente.

1. Instale e abra Docker Desktop com suporte a containers Linux.
2. Execute `powershell -ExecutionPolicy Bypass -File infra/searxng/iniciar.ps1` na pasta do projeto. O script cria uma chave aleatória local e inicia o serviço apenas em 127.0.0.1:8888.
3. No `.env` do Comet, defina `SEARXNG_URL=http://127.0.0.1:8888` e reinicie o servidor.
4. Verifique `http://127.0.0.1:8888/search?q=teste&format=json`. Deve retornar JSON com `results`.

O JSON está habilitado na configuração. Filtros de período dependem do suporte de cada buscador; o Comet também rejeita notícias com datas fora do período solicitado. Resultados sem data não comprovam atualidade. O SearXNG consulta serviços externos: não garante resultados nem evita bloqueios dos buscadores.

Todos os modelos locais disponíveis podem pesquisar na internet pelo SearXNG.

Roteamento exclusivo por modelo: os modelos locais usam SearXNG; Gemini usa a API Google Search com grounding. Se o buscador escolhido falhar ou não retornar fontes, a interface informa isso sem trocar de serviço. Anexos que exigem Gemini também usam a busca Google.

Os títulos e trechos de busca são evidências limitadas, não leitura integral das páginas. O histórico salvo não é apagado quando o contexto local é reduzido.

O serviço ainda precisa ser iniciado e validado em uma máquina com Docker; os testes automatizados usam respostas simuladas.

Documentação: https://docs.searxng.org/dev/search_api.html
