#!/usr/bin/env bash
#
# Remove dsh-user-code-block from a DSH profile: drop the package from
# dependencies and dsh.profile.bundles, delete the symlink from node_modules.
# The package directory itself is left untouched.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(node -p "require('${PKG_DIR}/package.json').name")"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE/package.json"

if [ ! -f "$MANIFEST" ]; then
  echo "profile manifest not found: $MANIFEST" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MANIFEST" "$MANIFEST.bak.$STAMP"
echo "backup: $MANIFEST.bak.$STAMP"

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
console.log(`manifest updated: ${name} removed`);
NODE

LINK="$PROFILE/node_modules/$PKG_NAME"
if [ -L "$LINK" ] || [ -e "$LINK" ]; then
  rm -f "$LINK"
  echo "symlink removed: $LINK"
fi

echo
echo "done. Restart the DSH application."
