"""Build a reproducible static-site ZIP, using only Python's standard library.

Run from anywhere: python ios-pwa/package-release.py
Node.js is used to run the existing release checks before packaging.
"""
import ast
import hashlib
import io
import json
import re
import subprocess
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def make_release():
    for command in (
        ['node', '--test', 'tests/test-domain.js', 'tests/test-shell.js', 'tests/test-users.js', 'tests/test-charts.js'],
        ['node', 'tests/test-template.js'],
    ):
        subprocess.run(command, cwd=ROOT, check=True)

    worker = (ROOT / 'sw.js').read_text(encoding='utf-8')
    version_match = re.search(r'const VERSION\s*=\s*[\'"]([A-Za-z0-9][A-Za-z0-9.-]*)[\'"]', worker)
    shell_match = re.search(r'const SHELL\s*=\s*(\[[\s\S]*?\])\s*\.map', worker)
    if not version_match or not shell_match:
        raise ValueError('Cannot identify VERSION / SHELL in sw.js')
    version = version_match.group(1)
    shell = ast.literal_eval(shell_match.group(1))
    names = {'sw.js'}
    for item in shell:
        if not isinstance(item, str) or not item.startswith('./'):
            raise ValueError('Release shell must use relative local paths')
        name = item[2:] or 'index.html'
        source = (ROOT / name).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():
            raise ValueError('Missing or out-of-scope asset: ' + name)
        names.add(name)
    names.update({
        'js/vendor/vue-LICENSE.txt', 'js/vendor/echarts-LICENSE.txt',
        'js/vendor/echarts-LICENSE-d3.txt', 'js/vendor/echarts-NOTICE.txt',
        'js/vendor/README.md',
    })
    payload = {name: (ROOT / name).read_bytes() for name in sorted(names)}
    payload['INSTALL.txt'] = (
        'Wallet iOS PWA - static site\n'
        'Extract the contents of this ZIP into your HTTPS static-site directory.\n'
        'index.html must be at that directory root. No build or backend is required.\n'
        'Keep all relative paths. Serve sw.js with a JavaScript MIME type and no-cache.\n'
        'Open the HTTPS URL in iPhone Safari, then Add to Home Screen.\n'
        'Wait for offline readiness in Settings before testing airplane mode.\n'
        'User records stay in IndexedDB; this package contains no account data.\n'
        'Keep the origin and path stable. Export a full JSON backup before moving URLs.\n'
        'See js/vendor/ for third-party license notices.\n'
    ).encode('utf-8')
    manifest = {
        'application': 'Wallet iOS PWA',
        'cacheVersion': version,
        'files': {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(payload.items())},
    }
    payload['release-manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    archive_bytes = io.BytesIO()
    with zipfile.ZipFile(archive_bytes, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data, compresslevel=9)
    data = archive_bytes.getvalue()
    # Verify the final archive, including every byte and the complete file allowlist.
    with zipfile.ZipFile(io.BytesIO(data), 'r') as archive:
        if set(archive.namelist()) != set(payload) or archive.testzip() is not None:
            raise ValueError('Archive file list or CRC verification failed')
        for name, content in payload.items():
            if archive.read(name) != content:
                raise ValueError('Archive content differs: ' + name)

    folder = ROOT / 'release'
    folder.mkdir(exist_ok=True)
    destination = folder / f'wallet-ios-pwa-{version}.zip'
    if destination.exists():
        if destination.read_bytes() != data:
            raise FileExistsError('Different release already uses this VERSION; increment sw.js VERSION first')
    else:
        with destination.open('xb') as stream:
            stream.write(data)
    checksum = hashlib.sha256(data).hexdigest()
    destination.with_suffix('.sha256').write_text(f'{checksum}  {destination.name}\n', encoding='ascii')
    print(f'RELEASE: {destination}')
    print(f'FILES: {len(payload)} | BYTES: {len(data)} | SHA256: {checksum}')
    print('Verified complete runtime shell, source-byte equality, ZIP CRC and excluded test/user data.')


if __name__ == '__main__':
    make_release()
