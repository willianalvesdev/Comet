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

`comet/finance_execution.py` valida cada ação, usa a conta autenticada e executa o lote
em uma transação MySQL. Antes de cada update/delete/restore/permanent_delete, faz
SELECT por conta e ID com FOR UPDATE. Todos os alvos são conferidos e bloqueados em
ordem de ID, e todas as alterações são validadas antes da primeira gravação financeira.
Falhas revertem o lote inteiro, incluindo eventos de auditoria. Valores continuam
strings decimais na API e Decimal/DECIMAL no servidor/banco, sem float nas gravações.
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

Para bancos existentes, executar `configurar_banco.bat` com administrador MySQL:
acrescenta a coluna nullable se ausente e cria a tabela de operações. A conta do site
continua apenas com SELECT/INSERT/UPDATE/DELETE. O configurador é repetível e não
remove registros. Não executar somente CREATE TABLE IF NOT EXISTS em um banco antigo,
pois isso não acrescenta a coluna à tabela já existente.

Verificação: testes TypeScript cobrem linguagem, desfazer, ambiguidades e seleção de
excluídos; o teste de navegador passa pelo parser/composer/executor com respostas HTTP
controladas, incluindo perda da resposta e reenvio. `test_finance_execution.py` integra
rotas Flask, validação, execução e consultas reais em SQLite isolado na memória, com
adaptação explícita do dialeto MySQL. Confere rollback, idempotência, isolamento por conta,
CSRF e ausência da lixeira em totais/gráficos. Esse teste não simula os locks concorrentes
do MySQL. Não usa nem altera transações do usuário.

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
JSON estrito no servidor (sem chaves duplicadas/NaN), limites de tamanho/tempo, campos
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

`finance_audit.py` grava usando o mesmo cursor e a mesma transação da execução:
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

## Histórico das etapas anteriores

As seções abaixo registram as etapas anteriores à conexão da execução; referências a
“futuro”, “sem execução” ou “fora dos templates” descrevem o estado daquela etapa.

## Estrutura atual analisada

- Flask e MySQL no servidor; TypeScript estrito, scripts clássicos e Jinja na interface.
  Os fontes usam nomes kebab-case em `static/ts`; contratos globais ficam em
  `static/ts/types/*.d.ts`. Não há React nem store central.
- `Transaction` descreve os campos existentes: `kind` (`income`/`expense`),
  `amount` decimal em string, `description`, `category`, `occurred_on` e
  `external_id` opcional no contrato da interface. `StoredTransaction` acrescenta
  `id` string e `currency`. Esses modelos foram movidos, sem alterações, de
  `app.d.ts` para `finance.d.ts`, junto dos contratos de gráficos e respostas.
- `category` é texto livre de até 80 caracteres, com valor padrão vazio.
  Não há tabela nem catálogo fixo de categorias. Não foi criado enum artificial.
- `setup_banco.sql` define `finance_transactions`: conta (`usuario_id`), ID bigint,
  chave externa, tipo, DECIMAL(14,2), descrição, categoria, data e criação.
  A chave externa é única por conta. Não há lixeira, revisão ou auditoria.
- `comet/finance.py`: `validate_transaction` valida a entrada; `receive` cria
  com idempotência; `history` pagina; `summarize` e `dashboard` calculam os gráficos.
  `serialize` mantém dinheiro decimal em string e normaliza o título com
  `transaction_title`. Essa normalização existente não foi alterada.
  Não existem funções de alteração, exclusão, restauração ou exclusão permanente.
- APIs existentes em `comet/__init__.py`: GET `/api/finance/dashboard`, GET
  `/api/finance/transactions` (`limit`, `before`, retorno `next_cursor`) e POST
  `/api/finance/transactions`. POST exige `external_id`, sessão e CSRF; retorna
  201/200 para criação/repetição, 409 para conflito e 422 para dados inválidos.
  O usuário vem da sessão, não do corpo enviado pelo navegador.
- `finance-data.ts` mantém cursor e flags de carregamento no escopo da página.
  `api-data.ts` valida JSON recebido como `unknown`. `WorkspaceNavigation` controla
  montagem e limpeza; `finance:changed` recarrega totais e lista. O banco é a fonte
  persistente; não há transações em localStorage. `graph-composer.ts` continua
  apenas ajustando a caixa de texto e impedindo o envio.

## Contratos adicionados

`financial-interpretation.d.ts` reutiliza `Transaction` e `StoredTransaction`:

- `FinancialIntent`: intenção ainda incompleta. Pode conter campos parciais,
  referência textual e candidatos; candidatos não são alvos autorizados.
- `FinancialAction`: união discriminada por `type` com `create`, `update`,
  `delete`, `restore` e `permanent_delete`. Criação exige todos os campos do domínio;
  alteração exige pelo menos um campo; ações sobre registros exigem IDs não vazios.
  IDs, moeda e chave externa não são campos editáveis. Uma ação pode atingir vários
  IDs; a mesma alteração se aplica a todos eles.
- `ParserConfidence`: `high`, `medium` ou `low`, sem pontuações ou limites inventados.
- `PendingClarification`: pergunta pendente, texto original, intenção, motivo,
  campos faltantes e IDs candidatos. Confirmações também são representáveis.
- `FinancialContext`: data de referência, fuso, idioma, moeda, categorias livres,
  registros conhecidos, registros excluídos, eventos recentes e pergunta pendente.
  Flags de completude impedem tratar a página carregada como todo o histórico.
  O contexto futuro deve vir somente da conta autenticada, e não de outra sessão.
- `ParserResult`: união por `status`: `resolved`, `needs_clarification` ou
  `unrecognized`. Somente o primeiro contém uma ação completa.
- `FinancialParser`: assinatura pura `(text, context) => ParserResult`, sem
  implementação, chamadas de rede ou gravação.
- `TransactionHistoryEvent`: evento por registro, com ID, operação agrupadora,
  instante ISO e snapshots antes/depois coerentes com o tipo da ação. Exclusão
  permanente guarda apenas identificação e metadados, sem copiar os dados apagados.
  É um contrato futuro; `FinanceHistory` continua sendo a listagem atual, não auditoria.

`delete` representa futuramente exclusão recuperável; `restore` reverte essa
exclusão; `permanent_delete` é irreversível. Nada disso foi habilitado no servidor.
Uma ação resolvida não autoriza execução nem dispensa confirmação e validação.
Strings de dinheiro, datas e IDs continuam precisando de validação em runtime;
esses contratos não validam dados externos nem substituem os validadores existentes.
A futura criação deverá gerar a chave idempotente fora do parser antes de chamar
`receive`; não se extrai `external_id` do texto do usuário.

## Integração e limites desta etapa

Os dois arquivos de declarações entram automaticamente nos tsconfigs existentes.
Os consumidores atuais continuam usando os mesmos nomes globais. Não há novos
scripts carregados, dependências, endpoints, tabelas, store ou efeitos em runtime.
A próxima etapa pode implementar o parser contra `FinancialParser`; execução,
persistência de contexto/lixeira/eventos e validação das novas operações ficam
para etapas posteriores. Nenhuma regra de linguagem natural ou IA foi adicionada.

## Primeiro nível local implementado

`static/ts/financial-parser.ts` expõe `parseFinancialInput(input, context)` no
padrão de scripts clássicos do projeto. Não é carregado pelos templates nem
conectado ao composer: esta etapa só fornece a função pura para uso posterior.

As funções pequenas normalizam espaços, reconhecem o verbo inicial, extraem
valores, convertem reais em centavos inteiros com BigInt e montam a descrição.
A saída monetária continua sendo string decimal, compatível com Transaction.
São aceitos gastei, recebi, paguei e comprei. Para compras sem moeda explícita,
o preço precisa estar após `por`, evitando confundir quantidade e valor.
Milhares brasileiros, vírgula/ponto decimal, R$, real/reais/conto e mil são aceitos.
O limite monetário segue DECIMAL(14,2) do banco; zero e negativos não são aceitos.

Uma ação resolvida é sempre create. A data vem de context.reference_date e a
categoria permanece vazia; não há classificação automática. BRL é o padrão;
um contexto com outra moeda é recusado. Sem descrição, são usados Gasto,
Recebimento, Pagamento ou Compra. O parser não inventa identificação externa.

Valor ausente ou não identificável gera needs_clarification. Entradas inválidas,
negações, perguntas, datas explícitas e operações fora deste primeiro nível
não são executadas; casos detectados fora do escopo retornam unrecognized.
Uma pergunta pendente não é continuada neste nível. Seu ID de esclarecimento é
determinístico a partir do texto e não é um ID persistente de operação.

Os testes em tests/frontend/financial-parser.test.cts executam o JavaScript
compilado em um contexto Node sem DOM, fetch ou banco. Cobrem os exemplos,
formatos de dinheiro, quantidades, entradas recusadas e contexto preservado.
Executar npm run test:frontend inclui esses testes. Não há IA, gravação,
execução de ações ou alterações na interface.

## Datas e cálculos locais

O contexto aceita currentDate (AAAA-MM-DD), currentTime e timezone. O fuso
padrão é America/Sao_Paulo. currentTime pode ser um horário local HH:mm[:ss]
quando acompanhado de currentDate, ou um instante ISO com Z/offset, convertido
para o fuso informado. Se ambos forem fornecidos, devem indicar o mesmo dia local.
Contextos antigos com reference_date/time_zone continuam aceitos. Nenhuma função
consulta o relógio da máquina nem fixa a data atual; falta de referência válida
resulta em needs_clarification.

Hoje/ontem/anteontem e dias da semana são resolvidos por calendário. Um dia da
semana sem qualificador significa a ocorrência mais recente, incluindo hoje;
passada/passado exclui hoje. Dia isolado usa o mês atual se já ocorreu, senão o
anterior, inclusive na virada de ano. Dia e mês sem ano usam a ocorrência anual
mais recente. Datas inválidas não são normalizadas para outro dia. Datas futuras
pedem esclarecimento, de acordo com a criação atual de transações realizadas.
Sem data explícita, create usa o dia atual fornecido. Semana passada e mês passado
são reconhecidos como períodos ambíguos e pedem um dia exato; não inventam uma data.

São suportados um ajuste de juros/desconto (percentual ou valor fixo) e quantidade
inteira multiplicada por preço unitário com cada. Não há eval nem expressões
arbitrárias. O cálculo usa BigInt e centavos; percentuais admitem até duas casas.
O total final é arredondado ao centavo mais próximo, com empate para cima, e
validado contra DECIMAL(14,2). Totais nulos/negativos, estouro, descontos acima de
100% e cálculos compostos ambíguos não geram uma ação resolvida.

Testes com calendário fornecido cobrem os exemplos, limites de mês/ano, ano
bissexto, conversão de fuso, períodos ambíguos, precisão e arredondamento.
A interpretação segue sem IA, efeitos colaterais, integração de UI ou execução.

## Múltiplos eventos e compensações

O retorno `resolved` agora contém `actions`, uma tupla não vazia de FinancialAction.
Isso também vale para uma única ação; o campo singular action foi substituído.
Não existem consumidores de produção ligados ao parser; os testes foram adaptados.
Outros estados continuam sem ações para evitar executar apenas parte de uma frase.

`splitFinancialEvents` examina possíveis conectores e só inicia uma cláusula quando
há outro verbo financeiro, ou um novo preço seguido de local/origem/finalidade.
Vírgulas decimais, listas de itens e conectivos dentro das descrições são preservados.
O verbo pode ser herdado em “30 no almoço e 20 no ônibus”; o tipo muda quando surge
um verbo explícito. Uma data no início da frase é compartilhada; datas de cláusulas
específicas não sobrescrevem as demais.

`extractFinancialCompensation` identifica devoluções e marcadores explícitos de
retorno. `belongToSameFinancialEvent` exige despesa, ligação explícita e data
compatível. A orquestração também exige um único evento anterior: havendo mais de
um alvo possível, origem adicional ou referência a outra compra, retorna
needs_clarification, sem tentar escolher pelo valor ou pela proximidade.
Recebimentos simples de João, trabalho ou salário continuam independentes.

A compensação subtrai centavos inteiros do gasto e preserva sua descrição/data.
São reconhecidos de volta, reembolso, estorno, devolveram, recuperei, retornaram
e voltou. Perdi representa uma despesa. Retornos repetidos podem reduzir o mesmo
único gasto. Totais líquidos nulos ou negativos pedem esclarecimento, pois o modelo
atual exige valor positivo. Uma compensação em data explicitamente diferente também
pede esclarecimento, sem reescrever o histórico por suposição.

O processamento é conservador e limitado às estruturas testadas; não é compreensão
livre de linguagem nem IA. Continua sem chamadas de rede, gravação ou execução.

## Contexto conversacional

`financial-context.ts` acrescenta estado de linguagem, sem armazenamento paralelo:
`FinancialConversationState` guarda last_mentioned_transaction_ids,
last_created_transaction_ids, last_updated_transaction_ids,
last_deleted_transaction_ids, last_restored_transaction_ids, last_intent e
pending_clarification. Os nomes seguem o snake_case dos contratos existentes.
FinancialContext incorpora esses campos; createFinancialConversationState fornece
os valores iniciais. Os snapshots transactions/deleted_transactions continuam
sendo dados reais da conta, carregados pelo chamador a partir do armazenamento.

- parseFinancialInput retorna apenas ParserResult, como antes.
- parseFinancialTurn retorna `{result, context}` com um novo contexto, sem mutar
  o recebido. Guarda pergunta pendente e foco de referências resolvidas.
- rememberFinancialOperation deve ser chamado somente depois da confirmação do
  armazenamento, com os IDs devolvidos e snapshots atualizados. Valida presença
  única dos IDs na lista ativa ou excluída correspondente. A interpretação sozinha
  não preenche last_created/updated/deleted/restored_transaction_ids.

Fluxo: interpretar a criação, receber confirmação do armazenamento e seu ID,
atualizar o snapshot, chamar rememberFinancialOperation(context, 'create', [id]),
então interpretar “Na verdade foram 90”, “E foi anteontem” ou “Apaga ela”.
Não se tenta adivinhar o ID comparando descrição/valor da criação com registros.
Uma nova criação não confirmada limpa o foco anterior, evitando corrigir outro gasto.

Ela/ele/essa/essa compra/essa despesa/aquela/a anterior usam o foco do turno anterior.
Os dois exige dois referentes; essas exige um conjunto plural. A última significa
maior data occurred_on no histórico completo; empates pedem esclarecimento.
Não se supõe que IDs crescentes provem a ordem. Busca por nome usa descrição
normalizada exata, com filtro de data e tipo quando informados. Uma página parcial
não prova unicidade; a seleção contextual por IDs explícitos conhecidos independe
de ter todo o histórico carregado.

Pedidos ambíguos carregam candidatos reais (IDs e snapshots de exibição) e preservam
a operação, alterações e referência com data já resolvida. “A de 80” compara o
valor com os candidatos apresentados, relidos no snapshot atual, sem criar IDs.
Se desaparecerem, mudarem ou continuarem ambíguos, volta a perguntar. Snapshots
antigos na pergunta não autorizam ações. Respostas plurais podem selecionar o
conjunto apresentado. Correção com valor/data faltante também pode ser esclarecida;
criação simples sem valor preserva descrição/data enquanto aguarda o valor.

Correções de valor/data, exclusão e restauração apenas produzem ações tipadas.
Não há integração com IA, execução de update/delete/restore, persistência do estado
conversacional ou novos endpoints. O chamador deve isolar contexto e snapshots por
conta/sessão e atualizar os dados antes de cada turno; autorização, concorrência e
validação final continuam sendo responsabilidade do servidor na futura execução.
Os scripts financial-parser.js e financial-context.js devem estar ambos carregados
antes de chamar o parser; seguem fora dos templates nesta etapa.

Os testes simulam a confirmação do armazenamento com IDs reais da fixture e
vários turnos, incluindo seleção por valor, pronomes, dados parciais, IDs ausentes,
registros alterados, exclusão/restauração e ausência de efeitos nos snapshots.
