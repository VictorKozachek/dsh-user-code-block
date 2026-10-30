/**
 * Проверки самого пакета: манифест, хост-половина, связность id.
 *
 * Браузерную половину тестирует `matcher.test.mjs`; здесь — то, что делает
 * пакет плагином DSH: объявление клиентской половины, слой патча и имя модуля.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { apply } from "../lib/index.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const clientSource = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

test("хост-половина экспортирует пустой apply", () => {
  assert.equal(typeof apply, "function");
  assert.equal(apply(), void 0, "серверной логики нет");
});

test("манифест объявляет клиентскую половину", () => {
  assert.equal(manifest.dsh.client.platform, "web");
  assert.equal(manifest.exports["./client"], "./lib/client.js");
  assert.equal(manifest.main, "lib/index.js");
});

test("манифест подключает слой патча", () => {
  assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml");
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.ok(patch.includes(manifest.name), "патч монтирует ряд с именем пакета");
});

test("id браузерного модуля совпадает с именем пакета", () => {
  assert.ok(
    clientSource.includes(`id: "${manifest.name}"`),
    "загрузчик ищет модуль по имени пакета",
  );
});

test("клиентская половина экспортирует apply и inject", () => {
  let captured;
  new Function("window", clientSource)({ __ModuleLoader__: { load: (registration) => void (captured = registration) } });
  assert.ok(captured, "скрипт регистрирует модуль");
  const exports = captured.factory(() => ({ createElement: () => null, useState: (value) => [value, () => {}], useEffect: () => void 0 }));
  assert.equal(typeof exports.apply, "function");
  assert.deepEqual(exports.inject, ["slots", "uiConversation"]);
});
