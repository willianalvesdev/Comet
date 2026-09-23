# Ascenda

Site com Python, Flask, MySQL e Waitress, seguindo a estrutura do Rota Financeira.
O frontend continua usando HTML, CSS e JavaScript. O banco `ascenda_db` e a conta
`ascenda_app` são exclusivos deste projeto.

## Iniciar no Windows

1. Tenha Python 3.10+ e MySQL 8+ instalados, com o serviço MySQL iniciado.
2. Na primeira execução, abra `configurar_banco.bat`. Ele prepara `venv`, instala
   as bibliotecas e gera `.env` com chaves aleatórias. Informe o administrador do
   MySQL e sua senha na janela. A senha administrativa não é salva.
3. Abra `iniciar.bat` e acesse **http://127.0.0.1:5001**. Mantenha a janela aberta;
   Ctrl+C encerra o servidor. A porta 5001 evita conflito com o Rota Financeira.

Os iniciadores também reconhecem o Python disponibilizado pelo Codex nesta máquina.
O `.env` existente é preservado. Ajuste nele host, porta e credenciais se necessário.
Não abra os arquivos HTML diretamente nem use Live Server: o login depende do Flask.

## Contas

O cadastro valida nome, e-mail, senha (8 a 128 caracteres) e confirmação. Ao concluir,
o usuário entra na tela principal. O perfil mostra seu nome e e-mail e permite sair.
As páginas principal e de gráficos exigem autenticação. As sessões duram 8 horas,
são verificadas no MySQL e invalidadas ao sair. As senhas são armazenadas com hash
scrypt, e os formulários têm proteção CSRF e limite de tentativas por IP.

Gráficos e envio de mensagens continuam demonstrativos. O ditado usa o reconhecimento
de voz do navegador; a permissão de microfone permanece disponível.

## Verificação

Execute `venv\Scripts\python.exe -m unittest discover -s tests -v`.
Os testes de integração usam contas temporárias no banco configurado e removem apenas
essas contas ao final. Sem MySQL configurado, esses testes são marcados como ignorados.

## Notícias financeiras — Descobrir

A página `/descobrir.html` usa a [Marketaux](https://www.marketaux.com/documentation)
para buscar notícias financeiras em português, com imagens, datas e links para as
fontes. Crie uma conta no provedor, obtenha o token e execute `configurar_noticias.bat`.
Também é possível definir `MARKETAUX_API_TOKEN` diretamente no `.env`. Reinicie o
servidor depois de configurar. A chave nunca é enviada ao navegador.

Sem chave, a página mostra um estado de indisponibilidade, sem notícias fictícias.
O número de artigos por página respeita o plano da API; Carregar mais busca a página
seguinte (até 10). Há cache de 30 minutos por página, compartilhado entre visitantes
da mesma instância, e uma espera de 5 minutos após falhas. Se a API falhar, os dados
anteriores podem aparecer por até 24 horas, com aviso. Nenhuma busca ocorre em segundo
plano sem acesso à página. As curtidas ficam no navegador, separadas por usuário, e
não são sincronizadas entre dispositivos. Os testes usam respostas simuladas e não
consomem a cota da Marketaux.

## Publicação

Este backend precisa de hospedagem Python com MySQL; GitHub Pages hospeda apenas
arquivos estáticos. Em produção, use HTTPS, `SESSION_COOKIE_SECURE=true`, uma chave
secreta própria e `RATELIMIT_STORAGE_URI` compartilhado (por exemplo Redis) se houver
mais de uma instância. Não versione `.env`, o ambiente Python ou dados do banco.
