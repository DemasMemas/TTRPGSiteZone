"""Approval-only ambientCG snow candidates in TEMP, no production assets."""
import hashlib
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from urllib.request import Request, urlopen


def fetch(url):
    with urlopen(Request(url, headers={'User-Agent': 'VTT snow approval preview'}), timeout=90) as response:
        return response.read()


def main():
    for asset in sys.argv[1:] or ('Snow001', 'Snow004', 'Snow010A'):
        if asset not in ('Snow001', 'Snow004', 'Snow010A'):
            raise ValueError(f'Unknown snow candidate: {asset}')
        folder = Path(tempfile.gettempdir()) / 'vtt-snow-candidates' / asset
        folder.mkdir(parents=True, exist_ok=True)
        archive_url = f'https://ambientcg.com/get?file={asset}_1K-JPG.zip'
        metadata = json.loads(fetch(f'https://ambientcg.com/api/v2/full_json?id={asset}'))
        raw = fetch(archive_url)
        manifest = {'id': asset, 'sourceUrl': f'https://ambientcg.com/view?id={asset}',
                    'license': 'CC0', 'licenseUrl': 'https://docs.ambientcg.com/license/',
                    'archiveUrl': archive_url, 'archiveSha256': hashlib.sha256(raw).hexdigest(),
                    'metadata': metadata, 'maps': {}}
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            for channel, suffix in [('color', 'Color'), ('normal', 'NormalGL'),
                                    ('ao', 'AmbientOcclusion'), ('roughness', 'Roughness')]:
                names = [n for n in archive.namelist() if n.endswith(f'_{suffix}.jpg')]
                if not names and channel == 'ao':
                    manifest['maps'][channel] = None  # No AO supplied: neutral AO=1.
                    continue
                if len(names) != 1:
                    raise ValueError(f'{asset}: missing/ambiguous {suffix}: {names}')
                content = archive.read(names[0])
                (folder / f'{channel}.jpg').write_bytes(content)
                manifest['maps'][channel] = {'entry': names[0], 'sha256': hashlib.sha256(content).hexdigest()}
        (folder / 'material.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(asset, 'maps:', list(manifest['maps']), 'metadata:', metadata.get('foundAssets', [{}])[0].get('dimensionX'), flush=True)


if __name__ == '__main__':
    main()
