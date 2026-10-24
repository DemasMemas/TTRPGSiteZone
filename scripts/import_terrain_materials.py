"""Fetch only the selected Poly Haven 1K terrain maps, verifying API checksums.

Run from the repository root. Existing earth, forest and rusty metal are reused.
No archives or duplicate source images are retained.
"""
import hashlib
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ASSETS = (
    'rock_face', 'quarry_wall', 'concrete_pavement_02', 'sand_03',
    'rocky_gravel', 'snow_field_aerial', 'mud_forest',
    'concrete_floor_worn_001', 'gravel_stones', 'aerial_beach_01', 'snow_02', 'dense_sand',
)
ROOT = Path(__file__).resolve().parents[1] / 'app/static/materials/terrain'


def fetch(url):
    request = Request(url, headers={
        'User-Agent': 'TTRPGSiteZone terrain material importer (local development)',
    })
    with urlopen(request, timeout=60) as response:
        return response.read()


def main():
    for asset in sys.argv[1:] or ASSETS:
        if asset not in ASSETS:
            raise ValueError(f'Unapproved terrain asset: {asset}')
        metadata = json.loads(fetch(f'https://api.polyhaven.com/files/{asset}'))
        folder = ROOT / asset
        folder.mkdir(parents=True, exist_ok=True)
        maps = {}
        for channel, key in [('color', 'Diffuse'), ('normal', 'nor_gl'), ('arm', 'arm')]:
            entry = metadata[key]['1k']['jpg']
            target = folder / f'{channel}.jpg'
            content = target.read_bytes() if target.exists() else b''
            if hashlib.md5(content).hexdigest() != entry['md5']:
                content = fetch(entry['url'])
            if hashlib.md5(content).hexdigest() != entry['md5']:
                raise ValueError(f'Checksum mismatch: {asset}/{channel}')
            if not target.exists() or target.read_bytes() != content:
                target.write_bytes(content)
            maps[channel] = {'file': target.name, 'url': entry['url'],
                             'md5': entry['md5'], 'sha256': hashlib.sha256(content).hexdigest()}
        manifest = {'id': asset, 'sourceUrl': f'https://polyhaven.com/a/{asset}',
                    'license': 'CC0', 'resolution': '1k', 'normalFormat': 'OpenGL', 'maps': maps}
        (folder / 'material.json').write_text(
            json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        print(f'{asset}: verified Color / Normal GL / ARM 1K', flush=True)


if __name__ == '__main__':
    main()
