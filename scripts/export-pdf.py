"""Lossless A5 manga export. MANGA_PROJECT selects the work; no title/cast constants."""
import hashlib
import io
import json
import os
import sys
from pathlib import Path
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DictionaryObject
from reportlab.lib.pagesizes import A5
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

root = Path(__file__).resolve().parent.parent
def local(relative):
    candidate = (root / relative).resolve()
    if Path(relative).is_absolute() or not candidate.is_relative_to(root) or candidate == root:
        raise ValueError('Path escapes workspace')
    return candidate

config = json.loads(local(os.environ['MANGA_PROJECT']).read_text(encoding='utf-8'))
destination = local(config['outputDir'] + '/pdf/manga.pdf')
sources = [local(config['outputDir'] + '/page-' + p['id'] + '.png') for p in config['pages']]
assert sources, 'No pages'
for source in sources:
    with Image.open(source) as img:
        assert img.format == 'PNG' and img.size == (1024, 1536), 'Export final page PNGs first'
width, height = A5

if sys.argv[1] == 'create':
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=A5, invariant=1, pageCompression=1)
    c.setTitle(config['title'])
    c.setAuthor(config.get('author', ''))
    c.setSubject(f"{len(sources)} pages / A5")
    for source in sources:
        image = ImageReader(str(source))
        iw, ih = image.getSize()
        scale = min(width / iw, height / ih)
        dw, dh = iw * scale, ih * scale
        c.drawImage(image, (width-dw)/2, (height-dh)/2, width=dw, height=dh)
        c.showPage()
    c.save()
    stream.seek(0)
    writer = PdfWriter()
    writer.clone_document_from_reader(PdfReader(stream))
    writer.root_object[NameObject('/ViewerPreferences')] = DictionaryObject({NameObject('/Direction'): NameObject('/R2L')})
    writer.page_layout = '/SinglePage'
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.pdf.tmp')
    with temporary.open('wb') as out:
        writer.write(out)
    temporary.replace(destination)
else:
    assert sys.argv[1] == 'verify', 'Use create | verify'

reader = PdfReader(str(destination))
assert len(reader.pages) == len(sources), 'Wrong page count'
assert reader.trailer['/Root']['/ViewerPreferences']['/Direction'] == '/R2L'
for page, source in zip(reader.pages, sources):
    assert abs(float(page.mediabox.width)-width) < .01
    assert abs(float(page.mediabox.height)-height) < .01
    assert len(page.images) == 1
    actual = page.images[0].image.convert('RGB')
    with Image.open(source) as original:
        expected = original.convert('RGB')
        assert actual.size == expected.size and actual.tobytes() == expected.tobytes(), 'PDF image changed or out of order'
print(f'PASS: {len(sources)} A5 pages; embedded pixels match original PNGs: {destination}')
