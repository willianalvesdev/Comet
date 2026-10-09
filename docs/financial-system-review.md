# Revisão do sistema financeiro de linguagem natural

Revisão concluída em 3 de outubro de 2026, sobre o estado de trabalho existente, incluindo alterações anteriores ainda não commitadas. Escopo: correção de falhas, segurança e testes. Não foram adicionados frameworks, dependências, telas ou novas operações financeiras.

## Arquitetura final

Texto → normalização → parser local e contexto → avaliação de confiança → IA somente quando necessária → validação estrutural e de negócio → FinancialAction[] → validação do lote inteiro → execução atômica → releitura dos dados → atualização do contexto → feedback.

- `financial-parser.ts`: interpretação pura, datas fornecidas pelo contexto e cálculos em centavos com BigInt. Valores externos continuam strings decimais em reais.
- `financial-context.ts`: referências e perguntas pendentes; IDs vêm dos registros persistidos. Não é uma segunda base de transações.
- `financial-ai.ts`: fallback Gemini/Ollama por uma rota do servidor. Resposta entra como unknown, passa pelo contrato runtime estrito e pelas regras de negócio. O modelo recebe dados delimitados, sem ferramentas ou acesso direto ao banco.
- `financial-execution.ts`: valida todas as ações antes de enviar; confere tipo, quantidade e IDs de todas as operações confirmadas pelo servidor.
- `comet/finance_execution.py`: autenticação pela rota, autorização por conta, releitura/bloqueio dos alvos, transação MySQL, rollback e idempotência por UUID. A auditoria participa da mesma transação, mas não dos cálculos financeiros.
- `graph-composer.ts` e `financial-feedback.ts`: coordenam envio, recuperação de confirmação, contexto e mensagens simples. Metadados internos não aparecem no cartão de resposta.
- Exclusão comum preenche `deleted_at`; restauração limpa a marca e mantém o ID. Consultas financeiras excluem registros da lixeira. Exclusão definitiva exige pedido explícito e registro já excluído.

## Correções desta revisão

1. Reconhecimento de abastecimento com quantidade e preço total separados: 20 litros por 120 representa R$ 120,00.
2. Correção contextual “Foi anteontem”, sem exigir “E foi”.
3. Um esclarecimento de lote incompleto não preserva somente a última criação, evitando descartar silenciosamente eventos anteriores.
4. Pedidos de exclusão definitiva negados, condicionais ou citados não autorizam execução; a autorização também é conferida ao continuar uma pergunta pendente e ao validar a IA. Nomes como “Loja Para Sempre” continuam sendo descrições de criação.
5. A IA não pode usar o valor ou a intenção de uma pergunta antiga para preencher um novo evento sem dados suficientes.
6. A confirmação de execução precisa corresponder aos IDs solicitados; uma criação confirma exatamente um ID válido e único.
7. Após perda de resposta ou falha na releitura, o composer reconcilia a operação pendente antes de interpretar uma correção seguinte. Reenvio utiliza o mesmo UUID; uma confirmação já recebida é reaproveitada.
8. JSON de provedor excessivamente aninhado produz erro controlado, sem propagar RecursionError.

## Casos obrigatórios

Todos os exemplos abaixo são testados tanto pelo parser quanto pela orquestração: nenhuma chamada à IA é feita para esses casos.

| Entrada | Resultado esperado |
| --- | --- |
| Gastei 67 reais no mercado ontem | Despesa 67,00; Mercado; ontem |
| Gastei 200 no mercado | Despesa 200,00; Mercado |
| Recebi 1500 do trabalho | Receita 1.500,00; Trabalho |
| Gastei 30 no almoço e 20 no ônibus | Duas despesas: 30,00 e 20,00 |
| Recebi 100 e gastei 30 | Receita 100,00 e despesa 30,00 |
| Perdi 200 em aposta e recebi 50 de volta | Uma despesa líquida de 150,00 |
| Gastei 100 mas recebi 20 de reembolso | Uma despesa líquida de 80,00 |
| Gastei 100 no mercado e recebi 20 do João | Eventos independentes: despesa 100,00 e receita 20,00 |
| Paguei 500 com 10% de juros | Despesa 550,00 |
| Paguei 500 com 10% de desconto | Despesa 450,00 |
| Comprei 3 produtos de 20 cada | Despesa 60,00 |
| Comprei 2 pizzas por 80 | Despesa total 80,00, sem multiplicar por dois |
| Abasteci 20 litros por 120 | Despesa total 120,00; litros não viram dinheiro |
| Recebi 1,5 mil | Receita 1.500,00 |
| Gastei 1.250,90 | Despesa 1.250,90 |

A conversa “Gastei 80 no mercado ontem” → “Na verdade foram 90” → “Foi anteontem” → “Apaga ela” → “Desfaz” mantém o mesmo ID confirmado, altera valor/data, exclui logicamente e restaura o registro.

## Cobertura adicional

- Datas relativas, dias da semana, dia isolado, datas numéricas/por extenso, calendário dinâmico e fuso; viradas de mês/ano, fevereiro, ano bissexto e século não bissexto; rejeição de dias/meses inexistentes e datas futuras.
- Ambiguidade entre registros reais, seleção “A de 80”, pronomes, referências plurais, snapshots incompletos ou desatualizados e IDs removidos.
- Categorias opcionais/desconhecidas, compensações válidas versus recebimentos independentes, quantidades e cálculos com precisão monetária.
- Fallback para relações não cobertas localmente; JSON malformado, propriedades extras, campos ausentes, códigos/SQL indevidos, tipos inesperados, valores inválidos, IDs inventados e categorias não disponíveis.
- Soft delete, restore, permanent delete, bloqueio de update em registro excluído, exclusão da lixeira de saldo/receitas/despesas/gráficos e recomposição exata após restauração.
- Atomicidade com falha após gravação, falha de auditoria, alvo de outra conta e ação final inválida; reenvios idempotentes e manutenção do contexto após resposta perdida.
- Autenticação, CSRF, limites de entrada/resposta, liberação de vagas do provedor após erro e separação entre instruções fixas e dados não confiáveis.
- Testes de navegador também verificam navegação, rolagem, preferências, gráficos e chat, para detectar regressões fora do parser.

Não foi medida porcentagem de cobertura de linhas; a cobertura descrita corresponde a cenários com asserções automatizadas.

## Verificações

Resultado final: **275 testes aprovados** (100 frontend e 175 backend).

- `npm run typecheck`: aprovado, com strict e noEmitOnError ativos.
- `npm run build`: aprovado; também executado pelo comando de testes frontend.
- `npm run test:frontend`: 100 testes aprovados, incluindo testes de navegador; nenhum teste ignorado ou pendente.
- `venv/Scripts/python.exe -m unittest discover -s tests`: 175 testes aprovados.
- `git diff --check`: sem erros de whitespace.
- Lint: o projeto não possui configuração/comando de lint. Nenhuma ferramenta foi adicionada apenas para esta revisão.
- Verificações estáticas automatizadas não encontraram any, @ts-ignore, @ts-nocheck, eval/Function ou timers com código em string nos fontes financeiros. A varredura de fontes, JavaScript gerado e templates não encontrou chaves/configuração privada de provedores no frontend.

## Arquivos desta revisão

Criados:

- `tests/frontend/financial-safety.test.cts`
- `docs/financial-system-review.md`

Modificados:

- `frontend/controllers/financial-parser.ts`
- `frontend/controllers/financial-context.ts`
- `frontend/controllers/financial-ai.ts`
- `frontend/controllers/financial-execution.ts`
- `frontend/controllers/graph-composer.ts`
- `comet/ai/remote.py`
- `tests/frontend/financial-parser.test.cts`
- `tests/frontend/financial-context.test.cts`
- `tests/frontend/financial-ai.test.cts`
- `tests/frontend/recent-chats.test.cts`
- `tests/test_finance_execution.py`
- `tests/test_finance_interpretation.py`

JavaScript e declarações de tipos foram regenerados pelo compilador nos diretórios de artefatos já existentes e ignorados pelo Git. A lista acima considera somente esta revisão; outros arquivos já alterados ou não rastreados no início foram preservados.

## Limitações e melhorias futuras

- A integração de persistência usa SQLite isolado com adaptação do SQL MySQL. Valida queries, rollback e regras, mas não comprova comportamento concorrente dos locks reais do InnoDB. Uma suíte em MySQL temporário seria o próximo reforço de teste.
- Respostas Gemini/Ollama foram simuladas. Não houve envio de dados financeiros reais, uso de API paga ou alteração do banco do usuário. Um teste opcional dos provedores com dados sintéticos pode verificar compatibilidade do serviço em ambiente controlado.
- O parser continua conservador: datas imprecisas, linguagem não coberta e relações incertas pedem esclarecimento/fallback. Lotes incompletos e respostas de esclarecimento fora das formas suportadas podem exigir reformular o pedido completo.
- Validação estrutural/de negócio e isolamento reduzem risco; não demonstram equivalência semântica perfeita de toda resposta de IA nem imunidade absoluta a prompt injection.
- O contexto e o pedido pendente pertencem à página. Recarregar a página durante uma falha de rede não recupera automaticamente o UUID anterior. Persistir essa recuperação pode ser considerado se esse cenário se tornar frequente.
- O histórico completo é relido antes das operações locais; contas muito grandes podem exigir busca contextual paginada. Não foi adicionada uma otimização sem medição de necessidade.
