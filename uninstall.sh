#!/usr/bin/env bash
#
# Снимает dsh-user-code-block с профиля DSH desktop: убирает пакет из
# dependencies и dsh.profile.bundles, удаляет симлинк из node_modules.
# Сам каталог пакета не трогается.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(node -p "require('${PKG_DIR}/package.json').name")"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE/package.json"

if [ ! -f "$MANIFEST" ]; then
  echo "не найден манифест профиля: $MANIFEST" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MANIFEST" "$MANIFEST.bak.$STAMP"
echo "бэкап: $MANIFEST.bak.$STAMP"

node - "$MANIFEST" "$PKG_NAME" <<'NODE'
const [, , manifestPath, name] = process.argv;
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.dependencies) delete manifest.dependencies[name];

const bundles = manifest.dsh?.profile?.bundles;
if (Array.isArray(bundles)) {
  const at = bundles.indexOf(name);
  if (at !== -1) bundles.splice(at, 1);
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`манифест обновлён: ${name} убран`);
NODE

LINK="$PROFILE/node_modules/$PKG_NAME"
if [ -L "$LINK" ] || [ -e "$LINK" ]; then
  rm -f "$LINK"
  echo "симлинк удалён: $LINK"
fi

echo
echo "готово. перезапустите приложение DSH."
