from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import hashlib
p=Path('C:/Users/welde/OneDrive/Área de Trabalho/Comet/30 exercicios.docx')
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
rns='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
with ZipFile(p) as z:
 root=etree.fromstring(z.read('word/document.xml'))
 rels=etree.fromstring(z.read('word/_rels/document.xml.rels'))
 mapping={r.get('Id'):r.get('Target') for r in rels}
 tables=root.findall('.//w:body/w:tbl',ns)
 assert len(tables)==30
 for i,t in enumerate(tables,1):
  blips=t.findall('.//a:blip',ns)
  assert len(blips)==2
  for b,suffix in zip(blips,('d','')):
   target=mapping[b.get('{'+rns+'}embed')]
   embedded=z.read('word/'+target)
   original=(Path('C:/Users/welde/OneDrive/Imagens/Screenshots')/f'{i}{suffix}.png').read_bytes()
   assert hashlib.sha256(embedded).digest()==hashlib.sha256(original).digest()
 print('Verificado: 30 exercícios, 60 imagens, todos os pares na ordem correta e sem alteração das imagens originais.')
