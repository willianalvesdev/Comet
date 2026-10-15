# Gráfico financeiro

A página Finanças usa componentes React e SVG próprios. O gráfico anterior e a dependência Lightweight Charts foram removidos. A referência visual e de interação é a visão geral do ESUSD, adaptada às transações pessoais do Comet.

## API

`GET /api/finance/chart?period=6m&interval=day` exige uma sessão autenticada e consulta somente as transações do usuário. Substitui `/api/finance/dashboard`.

- `period`: `1d`, `5d`, `1m`, `6m`, `ytd`, `1y`, `5y`, `max` ou `custom`.
- `custom` exige `start` e `end` no formato `AAAA-MM-DD`, em ordem, entre 1970 e hoje.
- `interval`: `movement`, `day`, `week` ou `month`. O padrão de 1D é por transação; os demais usam dias.
- Retorna três séries (`balance`, `income`, `expense`), a referência inicial, os resumos do mês e o período efetivamente consultado.
- Cada ponto contém data, horário quando disponível, abertura, máxima, mínima, fechamento e movimentação em reais.
- Saldo soma receitas e subtrai despesas; as séries de receitas e despesas mostram valores acumulados. A escala percentual do saldo está disponível quando a base inicial é diferente de zero.
- Os cálculos monetários usam centavos inteiros no servidor. Transações excluídas e futuras não entram na resposta. Nenhuma transação é criada ou alterada pela consulta.
- Dias sem atividade carregam o saldo real, com movimentação zero. Períodos inteiramente sem transações mostram a referência e uma mensagem de estado vazio.
- Registros com o mesmo horário permanecem distintos no intervalo por transação. Horários antigos desconhecidos continuam nulos, sem inventar uma hora.

## Interface

- Três cartões informativos de 154px, com valores do mês, comparação com o mês anterior e minigráficos verdes/vermelhos, sem malha pontilhada e com brilho suave. O gráfico principal permanece no saldo; o seletor de série e a troca por clique nos cartões foram removidos.
- Recentes alinhados ao topo dos resumos, com linhas compactas de 64px, iniciais da descrição e valores à direita. O prompt começa em uma linha e cresce conforme o texto.
- Linha e velas, volume de movimentação, grade, referência inicial, média móvel de 20 pontos, escala percentual. A comparação entre séries foi removida.
- Períodos 1D, 5D, 1M, 6M, YTD, 1Y, 5Y e MAX em uma faixa de botões, com calendário separado para datas personalizadas.
- Zoom horizontal de 1 a 20 vezes ancorado no cursor, preservando a escala vertical do período completo; arrastar compara dois pontos em ordem cronológica enquanto o botão permanece pressionado. Soltar, sair do gráfico ou cancelar o toque limpa a seleção. Setas, Home e End permitem navegar com teclado. Escape e duplo clique redefinem a visualização.
- Tela ampliada dentro da área de conteúdo, com cabeçalho próprio, lateral preservada, gráfico de 450px, fechamento por X/Escape e transição de visualização; imagem PNG com o tema atual e CSV com todos os dados do período, independentemente da página exibida.
- Planilha com seis colunas ordenáveis, intervalos compartilhados com o gráfico e páginas de 20 linhas; no celular, rolagem horizontal mantém a legibilidade.
- Consultas anteriores são canceladas ao trocar o período ou sair da página. O evento `finance:changed` recarrega gráfico, cartões e transações após uma operação financeira.

A IA e o registro de transações continuam usando as rotas financeiras existentes. Não há API de mercado nem preços fictícios. Funções próprias de bolsa (pregão, bolsas e comparação de ativos) foram adaptadas aos dados pessoais.

## Validação

`tests/server/finance-chart.test.ts` cobre centavos, agrupamentos, datas, saldos negativos, horários repetidos e estados vazios. `tests/server/routes.test.ts` verifica autenticação e isolamento entre contas. `tests/frontend/finance-chart.test.cts` cobre controles, comparação, seleção, exportação, atualização, cancelamento de consultas e os dois temas em desktop e celular.

## Ajustes de fidelidade — REA, 13/10/2026

Evidência estática preservada da página ESUSD: **E2** `ev_8fd832776f9ada3c1dc4fc8ec1b5639f0168db8edeff78d6a404690f1f23b3b2` (`ESUSD-evidence.json`, captura REA em `%TEMP%/comet-finance-rea-20261013`). Os módulos abaixo foram capturados pelo REA e examinados como código entregue pelo site; as conclusões não representam uma nova execução observada do Perplexity.

| Aspecto | Evidência / conclusão | Aplicação no Comet |
| --- | --- | --- |
| Zoom | FinanceStockHistoryChart: domínio vertical deriva da série completa e referência, com margem de 5% | Apenas X muda com roda/pinça; valores e posições do eixo Y permanecem iguais |
| Cursor | FinanceStockHistoryChartTooltip: linha contínua de 1px segue a coordenada local; cor terciária, verde/vermelha durante seleção | Linha sem ponto ou tracejado, acompanha o cursor entre pontos |
| Seleção | FinanceStockHistoryChart, função Bn (~36006): preenchimento neutro a 5%; mouseup/leave e término/cancelamento de toque limpam estado | Retângulo neutro apenas durante o arraste; área da curva limitada ao trecho selecionado |
| Velas | FinanceStockHistoryPeriodUtils: a variável chamada blue resolve para finance-positive-fg-primary | Alta verde, baixa vermelha; nenhuma vela azul |
| Tela ampliada | sub-router (~38800–40800): startViewTransition, sobreposição na área de conteúdo, cabeçalho fixo, padding 32px e altura do gráfico 450px | Preserva a lateral; oculta abas, estatísticas e caixa de mensagem durante ampliação |
| Dígitos | FinanceNumberFlow e dist__v2-AUctp8ju: NumberFlow, deslocamento 900ms com curva amortecida e opacidade 450ms | Biblioteca @number-flow/react, mesmos tempos; primeira renderização direta, redução de movimento respeitada |

O rótulo acessível contém o número completo, evitando leitura isolada de cada dígito. Os ícones de calendário, câmera e expansão reproduzem os SVGs fornecidos pelo usuário. A marca d'água foi removida e a planilha mantém o fundo do cartão nos dois temas.

Referência pública da biblioteca: [NumberFlow](https://number-flow.barvian.me/). A captura mais recente do Perplexity retornou uma página vazia no navegador de inspeção; por isso estes ajustes usam a captura REA anterior e as imagens do usuário. A verificação de comportamento foi executada no Comet, com dados de teste e tamanhos de tela de desktop/celular. Não se afirma identidade pixel a pixel nem verificação em aparelho físico.

A prévia acompanha X/Y do cursor com deslocamento de 16px para baixo e à direita. É renderizada fora do contêiner do gráfico, respeitando apenas as bordas da janela, e desaparece ao sair, rolar ou redimensionar. Durante o arraste, a variação em reais e porcentagem aparece verde/vermelha na prévia e no cabeçalho. Uma base zero exibe percentual indisponível. A etiqueta flutuante “Inicial” foi removida; a linha de referência continua opcional.
