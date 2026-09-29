# Ascenda

Site com Python, Flask, MySQL e Waitress, seguindo a estrutura do Rota Financeira.
O frontend continua usando HTML, CSS e JavaScript. O banco `ascenda_db` e a conta
`ascenda_app` são exclusivos deste projeto.

## Iniciar no Windows

1. Tenha Python 3.10+ e MySQL 8+ instalados, com o serviço MySQL iniciado.
2. Na primeira execução, abra `configurar_banco.bat`. Ele prepara `venv`, instala
   as bibliotecas e gera `.env` com chaves aleatórias. Informe o administrador do
   MySQL e sua senha na janela. A senha administrativa não é salva.
3. Abra `iniciar.bat`: o site abre automaticamente no navegador quando o servidor está pronto. O endereço padrão é **http://127.0.0.1:5001**. Reiniciar com R não abre outra aba. Mantenha a janela aberta;
   Digite R + Enter para reiniciar o servidor ou S + Enter para encerrar. Ctrl+C também encerra. A porta 5001 evita conflito com o Rota Financeira.

Os iniciadores também reconhecem o Python disponibilizado pelo Codex nesta máquina.
O `.env` existente é preservado. Ajuste nele host, porta e credenciais se necessário.
Não abra os arquivos HTML diretamente nem use Live Server: o login depende do Flask.

## Contas

O cadastro valida nome, e-mail, senha (8 a 128 caracteres) e confirmação. Ao concluir,
o usuário entra na tela principal. O perfil mostra seu nome e e-mail e permite sair.
As páginas principal e de gráficos exigem autenticação. As sessões duram 30 dias,
são verificadas no MySQL e invalidadas ao sair. As senhas são armazenadas com hash
scrypt, e os formulários têm proteção CSRF e limite de tentativas por IP.

Os dados do gráfico continuam demonstrativos. A página Computer tem chat com Qwen local e Gemini.
O ditado usa o reconhecimento de voz do navegador; a permissão de microfone permanece disponível.

## Verificação

Execute `venv\Scripts\python.exe -m unittest discover -s tests -v`.
Os testes de integração usam contas temporárias no banco configurado e removem apenas
essas contas ao final. Sem MySQL configurado, esses testes são marcados como ignorados.

Os testes do frontend exigem Node.js e Playwright disponível ao Node:
`node --test tests/frontend/navigation.test.cjs`. No Windows, usam o Edge instalado;
`BROWSER_PATH` permite selecionar outro executável Chromium. `PLAYWRIGHT_MODULE`
pode apontar para uma instalação existente do Playwright. Os testes usam dados
simulados, sem contas reais ou chamadas aos modelos.

## Organização do frontend

O site mantém HTML com templates Jinja, CSS e JavaScript, sem etapa de compilação.
`static/css/globals.css` centraliza fontes, cores, espaçamentos, raios, tamanhos de
ícones e durações em `:root`. Os estilos de cada página usam esses valores sem
alterar seus pontos de quebra. `templates/partials/sidebar.html` compartilha o
menu lateral das páginas autenticadas, mantendo a seleção da página atual.

As listas atualizam a seleção sem reconstruir seus elementos. Observadores de
DOM limitam as buscas aos elementos alterados; o navegador de mensagens atualiza
apenas os indicadores anterior e atual.

## Notícias — Descobrir

A página usa a [NewsAPI](https://newsapi.org/docs) para notícias internacionais de
assuntos variados. Configure `NEWS_API_KEY` no `.env` ou execute
`configurar_noticias.bat` e reinicie o servidor. A chave permanece no servidor.
A API gratuita é destinada a desenvolvimento; produção requer plano apropriado.

O padrão é finanças em português e inglês. O menu Tópicos do próprio Descobrir
seleciona o assunto; o menu do perfil não contém mais preferências de notícias.
Top ordena pela popularidade das fontes. Português e inglês usam duas consultas
por página, intercaladas no feed.
Crimes, violência e conteúdo adulto continuam filtrados por termos, sem garantia
absoluta. Só aparecem notícias com imagens que carregam.

Há cache de 30 minutos por página, tópico e ordenação (até 64 entradas), pausa de
5 minutos após erros e uso do cache anterior por até 24 horas com aviso. São buscadas
até 10 páginas, respeitando os limites do plano. Os testes usam respostas simuladas.

O clima usa Open-Meteo com previsão de cinco dias. O botão Usar minha localização
pede permissão ao navegador. Após a permissão, latitude e longitude arredondadas a
duas casas decimais são enviadas ao Open-Meteo para obter a previsão da região.
A localização aproximada e a previsão ficam em cache no navegador por conta. Geolocalização exige HTTPS ou
localhost. A página informa recusas, indisponibilidade e tempo esgotado.

## Publicação

Este backend precisa de hospedagem Python com MySQL; GitHub Pages hospeda apenas
arquivos estáticos. Em produção, use HTTPS, `SESSION_COOKIE_SECURE=true`, uma chave
secreta própria e `RATELIMIT_STORAGE_URI` compartilhado (por exemplo Redis) se houver
mais de uma instância. Não versione `.env`, o ambiente Python ou dados do banco.


## Computer — conversa com Qwen local e Gemini

`computer.html` organiza a conversa; `static/js/computer.js` controla seu estado e
`static/js/computer-service.js` lê os eventos da API interna. A geração passa por
`POST /api/ai/chat`, `ComputerService` e o provedor escolhido. As chaves permanecem
no servidor. O modo inicial da interface é Gemini. Computer seleciona inicialmente
`qwen3:4b-instruct-2507-q4_K_M`, apresentado como **4b no-think**.

Os outros modelos locais disponíveis são 1.7b, 4b e 8b. Gemma foi removido do catálogo.
Mantenha o Ollama em execução para os modelos locais; `OLLAMA_MODEL` e
`OLLAMA_BASE_URL` configuram o provedor local do servidor. Gemini usa
`GEMINI_API_KEY` e `GEMINI_MODEL` no `.env` privado. Reinicie pelo `iniciar.bat`
ou com **R + Enter** para carregar mudanças dessas configurações.

### Pesquisa e respostas

Todos os modelos locais podem pesquisar pelo SearXNG. Gemini pesquisa somente com
o Google Search da própria API. Pedidos explícitos de pesquisa acionam a busca,
inclusive no 4b no-think. Não há troca automática de buscador quando uma busca falha.
Veja `infra/searxng/README.md` para iniciar o serviço local.

A data e o horário atuais do servidor acompanham o contexto de cada geração.
O contexto local é limitado sem apagar mensagens salvas. As fontes consultadas
ficam no painel lateral e na aba Links, com títulos, trechos e favicons; listas de
referências repetidas no texto da resposta são removidas.

A interface alterna entre Pensando e Pesquisando durante o processamento. A resposta
é recebida por completo antes da apresentação com velocidade fixa e animação de
cor/opacidade. Respostas sem pensamento e concluídas em menos de três segundos
recebem o indicador Instantâneo. O botão Reescrever gera novamente a resposta;
falhas preservam a versão anterior. Copiar exibe uma confirmação por ícone, e os
botões de avaliação indicam a seleção.

### Histórico e modo anônimo

As conversas comuns são salvas no MySQL por conta. Recentes permite abrir, fixar,
renomear e excluir conversas. A lista carrega 50 conversas por página; o histórico,
30 envios por página. A aba do navegador mostra somente o título do chat.

O modo anônimo pode ser ativado em um chat novo. Seu histórico existe apenas na
página atual, não é persistido no banco nem usado na memória da conta e desaparece
ao sair. Anexos ficam indisponíveis nesse modo.

Enter envia e Shift + Enter cria uma linha. A caixa cresce até dez linhas antes de
rolar. Durante a geração, o botão de envio permite interromper. O navegador lateral
indica uma mensagem por vez e centraliza a mensagem selecionada na tela.

As mensagens aceitam até 8 mil caracteres; limites de contexto, resposta e tempo
estão em `ascenda/ai/config.py`. Sessão e CSRF continuam obrigatórios. Os textos
são renderizados sem executar HTML ou scripts enviados pelo usuário/modelo.

`ascenda/ai/conversations.py` controla propriedade, paginação, deduplicação,
regeneração e checkpoints. `ascenda/db.py` centraliza commit, rollback e liberação
de cursores. As conexões são fechadas também nos caminhos de falha. Interrupções
não deixam o estado da conversa preso em geração quando o stream é finalizado.

### Banco do histórico do Computer

`setup_banco.sql` cria `computer_conversas` e `computer_mensagens` de forma idempotente.
Em instalações existentes, execute `configurar_banco.bat` uma vez com o administrador
MySQL e depois reinicie pelo `iniciar.bat`. Nenhuma tabela existente é apagada.
O site usa apenas SELECT/INSERT/UPDATE/DELETE; a conta de execução não precisa de CREATE.
`ascenda/ai/conversations.py` controla propriedade, paginação, deduplicação e gravação.
GET `/api/ai/conversations` lista somente conversas da conta autenticada; GET
`/api/ai/conversations/<id>` recupera seus envios. POST `/api/ai/chat` recebe somente
`conversation_id`, `message`, um UUID `request_id` e `provider` (`qwen` ou `gemini`, padrão `qwen`); o navegador não fornece o histórico.
Conexões MySQL são fechadas após cada gravação. Uma reserva por conversa evita respostas
simultâneas em abas/processos distintos. As respostas da API não são armazenadas em cache.

A lista Recentes aparece nas páginas internas. Cada conversa tem um menu de três pontos
para renomear ou excluir (com confirmação). Essas ações exigem sessão e CSRF, verificam
o proprietário e ficam bloqueadas enquanto a conversa tem uma resposta em andamento.

Testes das APIs sem consumir créditos: `venv\Scripts\python.exe -m unittest discover -s tests -p test_remote_ai.py -v`.


### Personalização e memória por conta

O menu do perfil abre **Todas as configurações**, com Personalização e Configurações
de memória separadas. Conta, Preferências e Notificações ficam reservadas para depois.
Nome preferido, ocupação, empresa, nascimento, gênero, instruções, localização opcional
e preferências de resposta são usados no contexto de Qwen e Gemini. A localização
é solicitada apenas ao clicar em Compartilhar e arredondada a duas casas decimais.
As preferências adicionais ficam em um envelope JSON versionado na coluna `sobre`,
compatível com o texto dos perfis antigos, sem exigir uma nova migração.
`/personalizar.html` redireciona para a janela de configurações.
Sem nome preferido, o nome do cadastro é usado. O histórico continua separado por
conversa, mas o resumo de memória acompanha a conta em todas elas.

A memória começa ativada e vazia. Após uma resposta concluída, registra declarações
pessoais explícitas das novas mensagens (por exemplo, “Sou estudante”, “Moro em
Recife” e “Prefiro respostas curtas”). A extração é conservadora, baseada em padrões:
não entende toda formulação, não resume todo o histórico anterior e não deduz fatos
pelas respostas da IA. O resumo é editável e limitado a 6.000 caracteres; ao atingir
o limite, pode ser reduzido na página. Os dados não são compartilhados entre contas.

Desativar e salvar impede novas memórias e omite o resumo do contexto das próximas
mensagens. Os campos de perfil continuam ativos. Limpar e salvar apaga o resumo;
as conversas continuam salvas, mas não são reimportadas automaticamente. Desativar
não remove informações já presentes no histórico da conversa aberta.

`computer_personalizacao` é criada pelo `configurar_banco.bat`. GET/PUT
`/api/ai/personalization` exige sessão e PUT exige CSRF; a versão impede sobrescrever
memórias alteradas em outra aba ou por uma resposta simultânea. A tabela é removida
em cascata com a conta. O nome de modelo/credenciais nunca são editáveis neste endpoint.


### Gemini e anexos

O seletor oferece Gemini (modo inicial, API externa) e Computer (modelos Qwen locais).
O botão + e Ctrl+V no campo do chat enviam até quatro anexos por mensagem (8 MB cada): PNG/JPG/WebP,
PDF com texto selecionável (até 40 páginas), DOCX e texto UTF-8.
Documentos têm limite de 20 mil caracteres cada e 30 mil em conjunto. Imagens são
normalizadas para JPEG de até 1600 px, sem metadados. Arquivos ficam privados em
`instance/attachments/<usuario>/`; a referência fica junto à mensagem no banco,
sem migração. Faça backup dessa pasta junto com o banco.
Ao anexar arquivos, o chat seleciona automaticamente o Gemini e envia as imagens
e o texto extraído dos documentos à API, usando `GEMINI_API_KEY` e `GEMINI_MODEL`.
Respostas que usam anexos do histórico também são processadas pelo Gemini.
O histórico inclui o conteúdo dos anexos dentro dos limites
de contexto e no máximo quatro imagens. A exclusão de uma conversa remove seus
anexos que não estejam referenciados em outra conversa.

Os cartões de anexos mostram nome, tamanho e miniatura de imagem. O endpoint
`GET /api/ai/attachments/<token>/preview` exige a conta proprietária do anexo e
responde com `Cache-Control: private, no-store`.
