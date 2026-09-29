from datetime import datetime, timezone
from .conversations import ConversationStore
from .errors import AIError

class EphemeralStore:
    @staticmethod
    def validate(raw, service):
        if not isinstance(raw, dict) or raw.get('anonymous') is not True:
            raise AIError('invalid_request', 422)
        payload = ConversationStore.validate({k:v for k,v in raw.items() if k not in ('anonymous','history')})
        if payload['conversation_id'] is not None or payload.get('attachments') or payload.get('regenerate'):
            raise AIError('invalid_request', 422)
        history = raw.get('history', [])
        if not isinstance(history, list):
            raise AIError('invalid_request', 422)
        messages = service.validate({'messages': [*history, {'role':'user','content':payload['message']}]})
        return {**payload, 'anonymous':True, 'messages':messages}

    def begin(self, user_id, payload, config):
        return {'conversation_id':None, 'turn_id':payload['request_id'],
                'request_id':payload['request_id'], 'messages':payload['messages'],
                'created_at':datetime.now(timezone.utc).isoformat()}

    def save(self, user_id, turn, answer, thinking, status):
        pass
