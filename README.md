# Userscript Converter

A web app that converts Tampermonkey/Greasemonkey userscripts into Firefox Manifest V3 extensions.

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
