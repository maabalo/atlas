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

# Atlas keeps a map live in the background while it's open (atlas_live.py), so it has no Dock icon or menu
# (LSUIElement). It stops by itself a few minutes after the map's tab is closed. Changing Info.plist breaks
# PyInstaller's ad-hoc signature, so the app is signed again (ad hoc, this Mac only).
PLIST="dist/Atlas.app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Delete :LSUIElement" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"
codesign --force --deep --sign - dist/Atlas.app

echo "Built: $PWD/dist/Atlas.app"
