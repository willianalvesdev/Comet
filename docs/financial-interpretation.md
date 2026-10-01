# Base para interpretação financeira

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
- `ascenda/finance.py`: `validate_transaction` valida a entrada; `receive` cria
  com idempotência; `history` pagina; `summarize` e `dashboard` calculam os gráficos.
  `serialize` mantém dinheiro decimal em string e normaliza o título com
  `transaction_title`. Essa normalização existente não foi alterada.
  Não existem funções de alteração, exclusão, restauração ou exclusão permanente.
- APIs existentes em `ascenda/__init__.py`: GET `/api/finance/dashboard`, GET
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
