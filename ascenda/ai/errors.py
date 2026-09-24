"""Safe messages for the UI; technical exceptions stay in server logs."""
MESSAGES = {
    'invalid_title': 'Use um nome com 1 a 100 caracteres, sem quebras de linha.',
    'conversation_missing': 'Essa conversa não está disponível na sua conta.',
    'duplicate_request': 'Esta mensagem já foi recebida. Reabra a conversa para conferir a resposta.',
    'stale_conversation': 'A conversa mudou em outra aba. Reabra-a antes de continuar.',
    'history_unavailable': 'Não foi possível salvar a conversa. Confira a conexão com o banco e tente novamente.',

    'unavailable': 'Não consegui me conectar ao meu modelo local. Verifique se o serviço local está em execução e tente novamente.',
    'model_missing': 'Meu modelo local ainda não está disponível. Peça ao responsável pelo Ascenda para concluir a instalação.',
    'timeout': 'A resposta demorou mais que o esperado. Tente novamente em instantes.',
    'invalid_response': 'Recebi uma resposta incompleta. Tente enviar a mensagem novamente.',
    'stream_error': 'A resposta foi interrompida. Você pode tentar novamente.',
    'incompatible': 'Meu modelo local precisa de um ajuste antes de continuar. Peça ao responsável pelo Ascenda para verificar a configuração.',
    'busy': 'Já estou respondendo. Aguarde um instante e tente novamente.',
    'invalid_request': 'Revise a mensagem e tente novamente. Cada mensagem pode ter até 8.000 caracteres.',
}


class AIError(Exception):
    def __init__(self, code, status=502):
        self.code = code
        self.status = status
        self.message = MESSAGES[code]
        super().__init__(self.message)
