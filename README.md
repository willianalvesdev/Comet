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

Gráficos e o envio de mensagens em Novo continuam demonstrativos. A página Computer tem chat com Qwen local e Gemini. O ditado usa o reconhecimento
de voz do navegador; a permissão de microfone permanece disponível.

## Verificação

Execute `venv\Scripts\python.exe -m unittest discover -s tests -v`.
Os testes de integração usam contas temporárias no banco configurado e removem apenas
essas contas ao final. Sem MySQL configurado, esses testes são marcados como ignorados.

## Notícias — Descobrir

A página usa a [NewsAPI](https://newsapi.org/docs) para notícias internacionais de
assuntos variados. Configure `NEWS_API_KEY` no `.env` ou execute
`configurar_noticias.bat` e reinicie o servidor. A chave permanece no servidor.
A API gratuita é destinada a desenvolvimento; produção requer plano apropriado.

O padrão é finanças em português e inglês. Em Perfil → Notícias, o usuário pode
escolher assuntos e permitir todos os idiomas. As preferências ficam salvas no
navegador por usuário e valem tanto para Para Você quanto para Top. Top ordena por
popularidade das fontes. Português e inglês usam duas consultas por página,
intercaladas no feed; todos os idiomas usa uma consulta sem restrição de idioma.
Crimes, violência e conteúdo adulto continuam filtrados por termos, sem garantia
absoluta. Só aparecem notícias com imagens que carregam.

Há cache de 30 minutos por página, tópico e ordenação (até 64 entradas), pausa de
5 minutos após erros e uso do cache anterior por até 24 horas com aviso. São buscadas
até 10 páginas, respeitando os limites do plano. Os testes usam respostas simuladas.

O clima usa Open-Meteo com previsão de cinco dias. O botão Usar minha localização
pede permissão ao navegador. Após a permissão, latitude e longitude arredondadas a
duas casas decimais são enviadas ao Open-Meteo para obter a previsão da região.
Essas coordenadas não ficam salvas no navegador. Geolocalização exige HTTPS ou
localhost. A página informa recusas, indisponibilidade e tempo esgotado.

## Publicação

Este backend precisa de hospedagem Python com MySQL; GitHub Pages hospeda apenas
arquivos estáticos. Em produção, use HTTPS, `SESSION_COOKIE_SECURE=true`, uma chave
secreta própria e `RATELIMIT_STORAGE_URI` compartilhado (por exemplo Redis) se houver
mais de uma instância. Não versione `.env`, o ambiente Python ou dados do banco.


## Computer — conversa com Qwen local e Gemini

A página existente é `computer.html`. Seu layout inicial, menu, tema, campo de texto
e ditado foram mantidos. O envio usa `static/js/computer.js` (estado da conversa)
e `static/js/computer-service.js` (streaming da API interna). Apenas a área de
mensagens e os estados de resposta foram acrescentados ao conteúdo existente.

Fluxo: Computer → `POST /api/ai/chat` (Flask) → `ComputerService` →
`OllamaProvider` (Qwen local, padrão) ou `RemoteProvider` (API Gemini). O navegador não recebe as chaves.
Não há troca automática de provedor, ferramentas,
consultas financeiras nem acesso direto do modelo ao banco. O servidor salva o histórico
no MySQL e envia ao modelo apenas o contexto da conversa selecionada.

- Identidade e system prompt: `ascenda/ai/prompt.py`.
- Configuração e limites: `ascenda/ai/config.py`, com opções no `.env`.
- Validação de histórico e concorrência: `ascenda/ai/service.py`.
- Transporte HTTPS e leitura do streaming: `ascenda/ai/remote.py`.
- Mensagens de erro: `ascenda/ai/errors.py`.

### Escolher Qwen ou Gemini

O Computer abre com Qwen local (`qwen3:4b-q4_K_M`) selecionado. Mantenha o Ollama
em execução; `OLLAMA_MODEL` e `OLLAMA_BASE_URL` preservam a configuração anterior.
O menu permite mudar para Gemini e voltar para Qwen na mesma conversa, mantendo
o histórico. Recarregar a página restaura Qwen como padrão.

### Configurar Gemini

No `.env` privado, preencha `GEMINI_API_KEY`, criada no Google AI Studio.
Nunca coloque essa chave no HTML/JavaScript ou no Git.
O Gemini é opcional no menu Modelo. O identificador do modelo fica
no servidor: `GEMINI_MODEL=gemini-3.8-flash`. A versão 2.5 Flash não está mais
acessível para novas contas; a API recomenda a versão 3.8 Flash.

Gemini tem faixa gratuita sujeita às cotas da conta. Uma chave de projeto com
faturamento ativo segue o plano desse projeto. O site não habilita faturamento,
compra créditos ou troca de provedor automaticamente.

Abra `iniciar.bat` ou use **R + Enter** para carregar as chaves/alterações.
Entre na conta, abra Computer e envie uma mensagem. A pergunta e o contexto da
conversa selecionada são enviados ao modelo escolhido. Somente a opção Gemini
usa a API externa. O prompt da identidade Computer
permanece em `ascenda/ai/prompt.py`.

O adaptador `ascenda/ai/remote.py` usa HTTPS e streaming da API oficial Gemini
GenerateContent, com a chave somente em cabeçalhos privados. Exibe “Pensando…” e
os resumos de raciocínio disponibilizados pela API, sem inventar um pensamento.
Os resumos ficam separados da resposta no histórico MySQL e não são reenviados
como contexto. O Qwen transmite o thinking pelo Ollama local.

Documentação: [Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
e [preços Gemini](https://ai.google.dev/gemini-api/docs/pricing?authuser=3).

### Comportamento e limites desta etapa

- Enter envia; Shift + Enter cria uma linha. Durante a resposta, o botão de envio
  permite interromper. O botão de certo do ditado continua encerrando apenas a voz.
- Conversas, mensagens, respostas e thinking são salvos no MySQL, vinculados à conta.
  Ao abrir Computer, a conversa mais recente é restaurada. A lista Sessões no menu lateral permite retomar
  outras conversas e “Nova conversa” começa um histórico separado.
  A lista carrega 50 conversas por página; o histórico, 30 envios por página.
  O modelo recebe até 39 mensagens / 48 mil caracteres mais o system prompt,
  montados no servidor somente com turnos concluídos da conversa selecionada.
  Conversas que já foram perdidas antes desta implementação não são recuperáveis.
- Cada mensagem aceita até 8 mil caracteres e cada resposta até 16 mil.
  A resposta tem espera por leitura de 120 segundos (configurável) e duração
  limitada a cerca de 5 minutos. São permitidas até duas gerações simultâneas,
  uma por usuário e dez solicitações por minuto por IP, nesta instância.
- As respostas são exibidas como texto seguro, sem executar HTML, scripts ou
  comandos. Não há renderização de Markdown nesta etapa.
- A pergunta é salva antes da geração e as respostas recebem checkpoints durante
  o streaming. A confirmação de conclusão só chega depois da gravação no banco.
  Falhas e interrupções preservam o conteúdo recebido e são identificadas no histórico;
  esses turnos não entram no contexto seguinte. Não há repetição automática de pedidos.
  Após uma falha de conexão, “Atualizar histórico” confere o que foi salvo antes de reenviar.
  Se o processo for encerrado abruptamente, até cerca de um segundo de texto pode se perder.
  Uma geração abandonada expira após seis minutos e aparece como interrompida.
- Conta e CSRF continuam obrigatórios. O navegador escolhe apenas o provedor permitido; modelo, endereço e system prompt são
  definidos no servidor.
- A inferência do chat acontece localmente com Qwen ou na API Gemini, conforme a escolha. O ditado
  já existente usa a API de voz do navegador, que pode utilizar seu próprio serviço;
  ele não foi convertido em reconhecimento de voz local nesta tarefa.

Testes isolados do chat: `venv\Scripts\python.exe -m unittest discover -s tests -p test_computer.py -v`.
Os testes cobrem autenticação, CSRF, histórico, streaming, cancelamento, limites,
respostas inválidas, modelo ausente, timeout, incompatibilidade e conexão recusada.

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

A lista Sessões aparece nas páginas internas. Cada conversa tem um menu de três pontos
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

O seletor oferece Qwen (padrão, local) e Gemini (API externa).
O botão + do chat envia até quatro anexos por mensagem (8 MB cada): PNG/JPG/WebP,
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
