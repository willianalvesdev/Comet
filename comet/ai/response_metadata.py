import json

PREFIX = "\x1eascenda-response-v1:"


def pack_response(thinking, metadata):
    if not metadata:
        return thinking
    return PREFIX + json.dumps({"thinking": thinking, "metadata": metadata}, ensure_ascii=False)


def unpack_response(value):
    if not value.startswith(PREFIX):
        return value, {}
    try:
        data = json.loads(value[len(PREFIX):])
        if isinstance(data.get("thinking"), str) and isinstance(data.get("metadata"), dict):
            return data["thinking"], data["metadata"]
    except (ValueError, TypeError, AttributeError):
        pass
    return value, {}
