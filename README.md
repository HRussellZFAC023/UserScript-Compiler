# UserScript-Compiler

A web app that converts a Tampermonkey/Greasemonkey userscript into a Firefox Manifest V3 extension. The project uses [Vite](https://vitejs.dev/) for bundling and [Tailwind CSS](https://tailwindcss.com/) for styling.

## Development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The bundled site will be output to the `dist/` directory. A GitHub Actions workflow is provided to deploy the site to GitHub Pages automatically on pushes to `main`.
