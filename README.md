# snaptext-transfer

A static, browser-only tool for transferring user-owned text/code snippets through OCR-friendly sheets.

The sender manually pastes text, the browser compresses it, optionally encrypts it, packages it as `STP1`, encodes package bytes as OCR32 lines, and renders high-contrast sheets. The receiver uploads photos/screenshots or pastes OCR text, validates each line with CRC32, reconstructs the package, decrypts/decompresses locally, verifies SHA-256, and only then displays the recovered text.

## Safety boundaries

- Use this only for data you own or are explicitly authorized to move.
- The app does not read files automatically, monitor the keyboard, monitor the clipboard, bypass audits, upload data, or run background transfer.
- The sender requires manual paste into the page.
- All compression, encryption, OCR, decoding, decryption, decompression, and verification run in the browser.
- The app does not send plaintext, passphrases, photos, OCR output, or recovered text to a server.
- No third-party CDN, analytics, or remote scripts are used.
- Passphrases and plaintext are not written to URL, localStorage, sessionStorage, IndexedDB, or console.

## Protocol summary

```text
original text
  -> UTF-8 bytes
  -> gzip
  -> optional AES-GCM encryption
  -> STP1 binary package
  -> OCR32 encoding
  -> fixed line format with CRC32
  -> OCR sheets
```

OCR line format:

```text
<session> <index> <total> <len> <crc32> <data>
```

Example:

```text
7G4K2P 000123 001024 0060 A1B2C3D4 9X8JQ2M7V...
```

The OCR32 alphabet is:

```text
0123456789ABCDEFGHJKMNPQRSTVWXYZ
```

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

Useful scripts:

```bash
npm run test
npm run build
npm run preview
npm run copy-assets
```

`copy-assets` copies Tesseract.js assets from `node_modules` into `public/tesseract/`:

- `worker.min.js`
- `tesseract-core*.wasm.js`
- `tesseract-core*.wasm`
- `eng.traineddata.gz`

These are then served as static files by Vite/GitHub Pages. Runtime OCR does not use a CDN.

## GitHub Pages deployment

1. Create a GitHub repo named `snaptext-transfer`.
2. Push this project to `main`.
3. In the repo settings, enable GitHub Pages with source set to GitHub Actions.
4. The workflow at `.github/workflows/deploy.yml` runs `npm ci`, `npm run build`, uploads `dist`, and deploys Pages.
5. After the workflow succeeds, open the Pages URL from the deployment summary.

The Vite config uses `base: './'`, so the built app works under a project path such as `/snaptext-transfer/` without extra configuration.

## End-to-end test flow

1. Run `npm run dev`.
2. Open the app and stay on **Encode / Send on A**.
3. Paste:

   ```js
   console.log("hello world");
   ```

4. Enter a passphrase.
5. Keep **Balanced** selected and click **Build**.
6. Confirm one or more OCR sheets render.
7. Download the current page PNG.
8. Switch to **Decode / Receive on B**.
9. Enter the same passphrase.
10. Upload the PNG and click **OCR Images**.
11. When all chunks are received, click **Recover**.
12. Confirm the recovered text exactly equals the original input.

Additional manual samples to verify:

```text
你好，世界
console.log("中文测试");
```

```js
	const value = `emoji: 🙂`;
	if (value === "x" || value === 'y') {
	  console.log({ brackets: [1, 2, 3] });
	}
```

## Current implementation

- Vite + TypeScript static frontend.
- gzip compression via `fflate`.
- Optional encryption with WebCrypto PBKDF2-SHA256 and AES-GCM 256-bit.
- Default encryption enabled, default PBKDF2 iterations: `600000`.
- Local Tesseract.js OCR with explicit `workerPath`, `corePath`, and `langPath`.
- OCR32 encoding without padding.
- CRC32 validation per OCR line.
- Missing range formatting and retransmit sheet generation.
- Multi-image upload.
- Manual paste OCR fallback.
- High-resolution PNG export and all-pages ZIP export.
- GitHub Actions Pages deployment workflow.
- Vitest coverage for OCR32, CRC32, ranges, line parsing, package roundtrip, and crypto roundtrip.

## Limits

- This is for text snippets, not large repositories. Keep transfers under about 1 MB.
- OCR quality depends heavily on image sharpness, focus, exposure, and angle.
- Dense profile is best for screenshots or very sharp close-range captures.
- Rotation retries are optional because they multiply OCR time.
- There is no IndexedDB receive-progress persistence in the MVP.
- There is no advanced manual correction table yet.
- Encryption protects against casual decoding, but weak passphrases can be attacked offline by anyone who has the sheets.

## Future improvements

- IndexedDB receive-progress persistence for long sessions.
- Manual correction UI for bad OCR lines.
- Better automatic crop/orientation detection.
- Adaptive image thresholding and dewarping.
- Worker pool for faster multi-image OCR.
- Dedicated self-test that renders a sheet to canvas and runs OCR automatically.
