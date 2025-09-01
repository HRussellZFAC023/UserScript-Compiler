# Userscript Converter

A web app that converts Tampermonkey/Greasemonkey userscripts into cross‑browser Manifest V3 extensions. The generated ZIP can be loaded in Chrome or Firefox and uses the native [userScripts API](https://developer.chrome.com/docs/extensions/reference/api/userScripts) to inject the userscript.

## Features

- Registers scripts with `chrome.userScripts.register` in a sandboxed world.
- Generates a `manifest.json` with host permissions, `optional_permissions: ['userScripts']`, and a `minimum_chrome_version` of 120.
- Provides a Greasemonkey API polyfill (`GM_*` functions, `unsafeWindow`, etc.) via `userscript_api.js`.
- Supports dynamic code execution by configuring the user‑script world with a relaxed CSP (`script-src 'self' 'unsafe-eval'`).
- Exposes the latest JSON response on `window.z` and includes a helper to safely evaluate dynamic element expressions.
- Includes both `background.service_worker` and `background.scripts` entries for Chrome and Firefox compatibility.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

The built files are output to `dist/`.

## Deployment

Pushes to `main` trigger the GitHub Actions workflow in `.github/workflows/deploy.yml` which builds and publishes the site to GitHub Pages.

[![Deploy to GitHub Pages](https://github.com/HRussellZFAC023/UserScript-Compiler/actions/workflows/deploy.yml/badge.svg)](https://github.com/HRussellZFAC023/UserScript-Compiler/actions/workflows/deploy.yml)

## Using the generated extension

1. Build or convert a userscript through the web UI to obtain a ZIP archive.
2. Extract the ZIP and load it as an unpacked extension.
   - **Chrome:** visit `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder. Open the extension’s **Details** page and enable **Allow User Scripts** (or enable the `#enable-extension-content-script-user-script` flag on older versions).
   - **Firefox:** open `about:debugging`, choose **This Firefox**, click **Load Temporary Add-on**, and select `manifest.json`. Grant the requested permission when prompted.

After these steps the userscript is registered and runs on matching pages using each browser’s native user‑script engine.

## Feedback and Issues

Have suggestions or found a bug? Please visit feel free to open issues or provide feedback.

If you'd like to support the project, consider donating via [PayPal](https://www.paypal.com/paypalme/my/profile).

