#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

debs=(src-tauri/target/release/bundle/deb/*.deb)
images=(src-tauri/target/release/bundle/appimage/*.AppImage)
[[ ${#debs[@]} -eq 1 && ${#images[@]} -eq 1 ]]
if command -v oofem >/dev/null; then
  echo "O runner de instalação já tem OOFEM no PATH." >&2
  exit 1
fi

smoke="$PWD/package-smoke"
mkdir -p "$smoke/appimage"
sudo unshare --net -- dpkg -i "${debs[0]}"
sudo unshare --net -- runuser -u "$(id -un)" -- env -u OOFEM_BIN \
  /usr/bin/k-struct --check-oofem "$smoke/linux-deb.json"
node scripts/verify-desktop-engine.mjs "$smoke/linux-deb.json"

appimage="$PWD/${images[0]}"
(
  cd "$smoke/appimage"
  "$appimage" --appimage-extract > extract.log
  sudo unshare --net -- runuser -u "$(id -un)" -- env -u OOFEM_BIN \
    "$PWD/squashfs-root/AppRun" --check-oofem "$smoke/linux-appimage.json"
)
node scripts/verify-desktop-engine.mjs "$smoke/linux-appimage.json"
