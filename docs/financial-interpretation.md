# Interpretação e execução financeira

## Estado atual: parser local, fallback e execução separada

O chat de Finanças usa `interpretFinancialInput`: primeiro `parseFinancialTurn`, depois
fallback para IA somente quando a confiança local for insuficiente. A interpretação
validada passa por `validateFinancialActions` → `executeFinancialActions`.
O parser local continua puro: não grava nem faz chamadas de rede.
`financial-execution.ts` envia ações para POST `/api/finance/actions`, valida a resposta e
atualiza o contexto somente após consultar novamente o armazenamento. Histórico completo
ativo e excluído é carregado por paginação antes da interpretação; o relógio é fornecido
pelo chamador em America/Sao_Paulo. Esclarecimentos exibem candidatos reais e não executam ações.
O estado conversacional pertence à página e não é persistido em localStorage.

`server/finance/repository.ts` valida cada ação, usa a conta autenticada e executa o lote
em uma transação PostgreSQL. Antes de cada update/delete/restore/permanent_delete, faz
SELECT por conta e ID com FOR UPDATE. Todos os alvos são conferidos e bloqueados em
ordem de ID, e todas as alterações são validadas antes da primeira gravação financeira.
Falhas revertem o lote inteiro, incluindo eventos de auditoria. Valores continuam
strings decimais na API e centavos BigInt/NUMERIC no servidor/banco, sem float nas gravações.
UPDATE preserva campos não mencionados e recusa registros excluídos.

`StoredTransaction.deleted_at` segue o snake_case existente: null significa ativa;
data UTC significa lixeira. A listagem padrão e todos os cálculos filtram ativos.
GET `/api/finance/transactions?state=deleted` fornece a lixeira com paginação, sem criar
uma tela nova. `restore` limpa a marca e mantém todos os dados e o ID. “Desfaz” restaura
apenas a exclusão recente confirmada e inequívoca. Uma transação ausente nunca é recriada.

“Apague todas as transações” é resolvido localmente, sem IA: o composer carrega todas
as páginas do histórico; o parser seleciona todos os IDs ativos, inclusive receitas e
registros fora do período do gráfico. A exclusão usa uma única ação e uma transação
atômica no servidor. “Desfaz” restaura somente os IDs confirmados nessa exclusão,
preservando os itens que já estavam na lixeira. Histórico incompleto/inconsistente,
qualificadores não suportados e conjunto vazio não são enviados à IA para selecionar
um subconjunto. Conjunto vazio informa “Não há transações ativas para apagar.”

Uma única ação delete/restore pode conter mais de 100 IDs, mantendo a validação e
o limite HTTP existente de 64 KB; requisições excessivas são rejeitadas por inteiro.
Lotes mistos, updates e exclusões definitivas mantêm o limite de 100 alvos. O comando
coletivo simples não autoriza apagar definitivamente a lixeira.

Após uma operação com mais de 100 referências, uma nova criação explícita e independente
pode usar IA sem enviar o grupo antigo. O contexto completo permanece na página para
“Desfaz”; referências a esse grupo nunca são truncadas para caber no fallback. Pedidos
complexos dependentes de um grupo excessivo pedem uma seleção menor.

Só expressões explícitas (“definitivamente”, “permanentemente”, “para sempre”) geram
`permanent_delete`, com `confirmation: explicit_permanent_delete`. O servidor exige
esse discriminador e que o registro já esteja na lixeira. DELETE comum nunca é promovido
para exclusão definitiva. Pedidos ambíguos continuam exigindo esclarecimento.

Cada envio recebe UUID fora do parser. `finance_operations` armazena o hash das ações e
os IDs do resultado, sem copiar os dados das transações. Repetições com o mesmo UUID e
conteúdo devolvem o resultado já confirmado; conteúdo diferente retorna conflito.
O composer conserva UUID/ações ao repetir um envio com falha de conexão. Uma recusa
explícita permite reinterpretar o pedido consultando dados atuais. Não há retry automático.

Após atualizar os snapshots, `rememberFinancialExecution` registra os IDs confirmados,
inclusive múltiplas criações; `finance:changed` atualiza e anima totais e gráficos.
`financial-feedback.ts` formata o retorno somente depois da confirmação e atualização
do contexto: valor/descrição/data reais para uma criação, contagem para múltiplas criações
e confirmações curtas para alteração, exclusão e restauração. Ambiguidades mostram
candidatos reais com valor, descrição e data; mensagens técnicas recebidas são substituídas
por perguntas ou orientações simples. IDs, JSON e indicadores internos não vão para o texto.
“Aquela compra” utiliza o foco contextual, inclusive ao restaurar o mesmo registro.

Execute `configurar_banco.bat` com `DATABASE_URL` configurada para preparar o esquema
PostgreSQL de `setup_banco.sql`. O script é idempotente, aplica tudo em uma transação
e usa um bloqueio consultivo para impedir duas preparações simultâneas. Não apaga registros.

Os testes TypeScript da interface cobrem linguagem, desfazer, ambiguidades e seleção
de excluídos. A suíte de navegador usa o Next.js de produção com respostas de API
controladas. Os serviços e a persistência são verificados pelos testes em `tests/server/`.
Veja `README.md` para comandos; contagens históricas de testes não descrevem esta migração.
## Compras e correções em linguagem cotidiana

“Comprei um salgado de 10 reais hoje” gera uma despesa de 10,00 com descrição
Salgado. Preço com “de” é aceito para um item singular explícito e com moeda;
“dois salgados de 10 reais” continua pedindo o total ou a indicação “cada”.
“Lucrei” e “ganhei” com dinheiro explícito representam receita; “perdi” representa
despesa. Ganhar um objeto avaliado em dinheiro não é automaticamente receber dinheiro.
As regras também valem na separação de eventos e nas compensações “ganhei de volta”.

“Na verdade eu gastei 90” altera o tipo e o valor da transação indicada, preservando
sua descrição e data; só “na verdade eu gastei” corrige o tipo e mantém o valor já
registrado. Correções podem combinar valor e data. Alvo ambíguo exige seleção real.

“Na verdade foi de graça”, “grátis”, “gratuito” ou “sem custo” cancela a despesa indicada
por soft delete, permitindo Desfaz. Não modifica uma receita nem inventa o alvo.
O modelo monetário permanece estritamente positivo; não é criada uma transação zerada.

“Na verdade foi semana passada” pergunta o dia exato sem chamar IA. A pergunta mantém
o intervalo da semana anterior (segunda a domingo) e o alvo; uma resposta “quinta”
é resolvida dentro daquela semana, inclusive na virada de ano. Datas fora do intervalo
pedem esclarecimento; não se inventa uma data para preencher esse campo obrigatório.

## Confiança e encaminhamento do parser local

`ParserConfidence` agora é um objeto, sem nota nem limiar numérico. O resultado público
sempre contém intentCertain, amountCertain, dateCertain, typeCertain,
descriptionCertain, referenceCertain, calculationCertain, multiplePossibleTargets,
unknownNumbers e hasAmbiguity, mais canExecuteLocally, requiresFallback e reasons.
Os motivos são códigos tipados de campos/relações não resolvidos.

`parseLocally` aplica as regras existentes; `assessFinancialConfidence` combina suas
validações, campos faltantes, candidatos reais, números sem função identificada e
sinais de linguagem além das regras cobertas. `parseFinancialInput` é a porta pública:
só expõe `actions` quando o resultado está resolvido e todos os indicadores relevantes
permitem execução. Uma relação semântica não coberta remove as ações mesmo que uma
regra inicial tenha encontrado um valor. Não há execução parcial de frases compostas.

- `resolved`: canExecuteLocally=true, requiresFallback=false.
- `needs_fallback`: linguagem não resolvida ou relações incertas, sem actions.
- `needs_clarification`: mantém pergunta e candidatos reais, mas marca
  requiresFallback=true porque a interpretação ainda não pode executar localmente.
  A pergunta pendente tem prioridade: IA não recebe autorização para escolher entre
  transações reais ambíguas, inventar IDs ou preencher fatos ausentes por suposição.
- `unrecognized` com rejected_input: pedidos negados/hipotéticos, perguntas, moeda
  não suportada, entrada vazia ou excessiva. Não dispara fallback automático.

Indicadores de campos não aplicáveis são true: excluir não exige novo valor/tipo,
e criar não exige referência a ID anterior. Data padrão validada e descrição padrão
já suportadas são certezas locais. Categoria não participa da decisão: é opcional.
Quantidades, datas numéricas, juros e compensações reconhecidas não são números
sobrando. A quantidade de eventos resolvidos não significa múltiplos alvos ambíguos.

Os códigos de confiança são metadados de interpretação, não autorização de acesso
nem substituto da validação na execução. O parser continua puro e determinístico.
A orquestração separada usa esses indicadores para decidir o fallback. Quando a IA
não determina todos os dados, a interface mostra uma pergunta e conserva a intenção
no contexto, sem enviar ações incompletas à execução.
Os testes cobrem rotas locais, fallback, dados obrigatórios incertos, categoria,
contexto, linguagem incomum e ausência de gravação pela interface nesses casos.

## Fallback para IA

`financial-ai.ts` chama POST `/api/finance/interpret` somente após falha de confiança
local. Ambiguidade conhecida entre transações reais continua pedindo escolha ao usuário,
sem solicitar à IA que escolha um alvo. Categoria desconhecida não provoca fallback.
A origem fica em `FinancialInterpretationTurn.metadata.parserSource` (`local`/`ai`),
separada dos indicadores de confiança. O composer emite `finance:interpreted` com esses
metadados, e o evento `finance:changed` mantém a mesma informação após sucesso.
São eventos internos para observabilidade, sem logs de valores, texto ou IDs e sem
persistência adicional. A interface não exibe os metadados; reenvios reutilizam a
interpretação e a identificação da operação original.

O servidor autentica a conta, exige CSRF, limita chamadas e relê o banco antes de
preparar o contexto. Envia apenas data/hora/fuso atuais, até 100 categorias existentes,
20 registros ativos e 20 excluídos mais até 100 IDs referenciados na conversa, contexto,
pergunta pendente e texto. IDs são filtrados pela conta; chave externa e identidade da
conta não entram no prompt. O recorte não prova que uma busca abrange todo o histórico.
Não há envio do histórico de auditoria nem persistência de prompts/respostas financeiros.

O provedor selecionado no composer é respeitado: Gemini usa a API do Google com chave
somente no servidor; Computer usa o modelo já configurado no Ollama local. Ambos recebem
`static/schemas/financial-interpretation.json` como schema de saída. Não são fornecidas
ferramentas, pesquisa, execução de código, acesso ao banco ou operações CRUD à IA.
Ollama recusa modelos remotos e contexto excessivo em vez de truncar referências.

O prompt de sistema é fixo; USER_INPUT e os demais campos chegam em uma mensagem
separada, como dados JSON não confiáveis. Essa separação é acompanhada de validações:
JSON validado no servidor, limites de tamanho/tempo, campos
exatos, enumerações e consistência entre status, ações e esclarecimento. Na interface,
a resposta entra como `unknown`, passa pela validação estrutural existente e depois
pela validação de negócio antes de virar `FinancialAction`. Não foi necessário adicionar
Zod: os validadores existentes já verificam tipos em runtime.

A validação de negócio exige valores decimais positivos, evidência de valor no texto,
datas reais, categorias fornecidas e IDs presentes no conjunto correto de ativos/lixeira.
Criação exige ID nulo; exclusão/restauração não alteram campos; exclusão definitiva exige
pedido explícito. Referências contextuais limitam os alvos permitidos. Campos obrigatórios
incertos, falha de rede, saída inválida ou uma única ação inválida rejeitam o lote inteiro
e produzem uma pergunta. Uma interpretação nunca grava dados diretamente; o executor
continua relendo os alvos e executando as ações atomicamente na conta autenticada.

Testes com respostas simuladas cobrem seleção local/IA, esclarecimentos, referências,
JSON inválido, instruções embutidas, IDs/categorias inventados, exclusões, lotes mistos,
falhas de rede, isolamento de conta e requisições estruturadas para os dois provedores.
O teste de navegador confere o fluxo composer → interpretação → execução, incluindo
reenvio idempotente e bloqueio de lotes inválidos. Os testes não chamam serviços reais.

## Histórico mínimo de operações

`finance_transaction_events` é um registro de auditoria separado. A fonte de verdade
continua sendo `finance_transactions`; nenhum cálculo, parser ou listagem financeira
consulta os eventos. Não há reconstrução automática de saldo por eventos.

`server/finance/repository.ts` grava usando a mesma conexão e a mesma transação da execução:
falha no evento reverte a alteração, e falha posterior no lote também reverte os eventos.
O reenvio idempotente retorna antes de gravar novamente. O caminho existente de importação
`receive` também registra a criação; nesse caso `operation_id` é null.

Cada linha contém conta, ID do evento, operação (quando houver), ID da transação,
evento, `occurred_at` UTC e `before_json`/`after_json`. O contrato TypeScript
`TransactionHistoryEvent` representa esses dados com `before`/`after` e nomes de evento:

- TRANSACTION_CREATED: before null; after contém os campos financeiros iniciais,
  sem repetir ID, moeda fixa, conta ou chave de importação.
- TRANSACTION_UPDATED: apenas campos cujo valor realmente mudou, nos dois lados.
  Valores são strings decimais. Atualizações sem mudança registram objetos vazios.
- TRANSACTION_DELETED: deleted_at de null para o instante exato gravado no registro.
- TRANSACTION_RESTORED: deleted_at do instante anterior para null.
- TRANSACTION_PERMANENTLY_DELETED: somente metadados; before/after null.

O histórico anterior permanece após exclusão definitiva para auditoria; não existe
foreign key para a transação que possa apagá-lo em cascata. A conta continua isolada
por usuario_id, e remover a conta remove seus eventos. Não foi criada tela nem API de
histórico nesta etapa. Para investigar um registro, consultar a tabela por usuario_id
e transaction_id, em ordem de id (índice existente). Eventos não alteram permissões,
não autorizam restaurações e não substituem a consulta à transação atual.

Executar `configurar_banco.bat` cria a tabela de eventos de forma aditiva. Não há
backfill: registros existentes não recebem datas ou eventos históricos inventados.
Os testes de integração cobrem os cinco eventos, diferenças mínimas, timestamp do
soft delete, reenvio, rollback, falha de auditoria, importação e independência dos totais.
