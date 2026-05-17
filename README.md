# UserScript Compiler 2.0

Compile one `.user.js` file into three reviewable packages:

- a userscript artifact for Tampermonkey, Violentmonkey, Greasemonkey, or Safari userscript apps
- browser-extension packages for Chrome, Firefox, and Safari
- a standalone web harness for baseline testing

The compiler also generates `review/` templates for Chrome Web Store, Mozilla Add-ons, Safari/App Store review notes, Firefox for Android notes, and troubleshooting.
When run through the CLI it also writes store-ready release artifacts separately from the project/audit bundle.

## Why 2.0 Exists

The original compiler always used the native `userScripts` API. That is high-friction for review and installation:

- Chrome requires the `userScripts` permission plus a browser toggle.
- Mozilla policy allows the `userScripts` API only for user-script managers.
- Safari does not have the same cross-browser `userScripts` API path.

2.0 defaults to static content-script packaging and only uses native `userScripts` mode when you explicitly choose it.

## Web App

```bash
npm ci
npm run dev
```

Build the GitHub Pages site:

```bash
npm run build
```

Run the local checks:

```bash
npm run check
```

## CLI

```bash
npm run compile -- path/to/script.user.js --out ./compiled-script
```

Useful options:

```bash
npm run compile -- ./dist/yomu.user.js \
  --out ./compiled-yomu \
  --target chrome,firefox,safari \
  --runtime content-script \
  --newtab-dir ./dist/newtab
```

Runtime modes:

- `content-script`: default, avoids the native `userScripts` permission.
- `user-scripts`: advanced mode using Chrome/Firefox `userScripts`.
- `auto`: compiler chooses per target.

Use `--newtab` for a generated placeholder new-tab page, or `--newtab-dir ./dist/newtab` to package a real built new-tab app such as Yomu's.

## Generated Project Layout

```text
packages/
  userscript/script.user.js
  extension/chrome/
  extension/firefox/
  extension/safari/
  standalone/
review/
audit/
release/
  chrome/*.zip
  firefox/*.xpi
  safari/*-safari-web-extension/
tools/verify.mjs
```

Load `packages/extension/chrome` unpacked in Chrome, `packages/extension/firefox` in Firefox, and package `packages/extension/safari` through Apple's Safari Web Extension tooling.

The `*-extension-project.zip` file is a source/audit bundle. Store uploads should use the target-specific files under `release/`, where Chrome and Firefox archives have `manifest.json` at the archive root and Safari output is a WebExtension source folder for Apple's packager.

Run `npm run verify` from the generated output directory to check required files, package validation errors, and release artifact presence.

## Greasy Fork Readability

The userscript package is copied exactly from your input file. The compiler does not minify, obfuscate, or rewrite it. Greasy Fork rejects posted scripts that are minified or packed, so build your `.user.js` with JavaScript and CSS minification disabled before compiling or publishing. If the source body looks minified, the compiler emits a `greasyfork.source-readability` warning and the generated userscript README explains what to fix.

## Review Guidance Sources

- Chrome privacy fields and permission justifications: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Chrome `userScripts`: https://developer.chrome.com/docs/extensions/reference/api/userScripts
- Chrome single-purpose FAQ: https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
- Mozilla Add-on Policies: https://extensionworkshop.com/documentation/publish/add-on-policies/
- Mozilla source submission: https://extensionworkshop.com/documentation/publish/source-code-submission/
- Safari Web Extensions: https://developer.apple.com/documentation/SafariServices/safari-web-extensions
- Safari permissions: https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions

## Yomu Example

Build Yomu first, then compile it:

```bash
cd ../yomu-reader
npm ci
npm run build
npm run verify

cd ../UserScript-Compiler
npm ci
npm run compile -- ../yomu-reader/dist/yomu.user.js --out ./compiled-yomu --target chrome,firefox,safari --runtime content-script --newtab-dir ../yomu-reader/dist/newtab
node ./compiled-yomu/tools/verify.mjs
```

Use the generated `review/` files as the starting point for Chrome, Mozilla, and Safari submissions. Read them before pasting: they are generated from metadata and should stay truthful to the final package.
