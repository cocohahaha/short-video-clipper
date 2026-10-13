#!/usr/bin/env python3
"""Package local MV3 sources without changing the existing installed directory."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = ROOT.parent
INSTALL_ZIP = OUTPUT_DIR / 'short-video-clipper-install.zip'
SOURCE_ZIP = OUTPUT_DIR / 'short-video-clipper-source.zip'
CHECKSUMS = OUTPUT_DIR / 'SHA256SUMS-short-video-clipper.txt'
ARCHIVE_ROOT = 'short-video-clipper/'
# A fixed timestamp keeps unchanged source packages reproducible.
ZIP_DATE = (2026, 10, 12, 0, 0, 0)

assert (ROOT / 'core-main.js').read_bytes() == (ROOT / 'core.js').read_bytes(), 'core copies differ'
manifest = json.loads((ROOT / 'manifest.json').read_text())
package = json.loads((ROOT / 'package.json').read_text())
assert manifest['manifest_version'] == 3, 'expected MV3'
assert manifest['version'] == package['version'] == '0.2.0', 'version mismatch'

install_files = [
    'manifest.json', 'core-main.js', 'core.js', 'observer.js', 'content.js',
    'background.js', 'popup.html', 'popup.css', 'popup.js', 'README.md', 'TEST-REPORT.md', 'LICENSE',
]
install_files += [f'icons/icon{size}.png' for size in (16, 32, 48, 128)]


def write_archive(destination, relative_names):
    expected = [ARCHIVE_ROOT + name for name in sorted(relative_names)]
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for name in sorted(relative_names):
            info = ZipInfo(ARCHIVE_ROOT + name, date_time=ZIP_DATE)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    with ZipFile(destination) as archive:
        assert archive.testzip() is None, 'ZIP integrity check failed'
        assert archive.namelist() == expected, 'archive file list differs'


write_archive(INSTALL_ZIP, install_files)
source_files = [
    file.relative_to(ROOT).as_posix()
    for file in ROOT.rglob('*')
    if file.is_file()
    and not any(part in {'__pycache__', '.git', 'node_modules', '.pytest_cache'} for part in file.parts)
    and file.name != '.DS_Store'
    and file.suffix not in {'.pyc', '.pyo'}
]
write_archive(SOURCE_ZIP, source_files)
CHECKSUMS.write_text(''.join(
    f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n'
    for file in (INSTALL_ZIP, SOURCE_ZIP)
))
for file in (INSTALL_ZIP, SOURCE_ZIP):
    print(f'Built {file.name}: {file.stat().st_size:,} bytes; ZIP integrity PASS')
print(f'Checksums: {CHECKSUMS.name}')
