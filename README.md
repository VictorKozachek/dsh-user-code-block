# dsh-user-code-block

![tests](https://github.com/VictorKozachek/dsh-user-code-block/actions/workflows/tests.yml/badge.svg)
![npm](https://img.shields.io/npm/v/dsh-user-code-block)

A plugin for **DeepSeek Harness Desktop** (DSH) that renders fenced code blocks
in **user messages**: frame, language banner, syntax highlighting and a copy
button. The rest of the message stays plain text.

English | [Русский](README.ru.md)

## Compatibility

- **DeepSeek Harness Desktop** 0.2.1-rc.3 — verified; the 0.1.x builds expose the
  same extension points
- any DSH profile (`desktop` or `web`) that mounts the `ui-chat` client package
- Node.js 20+ for development and the test suite
- no runtime dependencies, no build step

## Why

Assistant messages are rendered as markdown (`AssistantMarkdown`), while user
messages go through the `UserText` primitive: plain text with
`white-space: pre-wrap`. So a fenced block

    ```python
    print("hi")
    ```

shows up in your own message with the backticks visible — no highlighting, no
frame. The plugin adds exactly one exception: it recognizes the fence and renders
it the same way as a block in an assistant reply. Links, `@`-mentions and the
other built-in `UserText` nodes keep working as before.

## What is recognized

- a fence of three or more backticks or tildes;
- up to three spaces of indentation (four spaces is no longer a fence);
- the language is the first word of the info string: ```` ```python title=x ```` → `python`;
- a four-backtick fence correctly contains triple backticks inside;
- an **unclosed** fence is not treated as a block: leftover text never turns
  into code because of forgotten backticks.

Single backticks (`inline code`) are left alone — that is not a block.

## Highlighting

Colors come from the `--shiki-token-*` variables DSH already publishes
(`shiki.css` in `@deepseek-ai/dsh-client-ui-theme`). Light and dark palettes
switch by themselves through `body[data-ds-dark-theme]`, so the plugin never
needs to detect the active theme.

Tokens are classified by a small built-in lexer — no shiki, no client primitives
(DSH documentation forbids plugins to import them as modules). Supported:

| Fence language | What gets colored |
|---|---|
| `python`, `py` | keywords, `True`/`False`/`None`, strings (including triple-quoted), `#` comments, numbers |
| `js`, `ts`, `jsx`, `tsx`, `javascript`, `typescript` | keywords, `true`/`false`/`null`, strings, `//` and `/* */`, numbers |
| `json`, `jsonc` | string keys, `true`/`false`/`null`, numbers |
| `bash`, `sh`, `shell`, `zsh` | keywords, strings, `#` comments, numbers |
| `go`, `golang` | keywords, `true`/`false`/`nil`/`iota`, strings, `//` and `/* */` |
| `rust`, `rs` | keywords, `None`/`Some`/`Ok`/`Err`, strings, comments |
| `java` | modifiers and types, `true`/`false`/`null`, strings, comments |
| `html`, `xml`, `svg`, `htm` | tags, attributes, string values, `<!-- -->` |
| `sql` (and dialects), `css`, `scss` | keywords/strings/comments as far as the language allows |

**Monochrome mode.** The fences ` ```text `, ` ```txt `, ` ```plain `,
` ```output `, ` ```log `, ` ```console `, ` ```terminal `, ` ```diff `, ` ```md `
are not highlighted: the frame and the banner stay, color is not applied. This is
for terminal transcripts and logs, where code rules produce bogus colors (green
"strings" out of `grep` output, trace plus signs as punctuation, and so on).

Other languages also render without highlighting — honest monospaced text beats
wrong colors.

### Palette

Each token type takes its color from a theme variable, so light and dark palettes
switch by themselves:

| Token type | Theme variable | What lands there |
|---|---|---|
| `keyword` | `--shiki-token-keyword` | `def`, `func`, `fn`, `public`, `if`, `return` |
| `string` | `--shiki-token-string` | strings in every supported language |
| `comment` | `--shiki-token-comment` | `#`, `//`, `/* */`, `<!-- -->` |
| `constant` | `--shiki-token-constant` | numbers, `true`/`null`/`nil`/`None`, SCREAMING_CASE names (`MAX_SIZE`) |
| `function` | `--shiki-token-function` | calls (`print`, `Println`, `main`), HTML attributes |
| `type` | `--shiki-token-parameter` | built-in types (`int`, `String`, `Vec`), CSS properties |
| `punctuation` | `--shiki-token-punctuation` | brackets, operators, commas |

Built-in types and CSS properties get their own token type: in Go, Rust, Python
and JavaScript they are not keywords but predeclared names, so a code lexer would
miss them. The lists live in `GO_TYPES`, `RUST_TYPES`, `PYTHON_TYPES`,
`JAVASCRIPT_TYPES`, `JAVA_TYPES`, `SQL_TYPES`.

## Copy button

The block header carries `Copy` on the right: the clipboard receives the original
code, without markup or highlighting. The label reverts after 1.5 seconds. When
the browser does not grant `navigator.clipboard`, the button is not rendered at
all — better nothing than a broken button.

## DSH extension points

The plugin rides the documented mechanisms (see the `docs` of the `ui-chat`
package, section "Sent user text"):

- `ctx.uiConversation.userText.register({ id, order, match(text, from) })` —
  a synchronous matcher returning a candidate `{ id, start, end, data }`;
- the `conversation.user.text.node` slot — the node renderer whose `key` matches
  the `id`.

The host half is empty: `lib/index.js` exports `apply() {}`. It exists only so
the row appears in the profile's cordis tree.

## Installation

The plugin installs into a DSH profile (`desktop` or `web`). Tested on
DSH Desktop 0.2.1-rc.3.

### From npm

```bash
dsh plugin --profile desktop add dsh-user-code-block
```

This is the recommended path: the plugin manager installs the package, records it
in the profile's `package.json` and `dsh.profile.bundles`, and the plugin loads on
the next DSH start.

### From source

```bash
git clone https://github.com/VictorKozachek/dsh-user-code-block.git
cd dsh-user-code-block
./install.sh          # default profile: ~/.dsh/profiles/desktop
```

The script backs up the profile manifest, adds the package to `dependencies`
(`link:`) and to `dsh.profile.bundles`, and creates the `node_modules` symlink.
Another profile is selected with a variable:

```bash
DSH_PROFILE_DIR="$HOME/.dsh/profiles/web" ./install.sh
```

### Manually

1. Add the package to `~/.dsh/profiles/desktop/package.json`:

   ```json
   {
     "dependencies": {
       "dsh-user-code-block": "link:/path/to/dsh-user-code-block"
     },
     "dsh": {
       "profile": {
         "bundles": [
           "@deepseek-ai/dsh-base",
           "@deepseek-ai/dsh-web-app",
           "dsh-user-code-block"
         ]
       }
     }
   }
   ```

2. Create the symlink in the profile's `node_modules`:

   ```bash
   ln -s /path/to/dsh-user-code-block \
         ~/.dsh/profiles/desktop/node_modules/dsh-user-code-block
   ```

3. Restart the application: the client module graph is built when the host
   starts, a page reload does not re-read it.

### With the CLI from a local path

The plugin manager can also install a local checkout instead of the npm package:

```bash
dsh plugin --profile desktop add /path/to/dsh-user-code-block
```

## Verification

Send a message with a fenced code block — the block should render with a frame
and a language banner, and the rest of the message should stay plain.

## Development

No dependencies, no build step: edit `lib/client.js` and run the tests.

```bash
node --test test/*.test.mjs
```

- `test/matcher.test.mjs` — fence parsing and the lexer: it installs a fake
  `window.__ModuleLoader__`, captures the browser factory and calls it with a
  React stub, so the tests run in Node without a browser.
- `test/plugin.test.mjs` — package wiring: the manifest, the patch layer, and the
  browser module id matching the package name.

CI runs on GitHub Actions, Node 20/22/24 on Ubuntu and macOS
(`.github/workflows/tests.yml`).

## Uninstall

```bash
./uninstall.sh
```

Or manually: drop `dsh-user-code-block` from `dsh.profile.bundles`, remove the
symlink from the profile's `node_modules`, and restart the application.

## License

MIT — see [LICENSE](LICENSE).
