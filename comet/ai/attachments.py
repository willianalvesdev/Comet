import base64
import io
import json
import re
import warnings
import zipfile
from contextlib import closing
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree

from PIL import Image, ImageOps
from pypdf import PdfReader
from .errors import AIError

MAX_BYTES = 8 * 1024 * 1024
MARKER = 'ASCENDA_ATTACHMENT_V1\n'


def unpack(value):
    if value.startswith(MARKER):
        try:
            data = json.loads(value[len(MARKER):])
            if isinstance(data['message'], str) and isinstance(data['attachments'], list):
                return data['message'], data['attachments']
        except (ValueError, KeyError, TypeError):
            pass
    return value, []


def pack(message, attachments):
    return MARKER + json.dumps({'message': message, 'attachments': attachments}, ensure_ascii=False) if attachments or message.startswith(MARKER) else message


class AttachmentStore:
    def __init__(self, root):
        self.root = Path(root)

    def path(self, user_id, token):
        if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{32}', token):
            raise AIError('attachment_missing', 404)
        return self.root / str(int(user_id)) / (token + '.json')

    def upload(self, user_id, file):
        raw = file.stream.read(MAX_BYTES + 1)
        if not raw or len(raw) > MAX_BYTES:
            raise AIError('attachment_size', 422)
        name = (file.filename or 'arquivo').replace('\\', '/').split('/')[-1][:150]
        extension = Path(name).suffix.lower()
        data = {'id': uuid4().hex, 'name': name, 'size': len(raw), 'kind': 'file'}
        try:
            if extension in ('.png', '.jpg', '.jpeg', '.webp'):
                with warnings.catch_warnings():
                    warnings.simplefilter('error', Image.DecompressionBombWarning)
                    with io.BytesIO(raw) as image_buffer, closing(Image.open(image_buffer)) as original_image:
                        if original_image.width * original_image.height > 25000000:
                            raise ValueError()
                        with closing(ImageOps.exif_transpose(original_image)) as oriented_image:
                            with closing(oriented_image.convert('RGB')) as normalized_image, io.BytesIO() as output:
                                normalized_image.thumbnail((1600, 1600))
                                normalized_image.save(output, format='JPEG', quality=85)
                                encoded_image = base64.b64encode(output.getvalue()).decode('ascii')
                data.update(kind='image', image=encoded_image)
            else:
                if extension == '.pdf':
                    with io.BytesIO(raw) as document_buffer:
                        reader = PdfReader(document_buffer)
                        if reader.is_encrypted or len(reader.pages) > 40:
                            raise AIError('attachment_content', 422)
                        text = ''
                        for page in reader.pages:
                            text += (page.extract_text() or '') + '\n'
                            if len(text) > 20000:
                                raise AIError('attachment_content', 422)
                elif extension == '.docx':
                    with io.BytesIO(raw) as document_buffer, zipfile.ZipFile(document_buffer) as archive:
                        info = archive.getinfo('word/document.xml')
                        if info.file_size > 2 * 1024 * 1024:
                            raise ValueError()
                        document = ElementTree.fromstring(archive.read(info))
                        text = ' '.join(node.text or '' for node in document.iter() if node.tag.endswith('}t'))
                elif extension in ('.txt', '.md', '.csv', '.json', '.py', '.js', '.html', '.css', '.log'):
                    text = raw.decode('utf-8-sig')
                else:
                    raise AIError('attachment_type', 422)
                if not text.strip() or len(text) > 20000 or '\x00' in text:
                    raise AIError('attachment_content', 422)
                data['text'] = text
        except AIError:
            raise
        except Exception:
            raise AIError('attachment_content', 422) from None
        target = self.path(user_id, data['id'])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return self.public(data)

    @staticmethod
    def public(data):
        return {field: data[field] for field in ('id', 'name', 'size', 'kind')}

    def read(self, user_id, token):
        try:
            return json.loads(self.path(user_id, token).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise AIError('attachment_missing', 404) from None

    def message(self, user_id, text, tokens):
        message = {'role': 'user', 'content': text}
        for token in tokens:
            data = self.read(user_id, token)
            if data['kind'] == 'image':
                message.setdefault('images', []).append(data['image'])
                message['content'] += '\nImagem anexada: ' + data['name']
            else:
                message['content'] += '\n<arquivo nome=' + json.dumps(data['name']) + '>\n' + data['text'] + '\n</arquivo>'
        return message
