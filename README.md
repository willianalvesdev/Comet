# Comet

Site com Python, Flask, MySQL e Waitress, seguindo a estrutura do Rota Financeira.
O frontend usa HTML, CSS e TypeScript, compilado para scripts JavaScript clássicos. O banco `comet_db` e a conta
`comet_app` são exclusivos deste projeto.

## Iniciar no Windows

1. Tenha Python 3.10+, Node.js 22+ com npm 10+ e MySQL 8+ instalados, com o serviço MySQL iniciado.
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

Os gráficos financeiros usam as transações armazenadas por usuário. A página Computer tem chat com Qwen local e Gemini.
O ditado usa o reconhecimento de voz do navegador; a permissão de microfone permanece disponível.

## Verificação

Execute `venv\Scripts\python.exe -m unittest discover -s tests -v`.
Os testes de integração usam contas temporárias no banco configurado e removem apenas
essas contas ao final. Sem MySQL configurado, esses testes são marcados como ignorados.

Instale as dependências locais com `npm ci`. Execute:

- `npm run typecheck`: checagem estrita do site e dos testes; gera apenas declarações em `artifacts/types`.
- `npm run build`: compila `static/ts` nos mesmos endereços de `static/js`.
- `npm run test:frontend`: compila e executa os testes `.cts` como CommonJS em `artifacts/tests`.
- `npm run watch`: recompila os scripts durante o desenvolvimento.

Os testes usam Playwright local e, no Windows, o Edge instalado. `BROWSER_PATH`
permite selecionar outro Chromium. As APIs são simuladas, sem contas reais nem
chamadas aos modelos. Não há lint configurado.

O iniciador executa `npm ci` na primeira utilização e quando o lockfile muda.
A compilação ocorre depois da verificação de instância duplicada. No comando R,
um build com erro mantém o servidor existente; `noEmitOnError` preserva os arquivos
JavaScript anteriores. Nenhuma ferramenta é instalada globalmente.

## Estrutura do projeto

- `comet/`: aplicação Flask, banco e serviços de IA.
- `templates/`: páginas Jinja; `partials/` contém lateral e configurações compartilhadas.
- `static/ts/`: fontes TypeScript; `static/js/`: saída gerada e biblioteca vendorizada.
- `static/`: também contém CSS, fontes e imagens.
- `scripts/`: preparação e inicialização do ambiente.
- `infra/`: configuração do SearXNG.
- `tests/`: testes do backend e frontend.
- `docs/`: documentação complementar.
- `instance/`: dados locais de execução.

Os arquivos `.bat` permanecem na raiz para facilitar o uso no Windows.
A localização dos templates não altera as URLs públicas das páginas.

## Organização do frontend

O site mantém HTML com templates Jinja e CSS. O TypeScript compila para scripts
clássicos ES2022, sem framework ou bundler. Edite os arquivos de `static/ts`;
não edite a saída gerada de `static/js`. Lightweight Charts 5.0.9 e suas licenças
continuam em `static/js/vendor`, com os tipos oficiais fixados na mesma versão.
`static/css/globals.css` centraliza fontes, cores, espaçamentos, raios, tamanhos de
ícones e durações em `:root`. Os estilos de cada página usam esses valores sem
alterar seus pontos de quebra. `templates/partials/sidebar.html` compartilha o
menu lateral das páginas autenticadas, mantendo a seleção da página atual.
Os demais componentes de `templates/partials/` compartilham o menu móvel, o fundo
clicável da lateral, o painel Descobrir e seu botão de abertura, além dos controles
de ditado e envio. As páginas os incluem com Jinja, sem duplicar o HTML nem mudar
os seletores usados pelo JavaScript. As caixas de mensagem mantêm suas diferenças
entre chat e finanças.

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

`templates/computer.html` organiza a conversa; `static/js/computer.js` controla seu estado e
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
estão em `comet/ai/config.py`. Sessão e CSRF continuam obrigatórios. Os textos
são renderizados sem executar HTML ou scripts enviados pelo usuário/modelo.

`comet/ai/conversations.py` controla propriedade, paginação, deduplicação,
regeneração e checkpoints. `comet/db.py` centraliza commit, rollback e liberação
de cursores. As conexões são fechadas também nos caminhos de falha. Interrupções
não deixam o estado da conversa preso em geração quando o stream é finalizado.

### Banco do histórico do Computer

`setup_banco.sql` cria `computer_conversas` e `computer_mensagens` de forma idempotente.
Em instalações existentes, execute `configurar_banco.bat` uma vez com o administrador
MySQL e depois reinicie pelo `iniciar.bat`. Nenhuma tabela existente é apagada.
O site usa apenas SELECT/INSERT/UPDATE/DELETE; a conta de execução não precisa de CREATE.
`comet/ai/conversations.py` controla propriedade, paginação, deduplicação e gravação.
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

A navegação entre Chat, Finanças, Descobrir e Recentes mantém a lateral no mesmo
documento. `workspace-navigation.js` substitui apenas `#workspace-page` e encerra
os eventos, requisições e temporizadores da página anterior antes de montar a próxima.

## Dados financeiros

A página Finanças usa registros de `finance_transactions`, isolados pela conta autenticada.
Execute `configurar_banco.bat` uma vez com o administrador do MySQL após esta atualização;
o configurador cria `finance_operations` e `finance_transaction_events` e acrescenta `deleted_at` às transações existentes, sem apagá-las. Reinicie o servidor.
A conta do site mantém apenas permissões de leitura e escrita, sem criação de tabelas.

O chat de Finanças interpreta primeiro no parser local. Somente quando falta confiança,
usa Gemini ou Ollama local (conforme o modelo selecionado) para produzir JSON, validado
antes da execução. Pedidos ambíguos exigem esclarecimento e não gravam parcialmente.
A chave Gemini fica no servidor. Não há conexão bancária automática.
Após a confirmação, o chat informa o que foi adicionado, alterado, removido ou restaurado.
Em caso de dúvida, pergunta qual transação escolher usando valores, descrições e datas.
Lotes são validados por inteiro antes de qualquer alteração financeira e gravados atomicamente.
A origem local/IA fica somente nos metadados internos de observabilidade.
As APIs exigem sessão autenticada e, para gravações, `X-CSRFToken` (meta `csrf-token` da página).
A identidade sempre vem da sessão:

- `POST /api/finance/transactions`: recebe e persiste uma transação.
- `POST /api/finance/interpret`: interpreta com IA usando contexto mínimo da conta; não grava transações.
- `POST /api/finance/actions`: executa um lote atômico com `operation_id` UUID e `actions`.
  Aceita create/update/delete/restore/permanent_delete; repetir o mesmo UUID e ações não duplica o pedido.
- `GET /api/finance/transactions?state=deleted`: lista a lixeira com a mesma paginação.
  Sem esse parâmetro, o histórico contém apenas registros ativos.
- `GET /api/finance/transactions?limit=30`: histórico em ordem de data e ID decrescentes;
  envie o `next_cursor` retornado em `before` para obter a próxima página (limite 100).
- `GET /api/finance/dashboard`: saldo, receitas e despesas do mês corrente, comparações,
  pequenas curvas mensais e série diária do gráfico.

Exemplo de corpo JSON para recebimento:

```json
{
  "external_id": "importacao-banco-2026-09-001",
  "kind": "income",
  "amount": "2500.50",
  "description": "Salário",
  "category": "Trabalho",
  "occurred_on": "2026-09-01"
}
```

`kind` aceita `income` ou `expense`; valores são positivos, em BRL, enviados como string
com ponto decimal e até duas casas, armazenados em DECIMAL(14,2). `category` é opcional.
`occurred_on` é a data efetiva (AAAA-MM-DD), de 1970 até hoje; o fechamento diário usa
UTC−03:00. Não são aceitos agendamentos futuros. `external_id` é obrigatório e único
por usuário: repetir o mesmo registro retorna 200 sem duplicar; reutilizá-lo com outros
valores retorna 409. Novos registros retornam 201 e dados inválidos retornam 422.

A exclusão comum define `deleted_at` em UTC; a restauração limpa esse campo e preserva o ID.
Somente pedidos explícitos produzem `permanent_delete`, e apenas registros na lixeira podem ser
apagados fisicamente. UPDATE de um registro excluído é recusado. Todos os cálculos ignoram a lixeira.
O saldo parte de zero e soma receitas menos despesas do histórico ativo;
não representa saldo bancário não importado. Receitas e gastos são totais do mês atual.
A comparação usa o mês anterior inteiro; para o saldo, usa o saldo no fim do mês anterior.
Se a base anterior for zero, a porcentagem aparece como “—”. Dias sem transações carregam
o saldo anterior. As velas representam abertura, máximo, mínimo e fechamento do saldo
por data, seguindo a ordem de registro dentro do dia; o volume é a soma movimentada em BRL.
Sem movimentações, o gráfico exibe uma linha cinza no zero e os totais ficam em zero. Falhas de conexão exibem erro,
sem substituir dados por exemplos. A página atualiza ao reabrir, reconectar ou receber
o evento `finance:changed`, emitido após a execução pelo chat; os números animam a atualização.


O histórico mínimo em `finance_transaction_events` registra criação, alteração,
exclusão, restauração e exclusão definitiva na mesma transação da gravação financeira.
Atualizações preservam somente os campos alterados antes/depois; reenvios não duplicam
eventos. Os eventos são apenas auditoria/debug/apoio à recuperação, sem participar dos
saldos ou gráficos. Detalhes em [interpretação financeira](docs/financial-interpretation.md).

A marca e o pacote Python agora são Comet (`comet`). Instalações existentes continuam usando os valores de banco do `.env`; chaves antigas de sessão, preferências e formatos de anexos/respostas são mantidas para compatibilidade. Serrif e Geist foram removidas; Kalice permanece para títulos e respostas serifadas, e Saans para interface e números.

### Troca automática do Gemini

Quando o Gemini retorna HTTP 429 antes de começar a resposta, o Comet tenta
`gemini-2.5-flash` e depois `gemini-2.5-flash-lite`, mantendo a pergunta, o histórico,
os anexos e a pesquisa. A mesma regra vale para a interpretação financeira.
`GEMINI_FALLBACK_MODELS` permite configurar a ordem (separada por vírgulas);
um valor vazio desativa a troca. O padrão funciona sem editar o `.env`.
Cada modelo é tentado uma vez por pedido, dentro do prazo total existente.
Não há troca após começar a transmitir, nem para falhas de autenticação,
bloqueios de segurança ou respostas inválidas. Se todos atingirem o limite,
o erro de cota é mantido. Reinicie o Comet para carregar mudanças no servidor.
As cotas continuam sendo as do projeto Google; a troca não renova cotas nem
altera faturamento. Projetos pagos seguem os preços da própria conta.
