import { buildPackage, type BuiltPackage, type ParsedPackage } from './codec/package';
import { parseRanges } from './codec/ranges';
import {
  PROFILES,
  buildOcrTransfer,
  chunkBytesForProfile,
  filterLinesByIndexes,
  paginateOcrLines,
  type BuiltSheets,
  type OcrSheet,
  type ProfileName,
} from './sender/buildSheets';
import {
  downloadSheetPng,
  downloadSheetsZip,
  renderSheetElement,
} from './sender/renderSheet';
import { recognizeImages } from './receiver/ocr';
import { parseOcrText, type ParsedOcrText, type SessionParse } from './receiver/parseOcrText';
import { getMissingRanges, isSessionComplete, reconstructSession } from './receiver/reconstruct';
import { formatBytes, formatPercent } from './utils/format';

type StatusKind = 'muted' | 'ok' | 'warn' | 'error';

interface EncodeState {
  builtPackage: BuiltPackage | null;
  transfer: BuiltSheets | null;
  sheets: OcrSheet[];
  pageIndex: number;
  encrypted: boolean;
}

interface DecodeState {
  parsed: ParsedOcrText | null;
  selectedSession: string | null;
  recovered: ParsedPackage | null;
}

const encodeState: EncodeState = {
  builtPackage: null,
  transfer: null,
  sheets: [],
  pageIndex: 0,
  encrypted: true,
};

const decodeState: DecodeState = {
  parsed: null,
  selectedSession: null,
  recovered: null,
};

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, string, index) => out + string + String(values[index] ?? ''), '');
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing UI element: ${selector}`);
  }
  return node;
}

function setStatus(element: HTMLElement, message: string, kind: StatusKind = 'muted'): void {
  element.textContent = message;
  element.dataset.kind = kind;
}

function selectedProfile(root: ParentNode): ProfileName {
  return query<HTMLInputElement>(root, 'input[name="profile"]:checked').value as ProfileName;
}

function selectedSession(): SessionParse | null {
  if (!decodeState.parsed || decodeState.parsed.sessions.length === 0) {
    return null;
  }
  return (
    decodeState.parsed.sessions.find((session) => session.session === decodeState.selectedSession) ??
    decodeState.parsed.sessions[0]
  );
}

function bindTabs(root: HTMLElement): void {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.tab-button'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('.tab-panel'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const other of buttons) {
        other.classList.toggle('is-active', other === button);
      }
      for (const panel of panels) {
        panel.classList.toggle('is-active', panel.id === button.dataset.tab);
      }
    });
  }
}

function renderStats(target: HTMLElement, items: Array<[string, string]>): void {
  target.innerHTML = '';
  for (const [label, value] of items) {
    const item = document.createElement('div');
    item.className = 'stat';
    item.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
    target.append(item);
  }
}

function updateSheetPreview(root: HTMLElement): void {
  const preview = query<HTMLElement>(root, '#sheetPreview');
  const pageLabel = query<HTMLElement>(root, '#pageLabel');
  const previous = query<HTMLButtonElement>(root, '#prevPage');
  const next = query<HTMLButtonElement>(root, '#nextPage');
  const hasSheets = encodeState.sheets.length > 0;

  preview.innerHTML = '';
  if (!hasSheets) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Build a package to preview OCR sheets.';
    preview.append(empty);
    pageLabel.textContent = 'Page 0 / 0';
  } else {
    const sheet = encodeState.sheets[encodeState.pageIndex];
    preview.append(renderSheetElement(sheet, encodeState.encrypted));
    pageLabel.textContent = `Page ${sheet.pageNumber} / ${sheet.pageCount}`;
  }

  previous.disabled = !hasSheets || encodeState.pageIndex === 0;
  next.disabled = !hasSheets || encodeState.pageIndex >= encodeState.sheets.length - 1;
  query<HTMLButtonElement>(root, '#fullscreenPage').disabled = !hasSheets;
  query<HTMLButtonElement>(root, '#downloadPage').disabled = !hasSheets;
  query<HTMLButtonElement>(root, '#downloadZip').disabled = !hasSheets;
  query<HTMLButtonElement>(root, '#printPage').disabled = !hasSheets;
  query<HTMLButtonElement>(root, '#buildMissing').disabled = !encodeState.transfer;
  query<HTMLButtonElement>(root, '#showAllPages').disabled = !encodeState.transfer;
}

async function buildEncode(root: HTMLElement): Promise<void> {
  const plainText = query<HTMLTextAreaElement>(root, '#plainText').value;
  const filename = query<HTMLInputElement>(root, '#filename').value;
  const passphrase = query<HTMLInputElement>(root, '#sendPassphrase').value;
  const encryptionDisabled = query<HTMLInputElement>(root, '#disableEncryption').checked;
  const status = query<HTMLElement>(root, '#encodeStatus');
  const stats = query<HTMLElement>(root, '#encodeStats');
  const profileName = selectedProfile(root);
  const profile = PROFILES[profileName];

  if (!plainText) {
    setStatus(status, 'Paste text or code before building.', 'warn');
    return;
  }
  if (!encryptionDisabled && !passphrase) {
    setStatus(status, 'Passphrase is required because encryption is enabled.', 'warn');
    return;
  }

  setStatus(status, 'Building package locally...', 'muted');
  try {
    const builtPackage = await buildPackage({
      plainText,
      filename,
      passphrase,
      encrypted: !encryptionDisabled,
    });
    const transfer = await buildOcrTransfer(builtPackage.bytes, profileName);
    encodeState.builtPackage = builtPackage;
    encodeState.transfer = transfer;
    encodeState.sheets = transfer.sheets;
    encodeState.pageIndex = 0;
    encodeState.encrypted = !encryptionDisabled;

    renderStats(stats, [
      ['Original', formatBytes(builtPackage.meta.plainTextBytes)],
      ['Compressed', formatBytes(builtPackage.meta.compressedBytes)],
      ['Body', formatBytes(builtPackage.meta.bodyBytes)],
      ['Package', formatBytes(builtPackage.bytes.length)],
      ['OCR lines', String(transfer.totalChunks)],
      ['Pages', String(transfer.sheets.length)],
      ['Capacity/page', formatBytes(chunkBytesForProfile(profile) * profile.linesPerPage)],
    ]);
    setStatus(
      status,
      `Ready. Compression ratio ${formatPercent(
        builtPackage.meta.compressedBytes / Math.max(1, builtPackage.meta.plainTextBytes),
      )}.`,
      'ok',
    );
    updateSheetPreview(root);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Build failed.', 'error');
  }
}

function buildMissingPages(root: HTMLElement): void {
  const status = query<HTMLElement>(root, '#encodeStatus');
  if (!encodeState.transfer) {
    setStatus(status, 'Build a full transfer first.', 'warn');
    return;
  }
  try {
    const indexes = parseRanges(query<HTMLInputElement>(root, '#missingRanges').value);
    if (indexes.length === 0) {
      setStatus(status, 'Enter missing ranges first.', 'warn');
      return;
    }
    const outOfRange = indexes.find((index) => index < 0 || index >= encodeState.transfer!.totalChunks);
    if (outOfRange !== undefined) {
      throw new Error(`Missing range index is outside this transfer: ${outOfRange}`);
    }
    const lines = filterLinesByIndexes(encodeState.transfer.lines, indexes);
    encodeState.sheets = paginateOcrLines(lines, {
      session: encodeState.transfer.session,
      profile: encodeState.transfer.profile,
      totalChunks: encodeState.transfer.totalChunks,
      retransmit: true,
    });
    encodeState.pageIndex = 0;
    setStatus(status, `Showing ${lines.length} retransmit lines on ${encodeState.sheets.length} page(s).`, 'ok');
    updateSheetPreview(root);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Invalid missing ranges.', 'error');
  }
}

function renderDecodeSummary(root: HTMLElement): void {
  const stats = query<HTMLElement>(root, '#decodeStats');
  const status = query<HTMLElement>(root, '#decodeStatus');
  const sessionSelect = query<HTMLSelectElement>(root, '#sessionSelect');
  const missingText = query<HTMLTextAreaElement>(root, '#missingOutput');
  const recoverButton = query<HTMLButtonElement>(root, '#recoverButton');

  if (!decodeState.parsed || decodeState.parsed.sessions.length === 0) {
    renderStats(stats, [
      ['Parsed lines', String(decodeState.parsed?.parsedLines ?? 0)],
      ['CRC failed', String(decodeState.parsed?.crcFailures ?? 0)],
      ['Invalid lines', String(decodeState.parsed?.invalidLines ?? 0)],
      ['Duplicates', String(decodeState.parsed?.duplicateLines ?? 0)],
    ]);
    sessionSelect.innerHTML = '';
    sessionSelect.disabled = true;
    missingText.value = '';
    recoverButton.disabled = true;
    setStatus(status, 'No valid OCR lines yet.', 'warn');
    return;
  }

  sessionSelect.innerHTML = '';
  for (const session of decodeState.parsed.sessions) {
    const option = document.createElement('option');
    option.value = session.session;
    option.textContent = `${session.session} (${session.records.size}/${session.total})`;
    sessionSelect.append(option);
  }
  if (!decodeState.selectedSession) {
    decodeState.selectedSession = decodeState.parsed.sessions[0].session;
  }
  sessionSelect.value = decodeState.selectedSession;
  sessionSelect.disabled = decodeState.parsed.sessions.length <= 1;

  const session = selectedSession();
  if (!session) {
    return;
  }
  const missing = getMissingRanges(session);
  missingText.value = missing;
  recoverButton.disabled = !isSessionComplete(session);
  renderStats(stats, [
    ['Session', session.session],
    ['Received', `${session.records.size} / ${session.total}`],
    ['Parsed lines', String(decodeState.parsed.parsedLines)],
    ['CRC failed', String(decodeState.parsed.crcFailures)],
    ['Invalid lines', String(decodeState.parsed.invalidLines)],
    ['Duplicates', String(decodeState.parsed.duplicateLines)],
  ]);
  setStatus(
    status,
    missing
      ? `Need missing ranges: ${missing}`
      : 'All chunks received. Ready to decrypt and recover.',
    missing ? 'warn' : 'ok',
  );
}

function parseDecodeText(root: HTMLElement): void {
  const text = query<HTMLTextAreaElement>(root, '#ocrText').value;
  const status = query<HTMLElement>(root, '#decodeStatus');
  decodeState.parsed = parseOcrText(text);
  decodeState.selectedSession = decodeState.parsed.sessions[0]?.session ?? null;
  decodeState.recovered = null;
  query<HTMLTextAreaElement>(root, '#recoveredText').value = '';
  setStatus(status, 'Parsed OCR text.', 'muted');
  renderDecodeSummary(root);
}

async function runOcr(root: HTMLElement): Promise<void> {
  const fileInput = query<HTMLInputElement>(root, '#imageFiles');
  const status = query<HTMLElement>(root, '#decodeStatus');
  const progress = query<HTMLProgressElement>(root, '#ocrProgress');
  const files = Array.from(fileInput.files ?? []);
  if (files.length === 0) {
    setStatus(status, 'Choose one or more images first.', 'warn');
    return;
  }

  progress.hidden = false;
  progress.value = 0;
  setStatus(status, 'Starting local OCR...', 'muted');
  try {
    const text = await recognizeImages(files, {
      tryRotations: query<HTMLInputElement>(root, '#tryRotations').checked,
      onProgress: (event) => {
        const fileWeight = event.fileCount > 0 ? 1 / event.fileCount : 1;
        progress.value = Math.min(1, event.fileIndex * fileWeight + event.progress * fileWeight);
        setStatus(
          status,
          `OCR ${event.fileIndex + 1}/${event.fileCount}: ${event.status}`,
          'muted',
        );
      },
    });
    const ocrText = query<HTMLTextAreaElement>(root, '#ocrText');
    ocrText.value = ocrText.value ? `${ocrText.value}\n${text}` : text;
    setStatus(status, 'OCR finished. Parsing recognized text...', 'ok');
    parseDecodeText(root);
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'OCR failed.', 'error');
  } finally {
    progress.hidden = true;
  }
}

async function recoverText(root: HTMLElement): Promise<void> {
  const session = selectedSession();
  const status = query<HTMLElement>(root, '#decodeStatus');
  const passphrase = query<HTMLInputElement>(root, '#receivePassphrase').value;
  if (!session) {
    setStatus(status, 'No session selected.', 'warn');
    return;
  }
  setStatus(status, 'Recovering package locally...', 'muted');
  try {
    const recovered = await reconstructSession(session, passphrase);
    decodeState.recovered = recovered;
    query<HTMLTextAreaElement>(root, '#recoveredText').value = recovered.plainText;
    setStatus(status, `Recovered ${formatBytes(recovered.plainBytes.length)} as ${recovered.meta.filename}.`, 'ok');
  } catch (error) {
    setStatus(status, error instanceof Error ? error.message : 'Recovery failed.', 'error');
  }
}

async function copyText(text: string, status: HTMLElement, emptyMessage: string): Promise<void> {
  if (!text) {
    setStatus(status, emptyMessage, 'warn');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(status, 'Copied.', 'ok');
  } catch {
    setStatus(status, 'Clipboard copy was blocked by the browser.', 'error');
  }
}

function downloadRecovered(root: HTMLElement): void {
  const status = query<HTMLElement>(root, '#decodeStatus');
  if (!decodeState.recovered) {
    setStatus(status, 'Recover text before downloading.', 'warn');
    return;
  }
  const blob = new Blob([decodeState.recovered.plainText], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = decodeState.recovered.meta.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindEncode(root: HTMLElement): void {
  query<HTMLButtonElement>(root, '#buildButton').addEventListener('click', () => {
    void buildEncode(root);
  });
  query<HTMLInputElement>(root, '#disableEncryption').addEventListener('change', (event) => {
    query<HTMLElement>(root, '#unencryptedWarning').hidden = !(event.target as HTMLInputElement).checked;
  });
  query<HTMLButtonElement>(root, '#prevPage').addEventListener('click', () => {
    encodeState.pageIndex = Math.max(0, encodeState.pageIndex - 1);
    updateSheetPreview(root);
  });
  query<HTMLButtonElement>(root, '#nextPage').addEventListener('click', () => {
    encodeState.pageIndex = Math.min(encodeState.sheets.length - 1, encodeState.pageIndex + 1);
    updateSheetPreview(root);
  });
  query<HTMLButtonElement>(root, '#fullscreenPage').addEventListener('click', () => {
    query<HTMLElement>(root, '#sheetPreview').firstElementChild?.requestFullscreen();
  });
  query<HTMLButtonElement>(root, '#downloadPage').addEventListener('click', () => {
    const sheet = encodeState.sheets[encodeState.pageIndex];
    if (sheet) {
      void downloadSheetPng(sheet, encodeState.encrypted);
    }
  });
  query<HTMLButtonElement>(root, '#downloadZip').addEventListener('click', () => {
    if (encodeState.sheets.length > 0) {
      void downloadSheetsZip(encodeState.sheets, encodeState.encrypted);
    }
  });
  query<HTMLButtonElement>(root, '#printPage').addEventListener('click', () => window.print());
  query<HTMLButtonElement>(root, '#buildMissing').addEventListener('click', () => buildMissingPages(root));
  query<HTMLButtonElement>(root, '#showAllPages').addEventListener('click', () => {
    if (encodeState.transfer) {
      encodeState.sheets = encodeState.transfer.sheets;
      encodeState.pageIndex = 0;
      updateSheetPreview(root);
      setStatus(query<HTMLElement>(root, '#encodeStatus'), 'Showing all pages.', 'ok');
    }
  });
  updateSheetPreview(root);
}

function bindDecode(root: HTMLElement): void {
  query<HTMLButtonElement>(root, '#ocrButton').addEventListener('click', () => {
    void runOcr(root);
  });
  query<HTMLButtonElement>(root, '#parseOcrButton').addEventListener('click', () => parseDecodeText(root));
  query<HTMLSelectElement>(root, '#sessionSelect').addEventListener('change', (event) => {
    decodeState.selectedSession = (event.target as HTMLSelectElement).value;
    renderDecodeSummary(root);
  });
  query<HTMLButtonElement>(root, '#copyMissing').addEventListener('click', () => {
    void copyText(
      query<HTMLTextAreaElement>(root, '#missingOutput').value,
      query<HTMLElement>(root, '#decodeStatus'),
      'No missing ranges to copy.',
    );
  });
  query<HTMLButtonElement>(root, '#recoverButton').addEventListener('click', () => {
    void recoverText(root);
  });
  query<HTMLButtonElement>(root, '#copyRecovered').addEventListener('click', () => {
    void copyText(
      query<HTMLTextAreaElement>(root, '#recoveredText').value,
      query<HTMLElement>(root, '#decodeStatus'),
      'No recovered text to copy.',
    );
  });
  query<HTMLButtonElement>(root, '#downloadRecovered').addEventListener('click', () => downloadRecovered(root));
  renderDecodeSummary(root);
}

function bindHelp(root: HTMLElement): void {
  query<HTMLButtonElement>(root, '#fillSample').addEventListener('click', () => {
    query<HTMLButtonElement>(root, '[data-tab="tab-encode"]').click();
    query<HTMLTextAreaElement>(root, '#plainText').value = 'console.log("hello world");';
    query<HTMLInputElement>(root, '#sendPassphrase').value = 'correct horse battery staple';
    setStatus(query<HTMLElement>(root, '#encodeStatus'), 'Sample loaded.', 'ok');
  });
}

function profileMarkup(): string {
  return Object.values(PROFILES)
    .map(
      (profile) => html`
        <label class="profile-option">
          <input
            type="radio"
            name="profile"
            value="${profile.name}"
            ${profile.name === 'balanced' ? 'checked' : ''}
          />
          <span>
            <strong>${profile.label}</strong>
            <small>${profile.dataCharsPerLine} chars · ${profile.fontSize}px · ${profile.linesPerPage} lines</small>
          </span>
        </label>
      `,
    )
    .join('');
}

export function initUi(root: HTMLElement): void {
  root.innerHTML = html`
    <div class="app-shell">
      <header class="app-header">
        <div>
          <p class="eyebrow">Local static transfer</p>
          <h1>snaptext-transfer</h1>
        </div>
        <div class="header-note">No uploads · No CDN · Browser local</div>
      </header>

      <nav class="tabs" aria-label="Main sections">
        <button class="tab-button is-active" data-tab="tab-encode" type="button">Encode / Send on A</button>
        <button class="tab-button" data-tab="tab-decode" type="button">Decode / Receive on B</button>
        <button class="tab-button" data-tab="tab-help" type="button">Help / Test</button>
      </nav>

      <main>
        <section id="tab-encode" class="tab-panel is-active">
          <div class="workspace">
            <section class="panel panel--controls">
              <div class="section-heading">
                <h2>Build OCR sheets</h2>
                <p>Paste only text you own or are authorized to move.</p>
              </div>
              <label class="field">
                <span>Text / code</span>
                <textarea id="plainText" spellcheck="false" placeholder="Paste text or code here"></textarea>
              </label>
              <div class="field-row">
                <label class="field">
                  <span>Filename</span>
                  <input id="filename" value="recovered.txt" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Passphrase</span>
                  <input id="sendPassphrase" type="password" autocomplete="new-password" />
                </label>
              </div>
              <label class="check-row">
                <input id="disableEncryption" type="checkbox" />
                <span>Disable encryption</span>
              </label>
              <p id="unencryptedWarning" class="warning" hidden>
                Unencrypted photos can be decoded by anyone who has the sheets.
              </p>
              <div class="profile-grid" role="radiogroup" aria-label="Profile">
                ${profileMarkup()}
              </div>
              <div class="actions">
                <button id="buildButton" class="primary" type="button">Build</button>
                <span id="encodeStatus" class="status" data-kind="muted">Ready.</span>
              </div>
              <dl id="encodeStats" class="stat-grid"></dl>
              <div class="retransmit">
                <label class="field">
                  <span>Retransmit missing ranges</span>
                  <input id="missingRanges" placeholder="12-15,44,109-113" autocomplete="off" />
                </label>
                <div class="actions">
                  <button id="buildMissing" type="button" disabled>Build Missing Pages</button>
                  <button id="showAllPages" type="button" disabled>Show All Pages</button>
                </div>
              </div>
            </section>

            <section class="panel panel--preview">
              <div class="preview-toolbar">
                <div class="page-controls">
                  <button id="prevPage" type="button">Prev</button>
                  <strong id="pageLabel">Page 0 / 0</strong>
                  <button id="nextPage" type="button">Next</button>
                </div>
                <div class="toolbar-actions">
                  <button id="fullscreenPage" type="button">Fullscreen</button>
                  <button id="downloadPage" type="button">PNG</button>
                  <button id="downloadZip" type="button">ZIP</button>
                  <button id="printPage" type="button">Print</button>
                </div>
              </div>
              <div id="sheetPreview" class="sheet-viewport" aria-live="polite"></div>
            </section>
          </div>
        </section>

        <section id="tab-decode" class="tab-panel">
          <div class="workspace">
            <section class="panel panel--controls">
              <div class="section-heading">
                <h2>Recover from OCR sheets</h2>
                <p>OCR and recovery run locally in this browser tab.</p>
              </div>
              <label class="field">
                <span>Passphrase</span>
                <input id="receivePassphrase" type="password" autocomplete="new-password" />
              </label>
              <label class="field">
                <span>Images</span>
                <input id="imageFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple />
              </label>
              <label class="check-row">
                <input id="tryRotations" type="checkbox" />
                <span>Retry 90/180/270 degree rotations</span>
              </label>
              <div class="actions">
                <button id="ocrButton" class="primary" type="button">OCR Images</button>
                <button id="parseOcrButton" type="button">Parse Text</button>
                <span id="decodeStatus" class="status" data-kind="muted">Ready.</span>
              </div>
              <progress id="ocrProgress" value="0" max="1" hidden></progress>
              <label class="field">
                <span>Paste OCR Text</span>
                <textarea id="ocrText" spellcheck="false" placeholder="OCR text appears here"></textarea>
              </label>
              <label class="field">
                <span>Session</span>
                <select id="sessionSelect" disabled></select>
              </label>
              <dl id="decodeStats" class="stat-grid"></dl>
              <label class="field">
                <span>Missing ranges</span>
                <textarea id="missingOutput" readonly spellcheck="false"></textarea>
              </label>
              <div class="actions">
                <button id="copyMissing" type="button">Copy Missing Ranges</button>
                <button id="recoverButton" class="primary" type="button" disabled>Recover</button>
              </div>
            </section>

            <section class="panel panel--result">
              <div class="section-heading">
                <h2>Recovered text</h2>
                <p>Output is shown only after decryption and SHA-256 verification pass.</p>
              </div>
              <textarea id="recoveredText" class="recovered" readonly spellcheck="false"></textarea>
              <div class="actions">
                <button id="copyRecovered" type="button">Copy Recovered Text</button>
                <button id="downloadRecovered" type="button">Download recovered.txt</button>
              </div>
            </section>
          </div>
        </section>

        <section id="tab-help" class="tab-panel">
          <section class="help-panel">
            <h2>Flow</h2>
            <p>
              Text is converted to UTF-8 bytes, gzipped, optionally encrypted with PBKDF2-SHA256
              and AES-GCM, packed as STP1, encoded as OCR32, split into CRC-checked lines, and
              rendered as high-contrast sheets.
            </p>
            <p>
              The receiver OCRs encoded sheets, not raw code. Each accepted line must pass CRC32.
              Once all chunks are present, the package is parsed, decrypted if needed, decompressed,
              and verified against SHA-256 before text is displayed.
            </p>
            <h2>Small test</h2>
            <p>
              Use the sample, build one page, download the PNG, switch to Decode, upload the PNG,
              OCR it, enter the same passphrase, and recover the original text.
            </p>
            <button id="fillSample" class="primary" type="button">Load hello world sample</button>
            <h2>Safety</h2>
            <p>
              Encryption is enabled by default. A person with the sheets can still attempt offline
              password guessing, so use a long passphrase. Clear the tab after transfer when the text
              is sensitive.
            </p>
            <h2>Limits</h2>
            <p>
              Keep single transfers below about 1 MB. Dense mode is best for screenshots and very
              clear close-range images. If normal network or LAN transfer is available, it is usually
              faster.
            </p>
          </section>
        </section>
      </main>
    </div>
  `;

  bindTabs(root);
  bindEncode(root);
  bindDecode(root);
  bindHelp(root);
}
