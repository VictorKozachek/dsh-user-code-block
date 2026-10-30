#!/usr/bin/env bash
#
# Install dsh-user-code-block into a DSH profile:
#   1) add the package to dependencies (link:) and to dsh.profile.bundles;
#   2) create the symlink in the profile's node_modules;
#   3) edit package.json through node, keeping formatting and taking a backup.
#
# Run it from anywhere: the package path is derived from the script location.
# Close the DSH application first — the client module graph is built when the
# host starts.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_NAME="$(node -p "require('${PKG_DIR}/package.json').name")"
PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
MANIFEST="$PROFILE/package.json"

if [ ! -f "$MANIFEST" ]; then
  echo "profile manifest not found: $MANIFEST" >&2
  echo "point DSH_PROFILE_DIR at the profile directory" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$MANIFEST" "$MANIFEST.bak.$STAMP"
echo "backup: $MANIFEST.bak.$STAMP"

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
console.log(`manifest updated: dependencies += ${name}, bundles += ${name}`);
NODE

LINK="$PROFILE/node_modules/$PKG_NAME"
mkdir -p "$(dirname "$LINK")"
rm -f "$LINK"
ln -s "$PKG_DIR" "$LINK"
echo "symlink: $LINK -> $PKG_DIR"

echo
echo "done. Restart the DSH application, then send a message with a code block."
echo "rollback: $PKG_DIR/uninstall.sh"
