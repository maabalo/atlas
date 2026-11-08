#!/bin/sh
# Build dist/Atlas.app for this Mac. Run from anywhere: sh packaging/build_app.sh
# PyInstaller stays in the gitignored .venv; running Atlas itself still needs nothing.
set -eu
cd "$(dirname "$0")/.."

python3 -m venv .venv
.venv/bin/pip install --quiet "pyinstaller==6.22.3"

.venv/bin/pyinstaller --noconfirm --clean --windowed --onedir \
  --name Atlas \
  --osx-bundle-identifier io.github.maabalo.atlas \
  --icon "$PWD/packaging/Atlas.icns" \
  --add-data "$PWD/viewer:viewer" \
  --distpath dist --workpath build --specpath build \
  atlas_app.py

echo "Built: $PWD/dist/Atlas.app"
