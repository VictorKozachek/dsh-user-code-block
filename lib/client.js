/**
 * Browser half of the `dsh-user-code-block` plugin.
 *
 * File format: a classic `window.__ModuleLoader__.load` script wrapper that the
 * DSH kernel materializes lazily (`factory(require)` → exports). React comes from
 * the shell's base module table, so no bundler and no JSX are required.
 *
 * Why the plugin exists. User messages are rendered by the `UserText` primitive,
 * which is plain text with preserved whitespace (`white-space: pre-wrap`), not
 * markdown. So ```` ```python ... ``` ```` stays literal text in your own
 * message, backticks included. The plugin introduces exactly one exception: it
 * recognizes a code fence and renders it like a block in an assistant reply —
 * language banner, monospaced `pre` and syntax highlighting. Everything else
 * stays plain text.
 *
 * Highlighting. The DSH theme publishes `--shiki-token-*` variables, and the
 * light and dark palettes switch by themselves through `body[data-ds-dark-theme]`.
 * Colors therefore reference those variables: the plugin never needs to know the
 * active theme. Tokens are classified by the small lexer below — it does not aim
 * for TextMate completeness, but it colors keywords, strings, comments, numbers
 * and function calls correctly.
 *
 * Extension points (see the `docs` of the ui-chat package, "Sent user text"):
 *   - `ctx.uiConversation.userText.register(rule)` — a synchronous
 *     `match(text, from)` matcher returning a candidate `{ id, start, end, data }`;
 *   - the `conversation.user.text.node` slot — a node renderer keyed by `id`.
 */
window.__ModuleLoader__.load({
  id: "dsh-user-code-block",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;

    /** Node key: also the rule `id` and the renderer registration `key`. */
    const KEY = "user-code";

    /** Order among candidates with the same start; never collides with the whitespace rules. */
    const ORDER = 20;

    /** Fence head: up to three spaces of indent, three or more backticks or tildes. */
    const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

    /** Token color — a theme variable reference, so the palettes switch by themselves. */
    const TOKEN_COLOR = {
      keyword: "var(--shiki-token-keyword, #d6336c)",
      string: "var(--shiki-token-string, #2f9e44)",
      comment: "var(--shiki-token-comment, #868e96)",
      constant: "var(--shiki-token-constant, #1c7ed6)",
      function: "var(--shiki-token-function, #6741d9)",
      type: "var(--shiki-token-parameter, #e8590c)",
      punctuation: "var(--shiki-token-punctuation, #495057)",
    };

    /** Number: integer, fractional, hexadecimal, with separators and an exponent. */
    const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/;

    /** Identifier; `$` appears in JS, the underscore everywhere. */
    const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*/;

    /** A CSS name may contain dashes (`font-size`, `-webkit-transform`), hence its own pattern. */
    const CSS_IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*/;

    /** Operators and punctuation share one color, like shiki. Quotes are excluded — the string branch owns them. */
    const PUNCT = /^[+\-*/%=<>!&|^~?:;,.()[\]{}]+/;

    /** Keywords and literals per language. */
    const PYTHON_KEYWORDS = [
      "False", "None", "True", "and", "as", "assert", "async", "await", "break", "case", "class",
      "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if",
      "import", "in", "is", "lambda", "match", "nonlocal", "not", "or", "pass", "raise", "return",
      "try", "while", "with", "yield",
    ];
    const PYTHON_LITERALS = ["True", "False", "None"];

    const JAVASCRIPT_KEYWORDS = [
      "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
      "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function",
      "get", "if", "import", "in", "instanceof", "let", "new", "of", "return", "set", "static",
      "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while", "with", "yield",
    ];
    const JAVASCRIPT_LITERALS = ["true", "false", "null", "undefined", "NaN", "Infinity"];

    const BASH_KEYWORDS = [
      "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "select",
      "then", "until", "while", "local", "export", "return", "readonly", "declare", "source",
    ];

    const SQL_KEYWORDS = [
      "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create",
      "table", "alter", "drop", "join", "left", "right", "inner", "outer", "on", "group", "by",
      "order", "having", "limit", "offset", "and", "or", "not", "null", "as", "distinct", "union",
      "case", "when", "then", "else", "end", "primary", "key", "foreign", "references", "index",
    ];

    const GO_KEYWORDS = [
      "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
      "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range",
      "return", "select", "struct", "switch", "type", "var",
    ];
    const GO_LITERALS = ["true", "false", "nil", "iota"];

    const RUST_KEYWORDS = [
      "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
      "extern", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut",
      "pub", "ref", "return", "self", "static", "struct", "super", "trait", "type", "unsafe",
      "use", "where", "while", "yield",
    ];
    const RUST_LITERALS = ["true", "false", "None", "Some", "Ok", "Err"];

    const JAVA_KEYWORDS = [
      "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char", "class", "const",
      "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float",
      "for", "goto", "if", "implements", "import", "instanceof", "int", "interface", "long",
      "native", "new", "package", "permits", "private", "protected", "public", "record", "return",
      "sealed", "short", "static", "strictfp", "super", "switch", "synchronized", "this", "throw",
      "throws", "transient", "try", "var", "void", "volatile", "while",
    ];
    const JAVA_LITERALS = ["true", "false", "null"];

    /**
     * Built-in types per language. In Go, Rust and Python they are not keywords but
     * predeclared names, so a code lexer would miss them — hence the explicit lists.
     * In Java the primitives are already keywords; only the wrapper classes live here.
     */
    const GO_TYPES = [
      "any", "bool", "byte", "comparable", "complex64", "complex128", "error", "float32",
      "float64", "int", "int8", "int16", "int32", "int64", "rune", "string", "uint", "uint8",
      "uint16", "uint32", "uint64", "uintptr",
    ];
    const RUST_TYPES = [
      "bool", "char", "f32", "f64", "i8", "i16", "i32", "i64", "i128", "isize", "str", "String",
      "u8", "u16", "u32", "u64", "u128", "usize", "Vec", "Option", "Result", "Box",
    ];
    const PYTHON_TYPES = [
      "bool", "bytearray", "bytes", "complex", "dict", "float", "frozenset", "int", "list",
      "memoryview", "object", "range", "set", "str", "tuple", "type",
    ];
    const JAVASCRIPT_TYPES = [
      "Array", "ArrayBuffer", "BigInt", "Boolean", "Date", "Error", "Map", "Number", "Object",
      "Promise", "RegExp", "Set", "String", "Symbol", "WeakMap", "WeakSet",
    ];
    const JAVA_TYPES = [
      "Boolean", "Byte", "Character", "Collection", "Double", "Float", "Integer", "List", "Long",
      "Map", "Object", "Optional", "Set", "Short", "Stream", "String",
    ];
    const SQL_TYPES = [
      "bigint", "bool", "boolean", "char", "date", "decimal", "double", "float", "int", "integer",
      "json", "jsonb", "numeric", "real", "serial", "smallint", "text", "time", "timestamp",
      "timestamptz", "uuid", "varchar",
    ];

    /** An all-caps name such as `MAX_SIZE` or `API_URL` is conventionally a constant. */
    const CONSTANT_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

    /** Lexer configuration by normalized language name; `markup` selects the separate tag parser. */
    const LANGS = {
      python: { keywords: PYTHON_KEYWORDS, literals: PYTHON_LITERALS, types: PYTHON_TYPES, line: "#", block: null, triple: true },
      javascript: { keywords: JAVASCRIPT_KEYWORDS, literals: JAVASCRIPT_LITERALS, types: JAVASCRIPT_TYPES, line: "//", block: "/*", triple: false },
      json: { keywords: [], literals: ["true", "false", "null"], line: null, block: null, triple: false },
      bash: { keywords: BASH_KEYWORDS, literals: [], line: "#", block: null, triple: false },
      sql: { keywords: SQL_KEYWORDS, literals: ["null"], types: SQL_TYPES, line: "--", block: "/*", triple: false, foldCase: true },
      css: { keywords: [], literals: [], line: null, block: "/*", triple: false, cssProperty: true },
      go: { keywords: GO_KEYWORDS, literals: GO_LITERALS, types: GO_TYPES, line: "//", block: "/*", triple: false },
      rust: { keywords: RUST_KEYWORDS, literals: RUST_LITERALS, types: RUST_TYPES, line: "//", block: "/*", triple: false },
      java: { keywords: JAVA_KEYWORDS, literals: JAVA_LITERALS, types: JAVA_TYPES, line: "//", block: "/*", triple: false },
      html: { markup: true },
    };

    /**
     * Languages that are deliberately not highlighted: terminal transcripts, logs
     * and output buffers. Code rules produce bogus colors there, so such fences are
     * rendered monochrome — still framed and still with a banner.
     */
    const PLAIN = new Set(["text", "txt", "plain", "output", "log", "logs", "console", "terminal", "diff", "patch", "markdown", "md"]);

    /** Language name synonyms from the fence info string; an empty string means "no highlighting". */
    const ALIASES = {
      py: "python",
      python3: "python",
      js: "javascript",
      jsx: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "javascript",
      tsx: "javascript",
      typescript: "javascript",
      node: "javascript",
      jsonc: "json",
      sh: "bash",
      shell: "bash",
      zsh: "bash",
      mysql: "sql",
      postgres: "sql",
      postgresql: "sql",
      sqlite: "sql",
      scss: "css",
      less: "css",
      golang: "go",
      rs: "rust",
      xml: "html",
      svg: "html",
      htm: "html",
    };

    /**
     * Normalize the language name from the fence.
     *
     * @param lang - info string after the fence.
     * @returns Lexer configuration key, or an empty string.
     */
    function normalizeLang(lang) {
      const raw = String(lang ?? "").trim().toLowerCase();
      if (raw === "" || PLAIN.has(raw)) return "";
      return ALIASES[raw] ?? raw;
    }

    /**
     * Build the closing-fence pattern for a specific opening fence.
     *
     * @param char - fence character (backtick or tilde).
     * @param length - opening fence length; the closing one is not shorter.
     * @returns Pattern for a line consisting entirely of the fence.
     */
    function closer(char, length) {
      return new RegExp(`^ {0,3}${char}{${length},}[ \\t]*$`);
    }

    /**
     * First position in the text that starts a line: `from` itself when it already
     * sits on a line boundary, otherwise the start of the next line.
     *
     * @param text - message text.
     * @param from - position the evaluator asks a candidate from.
     * @returns Nearest line start not earlier than `from`.
     */
    function lineStartAtOrAfter(text, from) {
      if (from <= 0) return 0;
      if (from >= text.length) return text.length;
      if (text[from - 1] === "\n") return from;
      const newline = text.indexOf("\n", from);
      return newline === -1 ? text.length : newline + 1;
    }

    /**
     * Language from the fence info string: the first word.
     *
     * @param info - everything after the opening fence.
     * @returns Language name or an empty string.
     */
    function fenceLanguage(info) {
      const trimmed = String(info ?? "").trim();
      if (trimmed === "") return "";
      return trimmed.split(/\s+/)[0];
    }

    /**
     * Find the nearest complete code block at or after `from`.
     *
     * An unclosed fence is not a block: the rest of the message must not turn into
     * code because of forgotten backticks — such a fence is skipped.
     *
     * @param text - user message text.
     * @param from - position to start searching from.
     * @returns Node candidate `{ id, start, end, data }` or `undefined`.
     */
    function findFence(text, from) {
      const source = String(text ?? "");
      let start = lineStartAtOrAfter(source, from);

      while (start <= source.length) {
        const newline = source.indexOf("\n", start);
        const lineEnd = newline === -1 ? source.length : newline;
        const opening = OPEN.exec(source.slice(start, lineEnd));

        if (opening !== null) {
          const marker = opening[2];
          const isCloser = closer(marker[0], marker.length);
          let scan = newline === -1 ? -1 : newline + 1;

          while (scan !== -1 && scan <= source.length) {
            const innerNewline = source.indexOf("\n", scan);
            const innerEnd = innerNewline === -1 ? source.length : innerNewline;

            if (isCloser.test(source.slice(scan, innerEnd))) {
              const body = source.slice(lineEnd + 1, scan);
              return {
                id: KEY,
                start,
                end: innerEnd,
                data: {
                  lang: fenceLanguage(opening[3]),
                  code: body.endsWith("\n") ? body.slice(0, -1) : body,
                },
              };
            }

            scan = innerNewline === -1 ? -1 : innerNewline + 1;
          }
        }

        if (newline === -1) break;
        start = newline + 1;
      }

      return void 0;
    }

    /**
     * Read a string literal from the opening quote to the closing one, honoring
     * escapes and forbidding newlines outside template quotes.
     *
     * @param code - whole block text.
     * @param at - index of the opening quote.
     * @param quote - quote character.
     * @returns Index right after the closing quote.
     */
    function skipString(code, at, quote) {
      let index = at + 1;
      while (index < code.length) {
        const char = code[index];
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char === quote) return index + 1;
        if (char === "\n" && quote !== "`") return index;
        index += 1;
      }
      return code.length;
    }

    /** A whole tag: a comment, or an opening/closing tag with its attributes. */
    const MARKUP = /<!--[\s\S]*?(?:-->|$)|<[!/]?[A-Za-z][\w:.-]*(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/g;

    /** An attribute inside a tag: name, optional `=` and optional value. */
    const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)(\s*=\s*)?("[^"]*"|'[^']*')?/g;

    /**
     * Tokenize HTML/XML: tags, attributes, values and comments.
     *
     * A separate parser is needed because the code lexer would read `<div` as
     * operators and `class="x"` as ordinary text.
     *
     * @param code - block body.
     * @returns Array of `{ text, type }`.
     */
    function highlightMarkup(code) {
      const tokens = [];
      const push = (text, type) => {
        if (text !== "") tokens.push({ text, type });
      };

      let cursor = 0;
      MARKUP.lastIndex = 0;
      let match = MARKUP.exec(code);

      while (match !== null) {
        if (match.index > cursor) push(code.slice(cursor, match.index), "plain");
        const chunk = match[0];

        if (chunk.startsWith("<!--")) {
          push(chunk, "comment");
        } else {
          const head = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(chunk);
          if (head === null) {
            push(chunk, "plain");
          } else {
            push("<", "punctuation");
            if (head[1] === "/") push("/", "punctuation");
            push(head[2], "keyword");

            const rest = chunk.slice(head[0].length);
            const closeAt = rest.lastIndexOf(">");
            const attributes = closeAt === -1 ? rest : rest.slice(0, closeAt);
            const tail = closeAt === -1 ? "" : rest.slice(closeAt);

            let local = 0;
            ATTRIBUTE.lastIndex = 0;
            let attribute = ATTRIBUTE.exec(attributes);
            while (attribute !== null) {
              if (attribute.index > local) push(attributes.slice(local, attribute.index), "punctuation");
              push(attribute[1], "function");
              if (attribute[2] !== void 0) push("=", "punctuation");
              if (attribute[3] !== void 0) push(attribute[3], "string");
              local = attribute.index + attribute[0].length;
              attribute = ATTRIBUTE.exec(attributes);
            }
            if (local < attributes.length) push(attributes.slice(local), "punctuation");
            if (tail !== "") push(tail, "punctuation");
          }
        }

        cursor = match.index + chunk.length;
        match = MARKUP.exec(code);
      }

      if (cursor < code.length) push(code.slice(cursor), "plain");
      return tokens;
    }

    /**
     * Tokenize code for highlighting.
     *
     * @param code - block body.
     * @param lang - language name from the fence.
     * @returns Array of `{ text, type }`, or `null` when the language is not highlighted.
     */
    function highlight(code, lang) {
      const config = LANGS[normalizeLang(lang)];
      if (config === void 0) return null;
      if (config.markup === true) return highlightMarkup(code);

      const keywords = new Set(config.keywords);
      const literals = new Set(config.literals);
      const types = new Set(config.types ?? []);
      const tokens = [];
      let index = 0;

      const push = (text, type) => {
        if (text !== "") tokens.push({ text, type });
      };

      while (index < code.length) {
        const rest = code.slice(index);

        if (config.block !== null && rest.startsWith(config.block)) {
          const end = code.indexOf("*/", index + config.block.length);
          const stop = end === -1 ? code.length : end + 2;
          push(code.slice(index, stop), "comment");
          index = stop;
          continue;
        }

        if (config.line !== null && rest.startsWith(config.line)) {
          const newline = code.indexOf("\n", index);
          const stop = newline === -1 ? code.length : newline;
          push(code.slice(index, stop), "comment");
          index = stop;
          continue;
        }

        // Python triple quotes open a multi-line string.
        if (config.triple && (rest.startsWith('"""') || rest.startsWith("'''"))) {
          const quote = rest.slice(0, 3);
          const end = code.indexOf(quote, index + 3);
          const stop = end === -1 ? code.length : end + 3;
          push(code.slice(index, stop), "string");
          index = stop;
          continue;
        }

        const char = code[index];

        if (char === '"' || char === "'" || char === "`") {
          const stop = skipString(code, index, char);
          push(code.slice(index, stop), "string");
          index = stop;
          continue;
        }

        const number = NUMBER.exec(rest);
        if (number !== null) {
          push(number[0], "constant");
          index += number[0].length;
          continue;
        }

        const ident = (config.cssProperty === true ? CSS_IDENT : IDENT).exec(rest);
        if (ident !== null) {
          const word = ident[0];
          const key = config.foldCase ? word.toLowerCase() : word;
          const next = code[index + word.length];
          const tail = code.slice(index + word.length);
          if (keywords.has(key)) push(word, "keyword");
          else if (literals.has(key)) push(word, "constant");
          else if (next === "(") push(word, "function");
          else if (types.has(key)) push(word, "type");
          else if (CONSTANT_NAME.test(word)) push(word, "constant");
          else if (config.cssProperty === true && /^\s*:/.test(tail)) push(word, "type");
          else push(word, "plain");
          index += word.length;
          continue;
        }

        const space = /^\s+/.exec(rest);
        if (space !== null) {
          push(space[0], "plain");
          index += space[0].length;
          continue;
        }

        const punct = PUNCT.exec(rest);
        if (punct !== null && punct[0] !== "") {
          push(punct[0], "punctuation");
          index += punct[0].length;
          continue;
        }

        push(char, "plain");
        index += 1;
      }

      return tokens;
    }

    /** Block frame: background and text also come from the theme. */
    const BOX_STYLE = {
      display: "block",
      margin: "8px 0",
      borderRadius: "var(--dsw-radius-lg, 12px)",
      overflow: "hidden",
      background: "var(--shiki-background, var(--dsw-alias-markdown-code-block, rgba(127, 127, 127, 0.12)))",
      border: "1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2))",
      textAlign: "left",
    };

    /** Block header: language on the left, copy on the right. */
    const HEADER_STYLE = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "4px 8px 4px 12px",
      background: "var(--dsw-alias-markdown-code-block-banner, rgba(127, 127, 127, 0.08))",
      borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))",
    };

    /** Language label. */
    const LANG_STYLE = {
      flex: "1 1 auto",
      minWidth: 0,
      color: "var(--dsw-alias-label-tertiary, #8a8a8a)",
      fontFamily: "var(--dsw-font-markdown-code-block-small-font-family, ui-monospace, monospace)",
      fontSize: "var(--dsw-font-markdown-code-block-small-font-size, 11px)",
      lineHeight: "1.6",
      letterSpacing: "0.02em",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    };

    /** Copy button: quiet, sits in the header next to the language. */
    const COPY_STYLE = {
      flex: "0 0 auto",
      border: "none",
      background: "transparent",
      color: "var(--dsw-alias-label-tertiary, #8a8a8a)",
      font: "inherit",
      fontSize: "11px",
      lineHeight: "1.6",
      padding: "2px 6px",
      borderRadius: "var(--dsw-radius-sm, 6px)",
      cursor: "pointer",
    };

    /** The code itself: whitespace is significant, horizontal scroll instead of wrapping. */
    const PRE_STYLE = {
      margin: 0,
      padding: "10px 12px",
      overflowX: "auto",
      whiteSpace: "pre",
      tabSize: 2,
      color: "var(--shiki-foreground, var(--dsw-alias-label-primary, inherit))",
      fontFamily: "var(--dsw-font-markdown-code-block-font-family, ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontSize: "var(--dsw-font-markdown-code-block-font-size, 12.5px)",
      lineHeight: "var(--dsw-font-markdown-code-block-line-height, 1.55)",
    };

    /**
     * Build the block body: highlighted tokens or the raw text.
     *
     * @param code - block body.
     * @param lang - language name from the fence.
     * @returns Array of React nodes for `pre > code`.
     */
    function renderCode(code, lang) {
      const tokens = highlight(code, lang);
      if (tokens === null) return [code];

      const nodes = [];
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.type === "plain") nodes.push(token.text);
        else nodes.push(h("span", { key: `${index}:${token.type}`, style: { color: TOKEN_COLOR[token.type] } }, token.text));
      }
      return nodes;
    }

    /**
     * Render the code-block node: a header (language and copy) plus the highlighted `pre`.
     *
     * @param props - `{ node }`; `node.data` carries `lang` and `code`.
     * @returns The block with a header and the code.
     */
    function UserCodeBlock({ node }) {
      const data = (node && node.data) || {};
      const lang = typeof data.lang === "string" ? data.lang : "";
      const code = typeof data.code === "string" ? data.code : "";

      const [copied, setCopied] = React.useState(false);

      // The "Copied" label lives briefly: the timer is cleared on unmount, otherwise
      // setState would land in an already removed node.
      React.useEffect(() => {
        if (!copied) return void 0;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
      }, [copied]);

      const clipboard = typeof navigator === "undefined" ? void 0 : navigator.clipboard;
      const canCopy = clipboard !== void 0 && clipboard !== null && typeof clipboard.writeText === "function";
      const onCopy = () => {
        if (!canCopy) return;
        clipboard.writeText(code).then(() => setCopied(true), () => void 0);
      };

      const header = [h("span", { key: "lang", style: LANG_STYLE }, lang)];
      if (canCopy) {
        header.push(
          h(
            "button",
            {
              key: "copy",
              type: "button",
              style: COPY_STYLE,
              title: copied ? "Copied" : "Copy",
              onClick: onCopy,
            },
            copied ? "Copied" : "Copy",
          ),
        );
      }

      return h(
        "span",
        { "data-dsh-user-code-block": "", style: BOX_STYLE },
        h("span", { key: "header", style: HEADER_STYLE }, ...header),
        h("pre", { key: "pre", style: PRE_STYLE }, h("code", null, renderCode(code, lang))),
      );
    }

    /**
     * Register the rule and its renderer.
     *
     * @param ctx - plugin client context.
     */
    function apply(ctx) {
      ctx.uiConversation.userText.register({
        id: KEY,
        order: ORDER,
        match(text, from) {
          return findFence(text, from);
        },
      });

      ctx.slots.inject("conversation.user.text.node", () =>
        ctx.slots.register({ name: "conversation.user.text.node", key: KEY, priority: 100 }, UserCodeBlock),
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "uiConversation"];
    // Test internals: the DSH runtime never reads them.
    exports.__internals = {
      findFence,
      highlight,
      renderCode,
      normalizeLang,
      UserCodeBlock,
      KEY,
      closer,
      lineStartAtOrAfter,
      fenceLanguage,
    };
    return module.exports;
  },
});
