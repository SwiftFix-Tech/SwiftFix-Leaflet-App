"""Package an audited immutable release separately from application source."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


def package(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    version = manifest['dataset']
    if manifest.get('format') != 'swiftfix-road-cells' or manifest.get('version') != 1 or not re.fullmatch(r'[a-zA-Z0-9_-]{1,64}', version):
        raise ValueError('Invalid release manifest.')
    if not manifest.get('cells') or not all(isinstance(c, str) and re.fullmatch(r'\d{1,4}/\d{1,4}', c) for c in manifest['cells']):
        raise ValueError('Invalid road cell paths.')
    paths = [Path('manifest.json'), Path('README.md')] + [Path(version) / '12' / f'{cell}.json.gz' for cell in manifest['cells']]
    if len(set(paths)) != len(paths):
        raise ValueError('Duplicate manifest paths.')
    for relative in paths:
        file = (root / relative).resolve()
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError(f'Missing or unsafe asset: {relative}')
    output.parent.mkdir(parents=True, exist_ok=True)
    # Cells are already gzip-compressed. Avoid recompressing and never overwrite an existing archive.
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_STORED) as archive:
        for relative in paths:
            archive.write(root / relative, 'roads/' + relative.as_posix())
    with zipfile.ZipFile(output) as archive:
        damaged = archive.testzip()
        if damaged:
            raise ValueError(f'ZIP CRC failed: {damaged}')
        assert len(archive.infolist()) == len(paths)
    with output.open('rb') as file:
        sha = hashlib.file_digest(file, 'sha256').hexdigest()
    report = {'dataset': version, 'archive': str(output), 'files': len(paths), 'bytes': output.stat().st_size,
              'sha256': sha, 'crcVerified': True,
              'exceedsGitHub100MiBFileLimit': output.stat().st_size > 100 * 1024 * 1024}
    print(json.dumps(report, indent=2), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='public/roads')
    parser.add_argument('--output', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    report = package(args.root, args.output)
    Path(args.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
