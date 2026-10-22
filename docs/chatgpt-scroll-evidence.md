# Investigação do scroll do ChatGPT

Alvo: https://chatgpt.com/

REA Evidence: ev_e70ad5b7e589d2317309a8973e734c4a8588fd87f35f78daafe508f6e579801d

Observado: o navegador isolado recebeu a página de verificação “Um momento…”. A requisição HTTP pública retornou 403. Nenhum CSS do aplicativo pôde ser inspecionado. A consulta web retornou texto da página, sem regras CSS.

Limite: não foi possível determinar largura, cores, setas ou implementação do scroll original. Nenhuma réplica é alegada; o scroll nativo atual do Comet foi preservado.

Correções independentes: avisos somente em conversas com mensagens; fundo do contêiner igual ao aviso, preenchendo a região atrás dos cantos superiores sem remover a borda da caixa.

Nova tentativa solicitada pelo usuário: navegador isolado com espera de 15 segundos; a página continuou em verificação, sem regras de scrollbar. REA Evidence: ev_a9cfc54f10666d1e32e98f6ad5004f34098eca8d8fbc8ac14522226716d5450f
