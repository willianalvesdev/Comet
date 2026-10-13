# Finanças: pontos de revisão após a migração

Este documento substitui o registro de revisão do backend anterior. As contagens
e resultados daquela revisão não são evidência sobre a implementação atual.
O fluxo funcional está descrito em `financial-interpretation.md`.

## Fronteiras atuais

- `frontend/controllers/financial-interpretation.ts` combina parser local,
  esclarecimentos e interpretação por IA.
- `frontend/controllers/financial-validation.ts` valida as ações antes de enviá-las.
- `frontend/controllers/financial-execution.ts` envia o lote e atualiza o contexto
  somente após confirmação e nova consulta dos registros.
- `server/finance/index.ts` recebe as rotas autenticadas do Next.js.
- `server/finance/model.ts` valida campos, datas, horários e valores decimais;
  dinheiro é calculado em centavos com BigInt.
- `server/finance/repository.ts` relê os alvos por conta, controla bloqueios,
  transação, idempotência, lixeira e auditoria no PostgreSQL.
- `server/finance/interpretation.ts` limita o contexto enviado ao provedor e
  valida a estrutura da interpretação retornada.

## Regressões que precisam continuar cobertas

A origem da identidade deve ser a sessão autenticada. Uma conta não pode consultar,
alterar nem selecionar transações de outra. Gravações exigem CSRF e validação em
runtime, mesmo quando a interface já validou o formulário.

Um lote inválido precisa reverter todas as alterações e os eventos de auditoria.
Repetições do mesmo UUID e conteúdo devem devolver o resultado confirmado sem nova
gravação; o mesmo UUID com conteúdo diferente deve ser recusado. As consultas e
os cálculos financeiros devem ignorar a lixeira.

A exclusão comum preserva registros; a restauração mantém o ID; a exclusão definitiva
exige a ação explícita e um alvo na lixeira. Valores monetários devem continuar
exatos no armazenamento e na execução; conversão para número ocorre apenas nos
dados de visualização dos gráficos.

Interpretações por IA não executam operações diretamente. Alvos, valores, categorias
e datas precisam passar pelas validações da interface e, depois, pela validação
independente do executor no servidor. Um contexto recente não representa todo o
histórico da conta e não autoriza selecionar registros por suposição.

## Verificação

Use `npm run test:server` e `npm run test:frontend`. Os testes de navegador usam o
servidor Next.js e respostas simuladas das APIs. Testes de persistência devem usar
PostgreSQL isolado; nunca uma base com dados importantes. O resultado de cada
execução, incluindo serviços que tenham sido simulados, deve acompanhar a entrega.