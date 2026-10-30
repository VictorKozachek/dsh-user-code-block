#!/usr/bin/env bash
#
# Устанавливает dsh-user-code-block в профиль DSH desktop:
#   1) дописывает пакет в dependencies (link:) и в dsh.profile.bundles;
#   2) ставит симлинк в node_modules профиля;
#   3) правит package.json через node, сохраняя форматирование и делая бэкап.
#
# Запускать из любого места: путь пакета вычисляется от расположения скрипта.
# Перед запуском закройте приложение DSH — граф клиентских модулей собирается
# при старте хоста.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(node -p "require('${PKG_DIR}/package.json').name")"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE/package.json"

if [ ! -f "$MANIFEST" ]; then
  echo "не найден манифест профиля: $MANIFEST" >&2
  echo "укажите каталог профиля в DSH_PROFILE_DIR" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MANIFEST" "$MANIFEST.bak.$STAMP"
echo "бэкап: $MANIFEST.bak.$STAMP"

node - "$MANIFEST" "$PKG_NAME" "$PKG_DIR" <<'NODE'
const [, , manifestPath, name, dir] = process.argv;
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.dependencies ??= {};
manifest.dependencies[name] = `link:${dir}`;

manifest.dsh ??= {};
manifest.dsh.profile ??= {};
const bundles = (manifest.dsh.profile.bundles ??= []);
if (!bundles.includes(name)) bundles.push(name);

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`манифест обновлён: dependencies += ${name}, bundles += ${name}`);
NODE

LINK="$PROFILE/node_modules/$PKG_NAME"
mkdir -p "$(dirname "$LINK")"
rm -f "$LINK"
ln -s "$PKG_DIR" "$LINK"
echo "симлинк: $LINK -> $PKG_DIR"

echo
echo "готово. перезапустите приложение DSH, затем отправьте сообщение с блоком кода."
echo "откат: $PKG_DIR/uninstall.sh"
