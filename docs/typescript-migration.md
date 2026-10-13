# Next.js, TypeScript e PostgreSQL

O frontend e o servidor agora pertencem à mesma aplicação Next.js. As páginas React
continuam usando os componentes e controladores TypeScript existentes. A navegação
interna mantém o menu lateral montado e encerra eventos e requisições da página anterior.

As rotas do servidor estão em `app/api/` e chamam os serviços em `server/`.
Autenticação, sessões, CSRF, conversas, personalização, anexos, finanças e notícias
são atendidos pelo Node.js. O PostgreSQL é acessado por consultas parametrizadas,
com transações, liberação das conexões e esquema em `setup_banco.sql`.

A produção usa `next build` e `next start`; não há exportação estática das páginas
nem proxy para outro backend. Os arquivos `.html` nas URLs são rotas do Next.js.
`/api/bootstrap` fornece os dados públicos da sessão à interface. Os dados privados
continuam protegidos nas próprias APIs.

`npm run build:tests` gera os módulos auxiliares e compila os testes de navegador.
A suíte inicia um processo Next.js de produção em uma porta livre e usa respostas
simuladas nas APIs, preservando a navegação e os recursos do build real. Os testes
de servidor ficam em `tests/server/`.

A instalação atual começa com PostgreSQL novo, conforme solicitado. Nenhuma cópia
de dados de outro banco é executada. As pastas de anexos não são removidas pela
migração. Consulte `README.md` para preparação, comandos e variáveis de ambiente.