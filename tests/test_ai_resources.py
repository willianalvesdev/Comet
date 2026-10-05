import base64
import io
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

from PIL import Image, ImageOps
from werkzeug.datastructures import FileStorage

from comet.ai.attachments import AttachmentStore
from comet.ai.config import AIConfig
from comet.ai.errors import AIError
from comet.ai.service import ComputerService


class AIResourceTests(unittest.TestCase):
    def setUp(self):
        self.config = AIConfig('http://localhost:11434', 'qwen3:4b')

    def test_generation_reads_runtime_context_once(self):
        provider = MagicMock()
        provider.stream.return_value = (event for event in ())
        service = ComputerService(provider, self.config)
        with patch('comet.ai.service.current_context', return_value='CURRENT CONTEXT') as clock:
            list(service.generate([{'role': 'user', 'content': 'Oi'}]))
        clock.assert_called_once_with()
        system_message = provider.stream.call_args.args[0][0]['content']
        self.assertTrue(system_message.startswith('CURRENT CONTEXT'))
        self.assertTrue(system_message.endswith('CURRENT CONTEXT'))

    def test_interrupted_turn_is_finalized_even_when_source_close_fails(self):
        service = ComputerService(MagicMock(), self.config)
        store = MagicMock()
        store.begin.return_value = {
            'conversation_id': '1', 'turn_id': '2',
            'messages': [{'role': 'user', 'content': 'Oi'}],
        }

        def failing_close():
            try:
                yield {'type': 'thinking', 'text': 'Analisando'}
            finally:
                raise RuntimeError('close failed')

        with patch('comet.ai.service.with_web', return_value=failing_close()):
            stream = service.stream_saved(7, {}, store)
            self.assertEqual(next(stream)['type'], 'conversation')
            self.assertEqual(next(stream)['type'], 'thinking')
            with self.assertRaisesRegex(RuntimeError, 'close failed'):
                stream.close()
        self.assertEqual(store.save.call_args.args[-3:], ('', 'Analisando', 'interrupted'))
        self.assertEqual(service._active, set())

    def test_image_buffers_and_copies_close_on_success_and_encoding_error(self):
        bytes_buffer = io.BytesIO
        for encoding_error in (False, True):
            with self.subTest(encoding_error=encoding_error), tempfile.TemporaryDirectory() as directory:
                buffers = []
                original_image = MagicMock(width=10, height=10)
                oriented_image = MagicMock()
                normalized_image = oriented_image.convert.return_value
                uploaded_file = FileStorage(stream=bytes_buffer(b'image'), filename='foto.png')

                def create_buffer(*args):
                    buffer = bytes_buffer(*args)
                    buffers.append(buffer)
                    return buffer

                def save_image(output, **options):
                    if encoding_error:
                        raise OSError('encoding failed')
                    output.write(b'normalized jpeg')

                normalized_image.save.side_effect = save_image
                with patch('comet.ai.attachments.io.BytesIO', side_effect=create_buffer), \
                        patch('comet.ai.attachments.Image.open', return_value=original_image), \
                        patch('comet.ai.attachments.ImageOps.exif_transpose', return_value=oriented_image):
                    store = AttachmentStore(directory)
                    if encoding_error:
                        with self.assertRaises(AIError) as caught:
                            store.upload(7, uploaded_file)
                        self.assertEqual(caught.exception.code, 'attachment_content')
                        self.assertEqual(list(Path(directory).rglob('*.json')), [])
                    else:
                        uploaded = store.upload(7, uploaded_file)
                        stored = store.read(7, uploaded['id'])
                        self.assertEqual(base64.b64decode(stored['image']), b'normalized jpeg')
                self.assertEqual(len(buffers), 2)
                self.assertTrue(all(buffer.closed for buffer in buffers))
                for image in (original_image, oriented_image, normalized_image):
                    image.close.assert_called_once_with()
                uploaded_file.close()

    def test_normalized_image_and_public_metadata_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory, io.BytesIO() as original_buffer:
            image = Image.new('RGBA', (1700, 850), (20, 40, 60, 128))
            image.save(original_buffer, format='PNG')
            image.close()
            original_bytes = original_buffer.getvalue()
            with Image.open(io.BytesIO(original_bytes)) as original_image:
                oriented_image = ImageOps.exif_transpose(original_image)
                normalized_image = oriented_image.convert('RGB')
                normalized_image.thumbnail((1600, 1600))
                with io.BytesIO() as expected_buffer:
                    normalized_image.save(expected_buffer, format='JPEG', quality=85)
                    expected_image = expected_buffer.getvalue()
                normalized_image.close()
                oriented_image.close()
            uploaded_file = FileStorage(stream=io.BytesIO(original_bytes), filename='foto.png')
            store = AttachmentStore(directory)
            uploaded = store.upload(7, uploaded_file)
            uploaded_file.close()
            self.assertEqual(set(uploaded), {'id', 'name', 'size', 'kind'})
            self.assertEqual(uploaded['size'], len(original_bytes))
            self.assertEqual(uploaded['name'], 'foto.png')
            self.assertEqual(uploaded['kind'], 'image')
            self.assertEqual(base64.b64decode(store.read(7, uploaded['id'])['image']), expected_image)
