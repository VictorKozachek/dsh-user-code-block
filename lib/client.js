/**
 * Браузерная половина плагина `dsh-user-code-block`.
 *
 * Формат файла: классический скрипт-обёртка `window.__ModuleLoader__.load`,
 * который ядро DSH материализует лениво (`factory(require)` → exports). React
 * берётся из базовой таблицы модулей оболочки, поэтому сборщик и JSX не нужны.
 *
 * Зачем плагин. Сообщения пользователя рендерит примитив `UserText`, а это
 * обычный текст с сохранением пробелов (`white-space: pre-wrap`), не Markdown.
 * Поэтому ```` ```python ... ``` ```` в своём сообщении остаётся текстом вместе
 * с кавычками. Плагин вносит ровно одно исключение: распознаёт забор кода и
 * рисует его как блок в ответе ассистента — плашка языка, моноширинный `pre`
 * и подсветка синтаксиса. Всё остальное остаётся текстом.
 *
 * Подсветка. Тема DSH публикует переменные `--shiki-token-*`, а светлая и
 * тёмная палитры переключаются сами через `body[data-ds-dark-theme]`. Поэтому
 * цвета берутся ссылками на переменные: плагину не нужно знать активную тему.
 * Токены размечает маленький лексер ниже — он не претендует на полноту TextMate,
 * но верно красит ключевые слова, строки, комментарии, числа и вызовы функций.
 *
 * Точки расширения (`docs` пакета ui-chat, раздел «Sent user text»):
 *   - `ctx.uiConversation.userText.register(rule)` — синхронный матчер
 *     `match(text, from)`, возвращающий кандидата `{ id, start, end, data }`;
 *   - слот `conversation.user.text.node` — рендерер узла по `key === id`.
 */
window.__ModuleLoader__.load({
  id: "dsh-user-code-block",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require("react");
    const h = React.createElement;

    /** Ключ узла: он же `id` правила и `key` регистрации рендерера. */
    const KEY = "user-code";

    /** Порядок среди кандидатов с тем же началом; с правилами пробелов не пересекается. */
    const ORDER = 20;

    /** Шапка забора: до трёх пробелов отступа, три и более обратных кавычек или тильд. */
    const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

    /** Цвет токена — ссылка на переменную темы, поэтому палитры переключаются сами. */
    const TOKEN_COLOR = {
      keyword: "var(--shiki-token-keyword, #d6336c)",
      string: "var(--shiki-token-string, #2f9e44)",
      comment: "var(--shiki-token-comment, #868e96)",
      constant: "var(--shiki-token-constant, #1c7ed6)",
      function: "var(--shiki-token-function, #6741d9)",
      type: "var(--shiki-token-parameter, #e8590c)",
      punctuation: "var(--shiki-token-punctuation, #495057)",
    };

    /** Число: целое, дробное, шестнадцатеричное, с разделителями и экспонентой. */
    const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJ]?)/;

    /** Идентификатор; `$` встречается в JS, подчёркивание — везде. */
    const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*/;

    /** Имя в CSS может содержать дефисы (`font-size`, `-webkit-transform`), поэтому шаблон свой. */
    const CSS_IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*/;

    /** Операторы и пунктуация: общий цвет, как у shiki. Кавычки сюда не входят — их разбирает ветка строк. */
    const PUNCT = /^[+\-*/%=<>!&|^~?:;,.()[\]{}]+/;

    /** Ключевые слова и литералы по языкам. */
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
     * Встроенные типы по языкам. В Go, Rust и Python это не ключевые слова, а
     * предобъявленные имена, поэтому лексер кода их не видит — держим списками.
     * В Java примитивы уже входят в ключевые слова, здесь только классы-обёртки.
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

    /** Имя, набранное капсом: `MAX_SIZE`, `API_URL` — так принято называть константы. */
    const CONSTANT_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

    /** Конфигурация лексера по нормализованному имени языка; `markup` — отдельный разбор тегов. */
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
     * Языки, которые осознанно не подсвечиваются: это транскрипты терминала,
     * логи и буферы вывода. Раскраска по правилам кода там врёт, поэтому такие
     * заборы рисуются монохромно, но в рамке и с плашкой.
     */
    const PLAIN = new Set(["text", "txt", "plain", "output", "log", "logs", "console", "terminal", "diff", "patch", "markdown", "md"]);

    /** Синонимы имён языков из информационной строки забора; пустая строка — без подсветки. */
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
     * Нормализовать имя языка из забора.
     *
     * @param lang - информационная строка после забора.
     * @returns Ключ конфигурации лексера либо пустая строка.
     */
    function normalizeLang(lang) {
      const raw = String(lang ?? "").trim().toLowerCase();
      if (raw === "" || PLAIN.has(raw)) return "";
      return ALIASES[raw] ?? raw;
    }

    /**
     * Регулярка закрывающего забора для конкретного открывающего.
     *
     * @param char - символ забора (обратная кавычка или тильда).
     * @param length - длина открывающего забора; закрывающий не короче.
     * @returns Регулярка строки, целиком состоящей из забора.
     */
    function closer(char, length) {
      return new RegExp(`^ {0,3}${char}{${length},}[ \\t]*$`);
    }

    /**
     * Первая позиция в тексте, с которой начинается строка: `from`, если он уже
     * стоит на границе строки, иначе начало следующей.
     *
     * @param text - текст сообщения.
     * @param from - позиция, с которой оценщик просит кандидата.
     * @returns Ближайшее начало строки не раньше `from`.
     */
    function lineStartAtOrAfter(text, from) {
      if (from <= 0) return 0;
      if (from >= text.length) return text.length;
      if (text[from - 1] === "\n") return from;
      const newline = text.indexOf("\n", from);
      return newline === -1 ? text.length : newline + 1;
    }

    /**
     * Язык из информационной строки забора: первое слово.
     *
     * @param info - всё, что стоит после открывающего забора.
     * @returns Имя языка либо пустая строка.
     */
    function fenceLanguage(info) {
      const trimmed = String(info ?? "").trim();
      if (trimmed === "") return "";
      return trimmed.split(/\s+/)[0];
    }

    /**
     * Найти ближайший завершённый блок кода не раньше `from`.
     *
     * Незакрытый забор блоком не считается: остаток сообщения не должен
     * превращаться в код из-за забытых кавычек — такой забор пропускается.
     *
     * @param text - текст сообщения пользователя.
     * @param from - позиция, с которой начинается поиск.
     * @returns Кандидат узла `{ id, start, end, data }` либо `undefined`.
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
     * Дочитать строковый литерал от кавычки до закрывающей, учитывая
     * экранирование и запрет перевода строки вне шаблонных кавычек.
     *
     * @param code - весь текст блока.
     * @param at - индекс открывающей кавычки.
     * @param quote - символ кавычки.
     * @returns Индекс сразу после закрывающей кавычки.
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

    /** Тег целиком: комментарий, открывающий или закрывающий тег с атрибутами. */
    const MARKUP = /<!--[\s\S]*?(?:-->|$)|<[!/]?[A-Za-z][\w:.-]*(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/g;

    /** Атрибут внутри тега: имя, необязательные `=` и значение. */
    const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)(\s*=\s*)?("[^"]*"|'[^']*')?/g;

    /**
     * Разметить HTML/XML на токены: теги, атрибуты, значения и комментарии.
     *
     * Отдельный разбор нужен потому, что лексер кода принял бы `<div` за
     * операторы, а `class="x"` — за обычный текст.
     *
     * @param code - тело блока.
     * @returns Массив `{ text, type }`.
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
     * Разметить код на токены для подсветки.
     *
     * @param code - тело блока.
     * @param lang - имя языка из забора.
     * @returns Массив `{ text, type }` либо `null`, если язык не подсвечиваем.
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

        // Тройные кавычки Python — многострочная строка.
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

    /** Рамка блока: фон и текст — тоже из темы. */
    const BOX_STYLE = {
      display: "block",
      margin: "8px 0",
      borderRadius: "var(--dsw-radius-lg, 12px)",
      overflow: "hidden",
      background: "var(--shiki-background, var(--dsw-alias-markdown-code-block, rgba(127, 127, 127, 0.12)))",
      border: "1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.2))",
      textAlign: "left",
    };

    /** Шапка блока: язык слева, копирование справа. */
    const HEADER_STYLE = {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "4px 8px 4px 12px",
      background: "var(--dsw-alias-markdown-code-block-banner, rgba(127, 127, 127, 0.08))",
      borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.16))",
    };

    /** Плашка языка. */
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

    /** Кнопка копирования: тихая, появляется в шапке рядом с языком. */
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

    /** Сам код: пробелы значимы, горизонтальная прокрутка вместо переноса. */
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
     * Собрать тело блока: подсвеченные токены либо исходный текст.
     *
     * @param code - тело блока.
     * @param lang - имя языка из забора.
     * @returns Массив React-узлов для `pre > code`.
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
     * Рендер узла блока кода: шапка (язык и копирование) плюс подсвеченный `pre`.
     *
     * @param props - `{ node }`; `node.data` несёт `lang` и `code`.
     * @returns Блок с шапкой и кодом.
     */
    function UserCodeBlock({ node }) {
      const data = (node && node.data) || {};
      const lang = typeof data.lang === "string" ? data.lang : "";
      const code = typeof data.code === "string" ? data.code : "";

      const [copied, setCopied] = React.useState(false);

      // Подпись «Copied» живёт недолго: таймер снимается при размонтировании,
      // иначе setState прилетел бы в уже убранный узел.
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
     * Зарегистрировать правило и его рендерер.
     *
     * @param ctx - клиентский контекст плагина.
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
    // Внутренности для тестов: рантайм DSH их не использует.
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
