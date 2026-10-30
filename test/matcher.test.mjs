/**
 * Fence matcher and lexer checks. No renderer is mounted here: the client half is
 * a browser script, so the test installs a fake `window.__ModuleLoader__`,
 * captures the factory and calls it with a React stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");

/** React stub: the tests care about structure and offsets, not about the DOM. */
const reactStub = {
  createElement: (...args) => ({ args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => void 0,
};

/** Load the client half and return the plugin internals. */
function load() {
  let captured;
  const win = { __ModuleLoader__: { load: (registration) => void (captured = registration) } };
  new Function("window", source)(win);
  assert.ok(captured, "the script must register the module");
  assert.equal(captured.id, "dsh-user-code-block");
  const factory = captured.factory;
  return factory((id) => {
    if (id !== "react") throw new Error(`unexpected require: ${id}`);
    return reactStub;
  });
}

const { findFence, UserCodeBlock, highlight, renderCode, normalizeLang } = load().__internals;

test("recognizes a block with a language and returns the body without fences", () => {
  const text = '```python\ndef hello():\n    print("hi")\n```';
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.lang, "python");
  assert.equal(found.data.code, 'def hello():\n    print("hi")');
  assert.equal(found.start, 0);
  assert.equal(found.end, text.length);
});

test("a block without a language yields an empty lang", () => {
  const found = findFence("```\nplain\n```", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "");
  assert.equal(found.data.code, "plain");
});

test("tildes work the same as backticks", () => {
  const found = findFence("~~~js\nlet a = 1;\n~~~", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "js");
  assert.equal(found.data.code, "let a = 1;");
});

test("keeps empty lines inside the block", () => {
  const found = findFence("```\na\n\nb\n```", 0);
  assert.ok(found);
  assert.equal(found.data.code, "a\n\nb");
});

test("a block in the middle of the text shifts start and end", () => {
  // Cyrillic prefix keeps the offset math honest for multi-byte characters.
  const text = "вступление\n```js\nx\n```\nпосле";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.start, "вступление\n".length);
  assert.equal(text.slice(found.start, found.end), "```js\nx\n```");
});

test("an unclosed fence is not a block", () => {
  assert.equal(findFence("```python\nprint(1)", 0), void 0);
});

test("the first closed fence takes the nearest closing fence", () => {
  const text = "```\nвисящий\n```\n```js\nok\n```";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.code, "висящий", "the first (dangling) block is closed by the fence below");
});

test("single backticks are not a block", () => {
  assert.equal(findFence("это `код` в строке", 0), void 0);
});

test("a four-backtick fence contains triple backticks inside", () => {
  const text = "````md\n```js\ninner\n```\n````";
  const found = findFence(text, 0);
  assert.ok(found);
  assert.equal(found.data.lang, "md");
  assert.equal(found.data.code, "```js\ninner\n```");
});

test("up to three spaces of indentation is allowed", () => {
  const found = findFence("   ```js\nx\n   ```", 0);
  assert.ok(found);
  assert.equal(found.data.code, "x");
});

test("four spaces of indentation is no longer a fence", () => {
  assert.equal(findFence("    ```js\nx\n```", 0), void 0);
});

test("search continues after from", () => {
  const text = "```a\none\n```\n```b\ntwo\n```";
  const second = findFence(text, text.indexOf("```b"));
  assert.ok(second);
  assert.equal(second.data.lang, "b");
  assert.equal(second.data.code, "two");
});

test("a fence that started before from is not offered", () => {
  const text = "```a\none\n```";
  assert.equal(findFence(text, 3), void 0);
});

test("the language is the first word of the info string", () => {
  const found = findFence("```python title=app.py\nx\n```", 0);
  assert.ok(found);
  assert.equal(found.data.lang, "python");
});

test("the renderer builds a header and a highlighted pre", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "python", code: "def f():\n    return 1" } } });
  const [tag, props, ...children] = tree.args;
  assert.equal(tag, "span");
  assert.equal(props.style.display, "block", "the block frame is a block-level element");
  assert.equal(children.length, 2, "header and code");

  const [header, pre] = children;
  assert.equal(header.args[0], "span");
  const label = header.args[2];
  assert.equal(label.args[0], "span");
  assert.equal(label.args[2], "python", "the header shows the language from the fence");

  assert.equal(pre.args[0], "pre");
  assert.equal(pre.args[1].style.whiteSpace, "pre", "whitespace in code is significant");

  const nodes = pre.args[2].args[2];
  assert.ok(Array.isArray(nodes), "the code body is a set of highlighting nodes");
  const colored = nodes.filter((node) => node !== null && typeof node === "object");
  assert.ok(
    colored.some((node) => node.args[1].style.color.includes("--shiki-token-keyword") && node.args[2] === "def"),
    "def is colored as a keyword by the theme",
  );
});

test("without a language the header stays, the label is empty, the code is raw", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "", code: "x" } } });
  const children = tree.args.slice(2);
  assert.equal(children.length, 2, "header and code");
  assert.equal(children[0].args[2].args[2], "", "no language label");
  assert.deepEqual(children[1].args[2].args[2], ["x"]);
});

test("the copy button appears when clipboard is available and copies the raw code", async () => {
  const written = [];
  // In Node `navigator` is a getter, so replace the descriptor rather than the value.
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: (text) => (written.push(text), Promise.resolve()) } },
  });
  try {
    const tree = UserCodeBlock({ node: { data: { lang: "bash", code: "echo hi" } } });
    const header = tree.args[2];
    const button = header.args.slice(2).find((child) => child !== null && typeof child === "object" && child.args[0] === "button");
    assert.ok(button, "the copy button is rendered");
    button.args[1].onClick();
    assert.deepEqual(written, ["echo hi"], "the clipboard receives the raw code without markup");
  } finally {
    if (original === void 0) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", original);
  }
});

test("without clipboard there is no button", () => {
  const tree = UserCodeBlock({ node: { data: { lang: "bash", code: "x" } } });
  const header = tree.args[2];
  const button = header.args.slice(2).find((child) => child !== null && typeof child === "object" && child.args[0] === "button");
  assert.equal(button, void 0);
});

test("go: keywords, a call and literals", () => {
  const tokens = highlight("func main() { var x = nil }", "go");
  const types = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(types.get("func"), "keyword");
  assert.equal(types.get("var"), "keyword");
  assert.equal(types.get("main"), "function");
  assert.equal(types.get("nil"), "constant");
});

test("rust: fn, let and None", () => {
  const types = new Map(highlight("fn main() { let x = None; }", "rust").map((t) => [t.text, t.type]));
  assert.equal(types.get("fn"), "keyword");
  assert.equal(types.get("let"), "keyword");
  assert.equal(types.get("None"), "constant");
});

test("java: modifiers, a class and null", () => {
  const types = new Map(highlight("public class A { private int x = 0; }", "java").map((t) => [t.text, t.type]));
  assert.equal(types.get("public"), "keyword");
  assert.equal(types.get("class"), "keyword");
  assert.equal(types.get("int"), "keyword");
  assert.equal(types.get("0"), "constant");
});

test("html: tags, attributes and values", () => {
  const tokens = highlight('<div class="a">текст</div>', "html");
  const byText = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(byText.get("div"), "keyword");
  assert.equal(byText.get("class"), "function");
  assert.equal(byText.get('"a"'), "string");
  assert.ok(tokens.some((token) => token.type === "plain" && token.text.includes("текст")));
});

test("html: a comment is parsed as a whole", () => {
  const tokens = highlight("<!-- скрыто -->", "html");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, "comment");
});

test("terminal transcripts and plain-text fences are not highlighted", () => {
  assert.equal(highlight("+ set -euo pipefail", "text"), null);
  assert.equal(highlight("какой-то вывод", "console"), null);
  assert.equal(highlight("лог", "log"), null);
  assert.equal(normalizeLang("console"), "");
});

test("python: comment, keyword, call, string and number are told apart", () => {
  const tokens = highlight("# c\ndef f(x):\n    return 'hi' + 42", "python");
  const types = new Map(tokens.map((token) => [token.text, token.type]));
  assert.equal(types.get("# c"), "comment");
  assert.equal(types.get("def"), "keyword");
  assert.equal(types.get("f"), "function");
  assert.equal(types.get("'hi'"), "string");
  assert.equal(types.get("return"), "keyword");
  assert.equal(types.get("42"), "constant");
});

test("a name followed by a bracket is a call, otherwise plain text", () => {
  assert.equal(highlight("len(x)", "python")[0].type, "function");
  const plain = highlight("total = 1", "python").find((token) => token.text === "total");
  assert.equal(plain.type, "plain");
});

test("language aliases are normalized to the canonical names", () => {
  assert.equal(normalizeLang("py"), "python");
  assert.equal(normalizeLang("TS"), "javascript");
  assert.equal(normalizeLang("sh"), "bash");
  assert.equal(normalizeLang(""), "");
});

test("python triple quotes produce a single string token", () => {
  const strings = highlight('x = """a\nb"""', "python").filter((token) => token.type === "string");
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, '"""a\nb"""');
});

test("json highlights string keys and literals", () => {
  const tokens = highlight('{"a": true}', "json");
  assert.ok(tokens.some((token) => token.type === "string" && token.text === '"a"'));
  assert.ok(tokens.some((token) => token.type === "constant" && token.text === "true"));
});

test("go: built-in types and constant names", () => {
  const types = new Map(highlight("var n int = 4\nconst MAX_SIZE = 10", "go").map((token) => [token.text, token.type]));
  assert.equal(types.get("int"), "type", "int is a predeclared type, not a keyword");
  assert.equal(types.get("MAX_SIZE"), "constant", "an all-caps name counts as a constant");
  assert.equal(types.get("n"), "plain");
});

test("python: types in annotations", () => {
  const types = new Map(highlight("def f(x: int) -> str:", "python").map((token) => [token.text, token.type]));
  assert.equal(types.get("int"), "type");
  assert.equal(types.get("str"), "type");
  assert.equal(types.get("f"), "function");
});

test("java: a wrapper class is a type, a primitive is a keyword", () => {
  const types = new Map(highlight("String name = null; int n = 0;", "java").map((token) => [token.text, token.type]));
  assert.equal(types.get("String"), "type");
  assert.equal(types.get("int"), "keyword");
});

test("css: the property name is colored, the value is not", () => {
  const types = new Map(highlight("color: red;", "css").map((token) => [token.text, token.type]));
  assert.equal(types.get("color"), "type");
  assert.equal(types.get("red"), "plain");
});

test("calling a built-in type stays a call, not a type", () => {
  assert.equal(highlight("int('5')", "python")[0].type, "function");
});

test("css: a hyphenated property is parsed as one piece", () => {
  const types = new Map(highlight("font-size: 14px;", "css").map((token) => [token.text, token.type]));
  assert.equal(types.get("font-size"), "type");
  assert.equal(types.get("14"), "constant");
});
