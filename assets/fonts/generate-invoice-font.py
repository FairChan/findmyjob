"""Reproduce the licensed, application-named SC Regular400 asset; no downloads."""
from pathlib import Path
import argparse
import hashlib
import json
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SOURCE_SHA256 = 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964'
LICENSE_SHA256 = '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2'
OUTPUT_SHA256 = 'e04d1f780ce3e7651b3a85ffd5f8b28e847dee53501181099395cb984fde32bc'
ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=ROOT / 'NotoSansSC-VF.ttf')
parser.add_argument('--license', type=Path, default=ROOT / 'LICENSE')
parser.add_argument('--output', type=Path, default=ROOT / 'FindMYJobInvoiceSC-Regular.ttf')
args = parser.parse_args()

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

if fontTools.__version__ != '4.60.1':
    raise SystemExit('Use the pinned fontTools 4.60.1; other versions are not verified.')
if digest(args.source) != SOURCE_SHA256 or digest(args.license) != LICENSE_SHA256:
    raise SystemExit('Upstream font or OFL checksum mismatch.')
font = TTFont(args.source, recalcTimestamp=False)
regular = instantiateVariableFont(font, {'wght': 400}, inplace=False, optimize=True, updateFontNames=True)
family = 'FindMYJobInvoiceSC'
names = {1: family, 2: 'Regular', 3: '1.000;' + family + '-Regular',
         4: family + ' Regular', 6: family + '-Regular', 16: family, 17: 'Regular'}
for record in list(regular['name'].names):
    if record.nameID in names:
        regular['name'].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
assert 'glyf' in regular and all(table not in regular for table in ['fvar', 'gvar', 'CFF ', 'CFF2'])
regular.save(args.output, reorderTables=True)
actual = digest(args.output)
if actual != OUTPUT_SHA256:
    raise SystemExit('Derived font differs from reviewed asset: ' + actual)
print(json.dumps({'output': str(args.output), 'bytes': args.output.stat().st_size,
                  'sha256': actual, 'fontToolsVersion': fontTools.__version__,
                  'weight': 400, 'glyphs': regular['maxp'].numGlyphs,
                  'codePoints': len(regular.getBestCmap())}, indent=2))
