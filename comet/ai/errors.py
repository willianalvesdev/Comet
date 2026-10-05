MESSAGES = {
    'context_size': 'Esta conversa excedeu o contexto disponível do modelo. Abra um novo chat ou escolha um modelo com maior capacidade.',
    'attachment_size': 'Cada arquivo pode ter até 8 MB.',
    'attachment_type': 'Envie PNG, JPG, WebP, PDF, DOCX ou arquivos de texto.',
    'attachment_content': 'Não foi possível ler o arquivo. Use um documento com texto selecionável, até 40 páginas e 20 mil caracteres, ou envie uma imagem.',
    'attachment_missing': 'Este anexo não está disponível na sua conta. Envie o arquivo novamente.',
    'attachment_total': 'Os arquivos juntos devem ter até 30 mil caracteres de texto. Envie menos arquivos.',

    'invalid_personalization': 'Confira os campos e os limites de tamanho da personalização.',
    'personalization_changed': 'A memória mudou desde que você abriu esta página. Recarregue para ver a versão atual antes de salvar.',

    'provider_missing': 'Configure a chave do modelo escolhido no servidor para começar.',
    'provider_auth': 'A chave deste modelo não foi aceita. Confira a configuração da API.',
    'provider_quota': 'O limite de uso ou os créditos deste modelo acabaram. Tente mais tarde ou escolha outro modelo.',
    'provider_unavailable': 'O serviço do modelo está indisponível. Tente novamente em instantes.',
    'provider_model': 'Este modelo não está disponível para a chave configurada. Confira o modelo no servidor.',
    'provider_blocked': 'O provedor não conseguiu responder a esta solicitação. Reformule sua mensagem.',

    'invalid_title': 'Use um nome com 1 a 100 caracteres, sem quebras de linha.',
    'conversation_missing': 'Essa conversa não está disponível na sua conta.',
    'duplicate_request': 'Esta mensagem já foi recebida. Reabra a conversa para conferir a resposta.',
    'stale_conversation': 'A conversa mudou em outra aba. Reabra-a antes de continuar.',
    'history_unavailable': 'Não foi possível salvar a conversa. Confira a conexão com o banco e tente novamente.',

    'unavailable': 'Não consegui me conectar ao meu modelo local. Verifique se o serviço local está em execução e tente novamente.',
    'model_missing': 'Meu modelo local ainda não está disponível. Peça ao responsável pelo Comet para concluir a instalação.',
    'timeout': 'A resposta demorou mais que o esperado. Tente novamente em instantes.',
    'invalid_response': 'Recebi uma resposta incompleta. Tente enviar a mensagem novamente.',
    'stream_error': 'A resposta foi interrompida. Você pode tentar novamente.',
    'incompatible': 'Meu modelo local precisa de um ajuste antes de continuar. Peça ao responsável pelo Comet para verificar a configuração.',
    'busy': 'Já estou respondendo. Aguarde um instante e tente novamente.',
    'invalid_request': 'Revise a mensagem e tente novamente. Cada mensagem pode ter até 8.000 caracteres.',
}


class AIError(Exception):
    def __init__(self, code, status=502):
        self.code = code
        self.status = status
        self.message = MESSAGES[code]
        super().__init__(self.message)
