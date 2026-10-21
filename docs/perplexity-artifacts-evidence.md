# Perplexity: geração de planilha e painel Artefatos

Investigação em 19/10/2026 da [conversa fornecida](https://www.perplexity.ai/search/5e25e61e-a8b8-4b5c-b1d9-600131f65115), em Edge isolado, sem autenticação e sem enviar novas mensagens. A inspeção abriu prévias e baixou os arquivos públicos; nenhum código da conversa foi executado localmente.

## Resultado

A conversa contém arquivos reais. O primeiro pedido produziu `grafico_passos.png`. O seguimento produziu `lista_passos.xlsx` e `lista_passos.csv`. O painel lateral agrupa os três em **Artefatos 3**, antes de **Fontes 10**. Os dois arquivos de dados também aparecem como cards na resposta.

O XLSX baixado pelo botão da prévia tem **5.649 bytes**, uma aba `Sheet1`, intervalo `A1:D8`, quatro colunas e sete linhas de dados. O CSV tem **180 bytes** e contém os mesmos valores. Essa planilha de exemplo não tem fórmulas nem macros. A tabela textual da resposta é uma representação adicional; o download entrega um arquivo XLSX válido.

## Como a geração é representada

O retorno público da conversa contém `workflow_block` e `unified_assets_block`, separados do texto da resposta:

1. Um `CODE_ASSET` registra Python, o script, stdout, stderr e `status: success`.
2. No pedido da planilha, o script importa `pandas`, cria um DataFrame e usa `to_excel('output/lista_passos.xlsx', index=False)` e `to_csv('output/lista_passos.csv', index=False)`.
3. Os resultados são registrados separadamente como `XLSX_FILE` e `CODE_FILE` com MIME `text/csv`, UUID, nome, tamanho, URL e informações de download.
4. O workflow referencia esses UUIDs para mostrar os cards de resultados da etapa. Os três arquivos finais da conversa têm `is_primary_asset: true`; código e imagens intermediárias também existem nos metadados, mas não entram na lista visível de três arquivos.
5. As URLs observadas apontam para arquivos em CloudFront com parâmetros de assinatura. Assinaturas foram ocultadas nos registros locais.

**Observado:** a conversa publicada fornece esses registros, os arquivos existem e seus valores correspondem ao código. **Inferência:** o backend orquestra execução de código e publicação dos resultados, e a interface consome os artefatos prontos. A sessão observada já estava concluída; não foi acompanhada uma geração ao vivo nem inspecionado o processo servidor. Os registros não identificam o fornecedor de execução, o isolamento, custos, limites ou política de retenção.

## Prévia e organização da interface

- Expandir **Artefatos** mostra `lista_passos`, `grafico_passos.png` e `lista_passos.csv`.
- Clicar no card XLSX abre um painel à direita com grade, letras de colunas, números de linhas, barra `fx`, zoom, botão de expansão, fechamento e **Baixar como XLSX**.
- A prévia carregou as oito linhas e quatro colunas do arquivo. O botão de download entregou `lista_passos.xlsx` sem erro.
- O bundle público `NativeXlsxViewer__v2-iAncPO28.js`, carregado ao abrir a prévia, busca os bytes via `fetch`/`arrayBuffer` e contém o parser dos arquivos XML internos do XLSX. A evidência sustenta uma prévia no próprio cliente; não é necessário encaminhar o usuário ao Excel ou ao Google Sheets para visualizar.
- O bundle `ArtifactsPaneSection__v2-D5K5sgnx.js` agrupa cadeias de versões, seleciona a versão final de cada cadeia e monta as linhas e ações de abertura/download. Isso é análise estática; a conversa observada não exercitou revisão de versões.
- A interface exibiu controles de edição e login. Não foram testadas edição persistente, compartilhamento, exportação para serviços externos ou permissões de autoria.

## Implicação para o Comet

Uma implementação equivalente precisaria gerar o arquivo de fato, registrar seus metadados vinculados à resposta, servir o download com controle de acesso e apresentar os mesmos registros nos cards e na seção **Artefatos** acima das fontes. Para XLSX, a prévia precisa ler as células do arquivo ou receber dados estruturados equivalentes.

Para planilhas simples, gerar XLSX/CSV a partir de dados estruturados é suficiente; permitir que o modelo escreva Python e executá-lo seria um escopo separado, com ambiente isolado. Essa é uma proposta para o Comet, não uma afirmação sobre a infraestrutura privada do Perplexity. Nenhuma função de geração de artefatos foi implementada nesta investigação.

## Evidências e cobertura

Base REA: **`ev_c56815f6fefd0cc8b7e4515599df70ca63cc76ce8883982177aeb580cf5294a9`**, operação `capture_browser_scenario`, provider `rea-playwright-browser-scenario`, autoridade `controlled-replay`, confiança `observed`.

| Questão | Evidência | Conclusão / cobertura |
| --- | --- | --- |
| Conversa pública e posição Artefatos/Fontes | `conversation-evidence.json`, `conversation-aria.txt`, `artifacts-expanded.png` | Respondida por captura REA e interação suplementar Playwright |
| Código de geração e arquivos associados | `thread-redacted.json`, `download-report.json` | Respondida para os registros históricos publicados; execução ao vivo não observada |
| Arquivos reais e conteúdo | `lista_passos.xlsx`, `lista_passos.csv`, `file-inspection.json` | Download XLSX via UI e leitura ZIP/XML/CSV; igualdade dos dados verificada |
| Prévia e controles | `xlsx-preview-aria.txt`, `xlsx-preview.png`, `interaction-network.json` | Prévia e download observados; gravação de edição não testada |
| Organização e processamento no cliente | `scripts/ArtifactsPaneSection__v2-D5K5sgnx.js`, `scripts/NativeXlsxViewer__v2-iAncPO28.js` | Análise estática suplementar; não atribuir todos os ramos à execução observada |
| Infraestrutura do servidor | Nenhuma evidência direta do servidor | Desconhecida |

Todos os arquivos acima estão em `artifacts/perplexity-artifacts/`. `evidence-manifest.json` preserva SHA-256 dos registros principais. `scripts-manifest.json` e `interaction-scripts-manifest.json` preservam URLs, tamanhos e hashes dos bundles públicos.

A captura REA tem janela finita de observação; havia requisições ainda não concluídas no fim. Ordem de recebimento de eventos não estabelece causalidade. As interações posteriores foram Playwright suplementar e não fazem parte do Evidence ID REA inicial. Os scripts `interaction-probe.cjs` e `download-probe.cjs` encerram os próprios navegadores em `finally`. O script contido nos metadados foi apenas lido, nunca executado.


## Revisão da interface de tabelas e prévia — 20/10/2026

Alvo: a mesma conversa pública com `?login-new=false&login-source=oneTapThread&preview=1`. Capturas REA adicionais: `ev_a99c9b3360ca490bb3d6d1a7b19c50c466b3ce2e25183425f2bf0cc895553870` (`layout-rea.json`) e `ev_4cfdebace3dbf70b24ec45f5fe2b02ba7ccead0b6d7d1ba5928050b610e991ca` (`layout-open-rea.json`). Interações e medições suplementares em `layout-measurements.json`, produzidas por `layout-behavior-probe.cjs`; seus resultados não devem ser atribuídos ao Evidence ID REA. Hashes em `layout-evidence-manifest.json`.

Observações no navegador, viewport de 1440×1000:

- A prévia não é um modal: não havia `dialog` nem `aria-modal`. O painel lateral ocupou x=720, largura=720; a resposta refluía na região restante. Expandir ocupou a viewport inteira e ocultou a sidebar. Restaurar voltou a 720px.
- Há uma área de arraste de 20px na borda esquerda com cursor `col-resize`. Arrastar para estreitar reduziu a largura de 720 para 544px. A tentativa de ampliar além da largura inicial ficou limitada a 720px nessa viewport. Isso é um limite observado, não uma regra geral demonstrada para todas as telas.
- Ações da tabela são três ícones no canto inferior direito: copiar, baixar CSV e expandir. O grupo mediu 112×34px, com botões 36×32px. Opacidade do grupo mudou de 0 para 1 no hover; estilos também contemplam teclado e ponteiro de toque.
- As células têm separadores verticais de 1px; a última coluna não tem borda direita interna.
- Os arquivos aparecem como linhas empilhadas num contêiner com contorno, ícone de tipo, nome, subtítulo e menu de ações.
- O cabeçalho da tabela curta na resposta estava `position:static`. Portanto, cabeçalho fixo durante a rolagem no Comet atende ao pedido explícito do usuário; não é uma propriedade comprovada dessa tabela da referência. A grade XLSX tem cabeçalhos próprios.

Cobertura: abertura, fechamento, expansão, restauração, arraste, hover e organização visual observados. Nenhuma mensagem foi enviada e nenhuma edição de arquivo foi gravada no Perplexity. Os detalhes do backend continuam desconhecidos. No Comet, o painel usa limites adaptados à largura disponível e uso por teclado; em celular ocupa a tela para manter a prévia utilizável.
