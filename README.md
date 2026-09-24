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

Gráficos e o envio de mensagens em Novo continuam demonstrativos. A página Computer tem chat local. O ditado usa o reconhecimento
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


## Computer — conversa com IA local

A página existente é `computer.html`. Seu layout inicial, menu, tema, campo de texto
e ditado foram mantidos. O envio usa `static/js/computer.js` (estado da conversa)
e `static/js/computer-service.js` (streaming da API interna). Apenas a área de
mensagens e os estados de resposta foram acrescentados ao conteúdo existente.

Fluxo: Computer → `POST /api/ai/chat` (Flask) → `ComputerService` →
`OllamaProvider` → `POST http://localhost:11434/api/chat`. O navegador não acessa
diretamente o Ollama. Não há serviço pago, fallback externo, ferramentas,
consultas financeiras nem acesso direto do modelo ao banco. O servidor salva o histórico
no MySQL e envia ao modelo apenas o contexto da conversa selecionada.

- Identidade e system prompt: `ascenda/ai/prompt.py`.
- Configuração e limites: `ascenda/ai/config.py`, com opções no `.env`.
- Validação de histórico e concorrência: `ascenda/ai/service.py`.
- Transporte local e leitura do streaming: `ascenda/ai/ollama.py`.
- Mensagens de erro: `ascenda/ai/errors.py`.

### Iniciar e conferir

1. Abra o Ollama (ou execute `ollama serve` se ele não estiver rodando).
2. Verifique a API no PowerShell:
   `Invoke-RestMethod http://localhost:11434/api/version`.
3. Instale a variante compatível com `ollama pull qwen3:4b-q4_K_M`.
   Execute `ollama list` para conferir os modelos instalados.
4. Configure `OLLAMA_BASE_URL` e `OLLAMA_MODEL` no `.env`, conforme `.env.example`.
5. Abra `iniciar.bat`, entre na sua conta e selecione Computer. Se o Ascenda já
   estiver aberto, use **R + Enter** na janela do iniciador para carregar as alterações.
6. Envie “Meu nome é Lia” e depois “Qual é meu nome?”. A resposta deve chegar
   progressivamente e usar o contexto da mesma aba.

**Modelo configurado:** `qwen3:4b-q4_K_M`, instalado e validado nesta máquina,
é o padrão de `OLLAMA_MODEL` no `.env`, no exemplo e na configuração do servidor.
A integração envia `think: true` e `stream: true`. O Computer mostra “Pensando…”
enquanto prepara a resposta e passa a exibir o texto progressivamente quando ela
começa. A seta ao lado de “Pensando…” abre um painel com o texto de thinking
transmitido pelo modelo em tempo real. O painel fica recolhido inicialmente e
permanece consultável após a resposta. Esse texto é salvo junto da conversa no MySQL,
separado da resposta, sem ser enviado como contexto nas próximas mensagens.
O limite por pensamento é de 48 mil caracteres.
Modelos que declarem não suportar thinking são recusados com aviso de configuração.
O modelo anterior e a cópia local `qwen3:4b-ascenda-backup` foram preservados.

Documentação: [API de chat](https://docs.ollama.com/api/chat),
[controle de thinking](https://docs.ollama.com/capabilities/thinking) e
[variantes oficiais Qwen3](https://ollama.com/library/qwen3/tags).

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
- Conta e CSRF continuam obrigatórios. O modelo, endereço e system prompt são
  definidos no servidor; o navegador não pode substituí-los.
- A inferência do chat acontece só no computador que hospeda o Ascenda. O ditado
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
`conversation_id`, `message` e um UUID `request_id`; o navegador não fornece o histórico.
Conexões MySQL são fechadas após cada gravação. Uma reserva por conversa evita respostas
simultâneas em abas/processos distintos. As respostas da API não são armazenadas em cache.

A lista Sessões aparece nas páginas internas. Cada conversa tem um menu de três pontos
para renomear ou excluir (com confirmação). Essas ações exigem sessão e CSRF, verificam
o proprietário e ficam bloqueadas enquanto a conversa tem uma resposta em andamento.
