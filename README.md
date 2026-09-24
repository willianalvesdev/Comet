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
   Digite R + Enter para reiniciar o servidor ou S + Enter para encerrar. Ctrl+C também encerra. A porta 5001 evita conflito com o Rota Financeira.

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
