# Arquivos e artefatos no chat

O Comet cria arquivos a partir de uma estrutura validada produzida pelo modelo selecionado. A criação não depende de APIs adicionais nem de um serviço de armazenamento externo. O provedor de IA e a pesquisa continuam sujeitos à configuração existente.

## Uso

Peça, por exemplo: “Crie uma planilha Excel com estes dados e um gráfico de barras”. Os arquivos aparecem em cards na resposta e na seção **Artefatos**, acima de **Fontes**. Clicar abre a prévia em um painel lateral que divide o espaço com a conversa, com seletor de formato, download, arraste da largura e expansão/restauração. Em celular a prévia ocupa a tela. Os arquivos ficam empilhados e cada linha possui menu de abertura/download. Planilhas mostram as abas. Tabelas Markdown têm divisórias verticais, cabeçalho que acompanha a rolagem até o fim da tabela e controles de copiar, baixar CSV e ampliar no canto inferior direito, visíveis no hover/foco e sempre disponíveis no toque.

- Planilhas: XLSX com várias abas e CSV da primeira aba.
- Documentos: PDF, DOCX e Markdown.
- Gráficos: barras, linhas e pizza, com PNG e SVG.
- Texto e código: TXT, MD, JSON, HTML, CSS, JS, TS, PY, SQL e YAML.

Arquivos de conversas salvas continuam disponíveis ao reabrir o chat e nas versões anteriores da resposta. É possível pedir uma nova versão utilizando os dados do arquivo anterior. No modo anônimo, os dados ficam na memória do navegador, acompanham a expiração da conversa e o endpoint rejeita arquivos vencidos. Fechar/recarregar a página pode encerrar essa sessão privada.

## Implementação

- `shared/artifact-types.d.ts` e `shared/artifacts.ts`: contratos, validação, CSV, SVG e contexto dos arquivos anteriores.
- `server/ai/artifacts.ts`: schema por tipo, geração de XLSX com OpenXML/fflate, PNG com Sharp e PDF/DOCX com o exportador existente. Sem novas dependências.
- `server/ai/search.ts`: pedidos explícitos usam geração JSON estruturada. O ciclo de ferramentas também aceita `create_artifact`. Todos os formatos precisam ser renderizados antes de informar sucesso. Em lotes, todos os artefatos são validados e gerados antes de publicar os cards.
- `server/ai/index.ts`: eventos NDJSON `artifact` e persistência dos metadados antes da confirmação. Downloads anônimos têm limite de concorrência separado da geração de respostas.
- `server/ai/conversations.ts`: propriedade da conversa, recuperação das versões e inclusão dos dados anteriores no contexto.
- `frontend/controllers/chat-artifacts.ts`: cards, seção lateral e prévia. `answer-content.ts` também renderiza tabelas Markdown.

A especificação e os metadados ficam junto à resposta, no armazenamento já existente. O download reconstrói os bytes da especificação salva. Não são criados blobs públicos ou arquivos permanentes avulsos no servidor. Excluir a conversa elimina o acesso aos seus artefatos.

### Rotas

- `GET /api/ai/conversations/:cid/artifacts/:id?format=xlsx`: exige autenticação e propriedade da conversa.
- `POST /api/ai/artifacts/render`: renderiza os dados temporários do modo anônimo; exige autenticação, CSRF e validade. Não grava esses dados no banco.

Downloads usam `private, no-store`, `nosniff` e Content-Disposition de anexo. HTML é exibido em iframe sandbox sem scripts, acesso ao documento pai ou rede. CSV neutraliza células textuais que poderiam ser interpretadas como fórmulas; XLSX grava textos como inline strings.

## Limites atuais

Até quatro artefatos por resposta; 60 mil caracteres por especificação e 120 mil por lote; 5 MB por arquivo. Planilhas: seis abas, 32 colunas, mil linhas por aba e 12 mil células. Gráficos: 60 pontos e seis séries; pizza tem uma série. O limite de tokens do modelo pode reduzir o volume útil.

A geração é estruturada: não executa Python/JavaScript, não recalcula fórmulas de Excel e não oferece edição direta de células. O modelo deve fornecer valores calculados; expressões são preservadas como texto. Edições pedidas no chat geram novos artefatos. O contexto de arquivos anteriores é limitado a 24 mil caracteres e ao orçamento da conversa. HTML é uma prévia estática. Os arquivos não equivalem a um ambiente de execução do Perplexity.

## Validação

- Testes de servidor cobrem arquivos reais, XML/ZIP, proteção de CSV, limites, saída estruturada, falha/cancelamento, propriedade, persistência, versões e expiração anônima.
- Testes de navegador cobrem desktop/celular, tabelas, prévia com abas, download, HTML isolado, ordem Artefatos/Fontes, navegação, streaming e expiração da conversa.
- Teste real com Ollama `qwen-turbo1.7:latest`: dados fictícios de passos produziram XLSX, CSV, gráfico PNG/SVG e documento PDF/DOCX/MD. Evidências locais em `artifacts/files-live/` e capturas em `artifacts/files-preview-*.png` (ignoradas pelo Git). Gemini/OpenRouter foram verificados com simulações, sem consumo de API externa nesta validação.

```sh
npm run build
npm run build:tests
node --env-file=.env --import tsx --test tests/server/ai-artifacts.test.ts tests/server/ai-research.test.ts tests/server/chat-exports.test.ts tests/server/ai-postgres.test.ts
node --test artifacts/tests/chat-navigation.test.cjs artifacts/tests/sidebar-edge.test.cjs
```
