# Gráfico financeiro

A página Finanças usa Lightweight Charts 5.0.9, instalado pelo npm e empacotado pelo Next.js.
Os dados reais vêm de `/api/finance/dashboard` e são entregues a `CometChart.setData`.

- `points` contém os resumos diários OHLC e a movimentação total de cada dia. Alimenta a planilha e o resumo do período.
- `movements` contém um ponto por transação ativa, ordenado por data, hora e ID. Inclui o saldo anterior, saldo resultante, valor movimentado, `occurred_on` e `occurred_time`.
- O gráfico acrescenta um ponto com o saldo antes da primeira transação. Nenhum lançamento com data ou horário igual é descartado.
- A posição horizontal segue a ordem das transações. As coordenadas ordinais usadas pela biblioteca não representam horários; os rótulos vêm dos dados reais.
- A data aparece ao mudar o dia; dentro do mesmo dia, o horário aparece apenas quando muda. O hover sempre identifica o registro consultado.
- A linha usa segmentos retos para não criar aumentos ou quedas inexistentes. As cores continuam comparando o saldo com a abertura do período.
- A seleção compara os saldos dos registros, em ordem cronológica, mesmo ao arrastar da direita para a esquerda.
- O zoom altera a janela horizontal. A escala lateral considera todos os valores do período selecionado, mantendo os números estáveis durante o zoom. Mudar o período ou os dados recalcula a escala.
- Sem transações no período, o gráfico usa os saldos diários disponíveis. Sem dados, mostra o estado vazio previsto pela página.

## Horários

Novas transações sem hora explícita recebem a hora do servidor em São Paulo, no momento da gravação. A data informada é preservada. Horários explícitos usam `HH:MM` ou `HH:MM:SS` e são persistidos como `occurred_time`.

Alterar apenas o valor, a descrição ou a data preserva o horário existente. Repetir uma criação com o mesmo identificador não substitui o horário original. Registros antigos sem hora permanecem com `occurred_time = NULL`.

Execute `configurar_banco.bat` com uma conexão PostgreSQL configurada em `DATABASE_URL`. Ele aplica o esquema idempotente de `setup_banco.sql`, incluindo `occurred_time TIME`, sem apagar registros existentes.
