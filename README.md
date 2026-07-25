# Webitor

Webitor is a local-first text and Markdown editor designed for iPad, Chromebook, and desktop browsers. It keeps the document tree simple, uses large touch targets, and works without a server or account.

## Features

- Local workspace persisted in IndexedDB with one-second autosave
- File and folder import, external drag-and-drop, rename, delete, move, and reorder
- Plain text editing with per-document undo history, find/replace, and optional syntax highlighting
- Markdown preview, two-pane editing, image import and preview
- Fuzzy search across all documents and a local editing timeline
- Save, Save As, Web Share, single-file export, and workspace ZIP export
- English and Simplified Chinese, light/dark/system themes, installable offline PWA

All document content remains in the browser or in files explicitly selected by the user. Webitor has no backend, analytics, accounts, or cloud sync.

## Browser support

Chromium browsers can use the File System Access API for writable file handles. Safari and iPadOS use file inputs, downloads, ZIP export, and the system share sheet where supported. Receiving files through the iPadOS share menu is not reliably available to installed web apps.

## Development

```bash
npm install
npm run dev
```

Verification:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

## License

MIT
