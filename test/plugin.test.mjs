/**
 * Package-level checks: the manifest, the host half and the id wiring.
 *
 * The browser half is covered by `matcher.test.mjs`; here we verify what makes
 * the package a DSH plugin: the client declaration, the patch layer and the
 * module id.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { apply } from "../lib/index.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clientSource = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

test("the host half exports an empty apply", () => {
  assert.equal(typeof apply, "function");
  assert.equal(apply(), void 0, "there is no server logic");
});

test("the manifest declares the client half", () => {
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal(manifest.exports["./client"], "./lib/client.js");
  assert.equal(manifest.main, "lib/index.js");
});

test("the manifest mounts the patch layer", () => {
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.ok(patch.includes(manifest.name), "the patch mounts a row named after the package");
});

test("the browser module id matches the package name", () => {
  assert.ok(
    clientSource.includes(`id: "${manifest.name}"`),
    "the loader resolves the module by the package name",
  );
});

test("the client half exports apply and inject", () => {
  let captured;
  new Function("window", clientSource)({ __ModuleLoader__: { load: (registration) => void (captured = registration) } });
  assert.ok(captured, "the script registers the module");
  const exports = captured.factory(() => ({ createElement: () => null, useState: (value) => [value, () => {}], useEffect: () => void 0 }));
  assert.equal(typeof exports.apply, "function");
  assert.deepEqual(exports.inject, ["slots", "uiConversation"]);
});
