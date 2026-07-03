# UserScript Compiler

Turn one `.user.js` file into everything you need to ship it:

- a clean **userscript** artifact for Tampermonkey, Violentmonkey, Greasemonkey, or Safari userscript apps
- store-ready **browser-extension** packages for Chrome, Firefox, and Safari (MV3), each with a working popup and a GM-compatibility runtime
- a **standalone** web harness for quick baseline testing
- one consolidated `review/submission-guide.md` with permission justifications and store-review notes

Nothing about your script is minified or rewritten. The compiler reads your metadata block, derives the right manifest and permissions, and wraps your code in a GM shim so `GM_*` / `GM.*` calls keep working inside an extension.

## Quickstart (copy-paste)

```bash
git clone https://github.com/HRussellZFAC023/UserScript-Compiler
cd UserScript-Compiler
npm ci

# Compile any .user.js into ./compiled-userscript (chrome + firefox + safari)
npm run compile -- ./path/to/script.user.js
```

That writes a full project under `compiled-userscript/`. Then:

```bash
# Sanity-check the generated project
node ./compiled-userscript/tools/verify.mjs
```

Load `compiled-userscript/packages/extension/chrome` as an unpacked extension in
Chrome (chrome://extensions → Developer mode → Load unpacked) and click the
toolbar icon to see the generated popup.

Prefer a UI? `npm run dev` opens a web app that does the same thing in the browser.

## CLI

```bash
npm run compile -- <script.user.js> [options]
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | `compiled-userscript` | Output directory |
| `--target <list>` | `chrome,firefox,safari` | Comma-separated: `chrome`, `firefox`, `safari` |
| `--runtime <mode>` | `content-script` | `content-script`, `user-scripts`, or `auto` |
| `--newtab` | off | Add a generated placeholder new-tab page |
| `--newtab-dir <dir>` | – | Package a built new-tab app (must contain `index.html`) |
| `--firefox-id <id>` | derived | Firefox add-on id for `browser_specific_settings` |
| `--config <file>` | auto | JSON config (see below) |
| `--zip-only` | off | Only write the project ZIP + release artifacts |
| `--no-context-menus` | off | Do not map `GM_registerMenuCommand` to native menus |
| `-h`, `--help` | | Full help with examples |
| `-v`, `--version` | | Print the compiler version |

Run `npm run compile -- --help` for worked examples. Exit codes: `0` success,
`1` usage/input error, `2` compile or package-validation errors (so CI fails loudly).

### Runtime modes

- **`content-script`** (default) — packages your script as a static content
  script. No `userScripts` permission, smoothest store review. Use this unless
  you specifically need page-world execution.
- **`user-scripts`** — uses the native Chrome/Firefox `userScripts` API. Higher
  review friction; Mozilla limits it to script-manager extensions.
- **`auto`** — picks `user-scripts` only when your script needs the page world
  (`@grant unsafeWindow`, `// @inject-into page`, `@unwrap`, or a `@sandbox`).

## Configuration and popup branding

Every popup string and asset is generic by default and fully configurable per
project — no editing generated files. Create a `userscript-compiler.config.json`
next to your script (auto-detected) or pass `--config path.json`:

```json
{
  "out": "./dist",
  "targets": ["chrome", "firefox"],
  "runtime": "content-script",
  "newtabDir": "./dist/newtab",
  "firefoxId": "my-tool@example.com",
  "metadata": {
    "name": "My Tool",
    "homepage": "https://example.com"
  },
  "branding": {
    "tagline": "One-line subtitle under the popup title",
    "homepageLabel": "Docs",
    "settingsEvent": "my-tool-open-settings",
    "settingsLabel": "Open settings",
    "iconPath": "newtab/icons/icon-128.png",
    "pages": [
      { "path": "newtab/index.html", "label": "Dashboard" }
    ]
  }
}
```

All fields are optional. CLI flags override config values.

| Key | Effect |
| --- | --- |
| `out`, `targets`, `runtime`, `newtabDir`, `newtab`, `firefoxId`, `contextMenus` | Defaults for the matching CLI options |
| `metadata` | Overrides parsed `@name`, `@description`, `@homepage`, etc. |
| `branding.tagline` | Popup subtitle (defaults to your `@description`, hidden if empty) |
| `branding.pages` | Buttons that open packaged extension pages `[{ path, label }]` |
| `branding.homepageLabel` | Label for the homepage button (default `Homepage`) |
| `branding.settingsEvent` | If set, adds a button that dispatches this `CustomEvent` (name only) into the active tab so your content script can open its own in-page UI. Use a string for an exact event name, or `true` to auto-derive `<script>-open-settings` |
| `branding.settingsLabel` | Label for the settings button (default `Open settings`) |
| `branding.iconPath` | Popup icon path inside the package (auto-detected from packaged icons otherwise) |

The **settings event** is opt-in and off by default. When set, the popup calls
`chrome.scripting.executeScript` to fire `window.dispatchEvent(new CustomEvent(name))`
in the page; your script listens for that same name to open its settings.

## GM API compatibility

Your script runs against a bundled shim that forwards to the extension
background where needed. Supported APIs (both `GM_*` and `GM.*` forms):

| API | Supported | Notes |
| --- | --- | --- |
| `GM_getValue` / `GM.getValue` | ✅ | Async on first read, then synchronous from cache¹ |
| `GM_setValue` / `GM.setValue` | ✅ | Async persist; local cache updates immediately |
| `GM_deleteValue`, `GM_listValues` | ✅ | Backed by `chrome.storage.local` |
| `GM_addValueChangeListener` / remove | ✅ | Fires on same-tab and cross-tab changes |
| `GM_xmlhttpRequest` / `GM.xmlHttpRequest` | ✅ | Runs in the background (real cross-origin); text/json/blob/arraybuffer, timeout, abort |
| `GM_download` | ✅ | Uses the `downloads` API |
| `GM_openInTab` | ✅ | Opens a tab via the `tabs` API |
| `GM_notification` | ✅ | Uses the `notifications` API |
| `GM_setClipboard` | ✅ | Uses the async Clipboard API (needs a user gesture) |
| `GM_registerMenuCommand` / unregister | ✅ | Mapped to native context menus **and** listed in the popup |
| `GM_addStyle`, `GM_addElement` | ✅ | DOM helpers, run in-page |
| `GM_getResourceText`, `GM_getResourceURL` | ✅ | Resolved from `@resource` URLs (fetched on demand) |
| `GM_info` / `GM.info` | ✅ | Reports `scriptHandler: "UserScript Compiler"` |
| `unsafeWindow` | ⚠️ | Aliased to `window`; true page-world access needs `--runtime user-scripts`/`auto` |
| `@require` | ⚠️ | **Not bundled** — store policy wants third-party code packaged, not fetched at runtime. Inline it before compiling. |

¹ In an extension content script, saved values are hydrated asynchronously.
`GM_getValue` returns a Promise until hydration finishes, then the cached value
synchronously — the same pattern userscript managers use. Prefer `await`.

Permissions are derived from the `@grant`s you actually use, so the manifest asks
for only what your script needs.

## Generated project layout

```text
packages/
  userscript/script.user.js      # your script, unchanged
  extension/chrome|firefox|safari # unpacked extensions (manifest at root)
  standalone/                     # local test harness
release/
  chrome/*.zip                    # store upload (manifest at archive root)
  firefox/*.xpi
  safari/*-safari-web-extension/  # source folder for Apple's packager
review/submission-guide.md        # permission justifications + store notes
audit/                            # machine-readable audit + validation JSON
tools/verify.mjs                  # required-file + manifest sanity checks
```

The `*-extension-project.zip` at the root is a source/audit bundle. For store
uploads, use the target-specific files under `release/`.

## Greasy Fork readability

Greasy Fork rejects minified or packed scripts. The compiler copies your
userscript verbatim, so build it with JS/CSS minification **disabled** before
compiling. If the source body looks minified, the compiler emits a
`greasyfork.source-readability` warning and the generated userscript README
explains the fix.

## Programmatic API

The same core powers the CLI and web app. Import it directly:

```js
import { compileUserscriptProject, analyzeUserscript } from './src/utils/converter.js';

const analysis = analyzeUserscript(scriptText, { targets: ['chrome'] });
const result = await compileUserscriptProject(scriptText, {
  targets: ['chrome', 'firefox'],
  runtime: 'content-script',
  branding: { tagline: 'My popup subtitle' },
  outputType: 'uint8array', // 'nodebuffer' | 'uint8array' | 'blob'
});
// result.files, result.zip, result.releaseArtifacts, result.diagnostics,
// result.packageValidation
```

## Review guidance sources

- Chrome privacy fields / permission justifications: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Chrome `userScripts`: https://developer.chrome.com/docs/extensions/reference/api/userScripts
- Mozilla add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Mozilla source submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Safari Web Extensions: https://developer.apple.com/documentation/SafariServices/safari-web-extensions

## Example: a real large userscript

The compiler is used in production to package [Yomu](https://github.com/HRussellZFAC023)
(a large reader userscript with a packaged new-tab app). To reproduce that build,
build the app first, then point the compiler at its bundle and new-tab directory:

```bash
npm run compile -- ../yomu-reader/dist/yomu.user.js \
  --out ./compiled-yomu \
  --target chrome,firefox,safari \
  --newtab-dir ../yomu-reader/dist/newtab \
  --config ../yomu-reader/userscript-compiler.config.json
node ./compiled-yomu/tools/verify.mjs
```

Any userscript works the same way — the Yomu specifics live entirely in that
project's config file, not in the compiler.
