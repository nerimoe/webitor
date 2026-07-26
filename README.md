# Webitor

Webitor is a local-first text and Markdown editor designed for iPad, Chromebook, and desktop browsers. It keeps the document tree simple, uses large touch targets, and does not require an account.

## Features

- Local workspace persisted in IndexedDB with one-second autosave
- File and folder import, external drag-and-drop, rename, delete, move, and reorder
- Plain text editing with per-document undo history, find/replace, and optional syntax highlighting
- Markdown preview, two-pane editing, image import and preview
- Fuzzy search across all documents and a local editing timeline
- Save, Save As, Web Share, single-file export, and workspace ZIP export
- End-to-end encrypted short links that expire after seven days
- English and Simplified Chinese, light/dark/system themes, installable offline PWA

Editing, autosave, search, preview, and export remain entirely local and work offline. Creating a short link compresses and encrypts the file in the browser with AES-256-GCM, then stores only the ciphertext in Cloudflare R2. The decryption key stays in the URL fragment and is never sent to the Worker. Shares expire logically after seven days and are removed by an R2 lifecycle rule. Webitor has no analytics, accounts, or cloud sync.

## Browser support

Chromium browsers can use the File System Access API for writable file handles. Safari and iPadOS use file inputs, downloads, ZIP export, and the system share sheet where supported. Receiving files through the iPadOS share menu is not reliably available to installed web apps.

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and a local Wrangler Worker on port 8787. The Vite server proxies `/api` to Wrangler, whose local R2 implementation stores development shares on the current machine.

Cloudflare setup and deployment:

```bash
npx wrangler login
npx wrangler r2 bucket create webitor-shares
npx wrangler r2 bucket lifecycle add webitor-shares expire-shares --expire-days 8 --force
npm run deploy
```

The Worker serves the built PWA and `/api/shares/:id` from the same origin. Change bindings, expiry, or limits in `wrangler.jsonc`, then run `npm run cf:typegen` whenever the configuration changes.

Verification:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## License

MIT
