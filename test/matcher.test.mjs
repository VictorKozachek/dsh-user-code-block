/**
 * Проверки матчера забора кода. Рендерер здесь не монтируется: клиентская
 * половина — браузерный скрипт, поэтому тест поднимает фальшивый
 * `window.__ModuleLoader__`, забирает фабрику и вызывает её с заглушкой React.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** Заглушка модуля react: тесту важны структура и координаты, а не рендер в DOM. */
const reactStub = {
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => void 0,
};

/** Загрузить клиентскую половину и вернуть внутренности плагина. */
function load() {
  let captured;
  const win = { __ModuleLoader__: { load: (registration) => void (captured = registration) } };
  new Function("window", source)(win);
  assert.ok(captured, "скрипт должен зарегистрировать модуль");
  assert.equal(captured.id, "dsh-user-code-block");
  const factory = captured.factory;
  return factory((id) => {
    if (id !== "react") throw new Error(`unexpected require: ${id}`);
    return reactStub;
  });
}

const { findFence, UserCodeBlock, highlight, renderCode, normalizeLang } = load().__internals;

test("распознаёт блок с языком и возвращает тело без заборов", () => {
  const text = '```python\ndef hello():\n    print("hi")\n```';
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.lang, "python");
  assert.equal(found.data.code, 'def hello():\n    print("hi")');
  assert.equal(found.start, 0);
  assert.equal(found.end, text.length);
});

test("блок без языка даёт пустой lang", () => {
  const found = findFence("```\nplain\n```", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "");
  assert.equal(found.data.code, "plain");
});

test("тильды работают так же, как обратные кавычки", () => {
  const found = findFence("~~~js\nlet a = 1;\n~~~", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "js");
  assert.equal(found.data.code, "let a = 1;");
});

test("сохраняет пустые строки внутри блока", () => {
  const found = findFence("```\na\n\nb\n```", 0);
  assert.ok(found);
  assert.equal(found.data.code, "a\n\nb");
});

test("блок в середине текста смещает start и end", () => {
  const text = "вступление\n```js\nx\n```\nпосле";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.start, "вступление\n".length);
  assert.equal(text.slice(found.start, found.end), "```js\nx\n```");
});

test("незакрытый забор блоком не считается", () => {
  assert.equal(findFence("```python\nprint(1)", 0), void 0);
});

test("первый закрытый забор забирает ближайшее закрытие", () => {
  const text = "```\nвисящий\n```\n```js\nok\n```";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.code, "висящий", "первый (висящий) блок закрыт тем же забором ниже");
});

test("одинарные обратные кавычки — не блок", () => {
  assert.equal(findFence("это `код` в строке", 0), void 0);
});

test("забор из четырёх кавычек вмещает тройные внутри", () => {
  const text = "````md\n```js\ninner\n```\n````";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.lang, "md");
  assert.equal(found.data.code, "```js\ninner\n```");
});

test("отступ до трёх пробелов допустим", () => {
  const found = findFence("   ```js\nx\n   ```", 0);
  assert.ok(found);
  assert.equal(found.data.code, "x");
});

test("четыре пробела отступа — уже не забор", () => {
  assert.equal(findFence("    ```js\nx\n```", 0), void 0);
});

test("поиск продолжается после from", () => {
  const text = "```a\none\n```\n```b\ntwo\n```";
  const second = findFence(text, text.indexOf("```b"));
  assert.ok(second);
  assert.equal(second.data.lang, "b");
  assert.equal(second.data.code, "two");
});

test("забор, начавшийся до from, не предлагается", () => {
  const text = "```a\none\n```";
  assert.equal(findFence(text, 3), void 0);
});

test("язык берётся из информационной строки первым словом", () => {
  const found = findFence("```python title=app.py\nx\n```", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "python");
});

test("рендерер строит шапку и подсвеченный pre", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "python", code: "def f():\n    return 1" } } });
  const [tag, props, ...children] = tree.args;
  assert.equal(tag, "span");
  assert.equal(props.style.display, "block", "рамка блока — блочный элемент");
  assert.equal(children.length, 2, "шапка и код");

  const [header, pre] = children;
  assert.equal(header.args[0], "span");
  const label = header.args[2];
  assert.equal(label.args[0], "span");
  assert.equal(label.args[2], "python", "в шапке стоит язык из забора");

  assert.equal(pre.args[0], "pre");
  assert.equal(pre.args[1].style.whiteSpace, "pre", "пробелы в коде значимы");

  const nodes = pre.args[2].args[2];
  assert.ok(Array.isArray(nodes), "тело кода — набор узлов подсветки");
  const colored = nodes.filter((node) => node !== null && typeof node === "object");
  assert.ok(
    colored.some((node) => node.args[1].style.color.includes("--shiki-token-keyword") && node.args[2] === "def"),
    "def окрашен как ключевое слово темой",
  );
});

test("без языка шапка остаётся, плашка пустая, код без разметки", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "", code: "x" } } });
  const children = tree.args.slice(2);
  assert.equal(children.length, 2, "шапка и код");
  assert.equal(children[0].args[2].args[2], "", "плашки языка нет");
  assert.deepEqual(children[1].args[2].args[2], ["x"]);
});

test("кнопка копирования есть при доступном clipboard и копирует исходный код", async () => {
  const written = [];
  // В Node `navigator` объявлен геттером, поэтому подменяем дескриптор, а не значение.
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: (text) => (written.push(text), Promise.resolve()) } },
  });
  try {
    const tree = UserCodeBlock({ node: { data: { lang: "bash", code: "echo hi" } } });
    const header = tree.args[2];
    const button = header.args.slice(2).find((child) => child !== null && typeof child === "object" && child.args[0] === "button");
    assert.ok(button, "кнопка копирования отрисована");
    button.args[1].onClick();
    assert.deepEqual(written, ["echo hi"], "в буфер уходит исходный код без подсветки");
  } finally {
    if (original === void 0) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", original);
  }
});

test("без clipboard кнопки нет", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "bash", code: "x" } } });
  const header = tree.args[2];
  const button = header.args.slice(2).find((child) => child !== null && typeof child === "object" && child.args[0] === "button");
  assert.equal(button, void 0);
});

test("go: ключевые слова, функция и литералы", () => {
  const tokens = highlight("func main() { var x = nil }", "go");
  const types = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(types.get("func"), "keyword");
  assert.equal(types.get("var"), "keyword");
  assert.equal(types.get("main"), "function");
  assert.equal(types.get("nil"), "constant");
});

test("rust: fn, let и None", () => {
  const types = new Map(highlight("fn main() { let x = None; }", "rust").map((t) => [t.text, t.type]));
  assert.equal(types.get("fn"), "keyword");
  assert.equal(types.get("let"), "keyword");
  assert.equal(types.get("None"), "constant");
});

test("java: модификаторы, класс и null", () => {
  const types = new Map(highlight("public class A { private int x = 0; }", "java").map((t) => [t.text, t.type]));
  assert.equal(types.get("public"), "keyword");
  assert.equal(types.get("class"), "keyword");
  assert.equal(types.get("int"), "keyword");
  assert.equal(types.get("0"), "constant");
});

test("html: теги, атрибуты и значения", () => {
  const tokens = highlight('<div class="a">текст</div>', "html");
  const byText = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(byText.get("div"), "keyword");
  assert.equal(byText.get("class"), "function");
  assert.equal(byText.get('"a"'), "string");
  assert.ok(tokens.some((token) => token.type === "plain" && token.text.includes("текст")));
});

test("html: комментарий разбирается целиком", () => {
  const tokens = highlight("<!-- скрыто -->", "html");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "comment");
});

test("транскрипты терминала и текстовые заборы не подсвечиваются", () => {
  assert.equal(highlight("+ set -euo pipefail", "text"), null);
  assert.equal(highlight("какой-то вывод", "console"), null);
  assert.equal(highlight("лог", "log"), null);
  assert.equal(normalizeLang("console"), "");
});

test("python: комментарий, ключевое слово, функция, строка и число различаются", () => {
  const tokens = highlight("# c\ndef f(x):\n    return 'hi' + 42", "python");
  const types = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(types.get("# c"), "comment");
  assert.equal(types.get("def"), "keyword");
  assert.equal(types.get("f"), "function");
  assert.equal(types.get("'hi'"), "string");
  assert.equal(types.get("return"), "keyword");
  assert.equal(types.get("42"), "constant");
});

test("имя со скобкой красится как функция, без скобки — обычный текст", () => {
  assert.equal(highlight("len(x)", "python")[0].type, "function");
  const plain = highlight("total = 1", "python").find((token) => token.text === "total");
  assert.equal(plain.type, "plain");
});

test("алиасы языков приводятся к каноническим", () => {
  assert.equal(normalizeLang("py"), "python");
  assert.equal(normalizeLang("TS"), "javascript");
  assert.equal(normalizeLang("sh"), "bash");
  assert.equal(normalizeLang(""), "");
});

test("тройные кавычки python дают один строковый токен", () => {
  const strings = highlight('x = """a\nb"""', "python").filter((token) => token.type === "string");
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, '"""a\nb"""');
});

test("json подсвечивает ключи-строки и литералы", () => {
  const tokens = highlight('{"a": true}', "json");
  assert.ok(tokens.some((token) => token.type === "string" && token.text === '"a"'));
  assert.ok(tokens.some((token) => token.type === "constant" && token.text === "true"));
});

test("go: встроенные типы и имена-константы", () => {
  const types = new Map(highlight("var n int = 4\nconst MAX_SIZE = 10", "go").map((token) => [token.text, token.type]));
  assert.equal(types.get("int"), "type", "int — предобъявленный тип, не ключевое слово");
  assert.equal(types.get("MAX_SIZE"), "constant", "КАПС-имя считается константой");
  assert.equal(types.get("n"), "plain");
});

test("python: типы в аннотациях", () => {
  const types = new Map(highlight("def f(x: int) -> str:", "python").map((token) => [token.text, token.type]));
  assert.equal(types.get("int"), "type");
  assert.equal(types.get("str"), "type");
  assert.equal(types.get("f"), "function");
});

test("java: класс-обёртка — тип, примитив — ключевое слово", () => {
  const types = new Map(highlight("String name = null; int n = 0;", "java").map((token) => [token.text, token.type]));
  assert.equal(types.get("String"), "type");
  assert.equal(types.get("int"), "keyword");
});

test("css: имя свойства красится, значение — нет", () => {
  const types = new Map(highlight("color: red;", "css").map((token) => [token.text, token.type]));
  assert.equal(types.get("color"), "type");
  assert.equal(types.get("red"), "plain");
});

test("вызов встроенного типа остаётся функцией, а не типом", () => {
  assert.equal(highlight("int('5')", "python")[0].type, "function");
});

test("css: свойство с дефисом разбирается целиком", () => {
  const types = new Map(highlight("font-size: 14px;", "css").map((token) => [token.text, token.type]));
  assert.equal(types.get("font-size"), "type");
  assert.equal(types.get("14"), "constant");
});
