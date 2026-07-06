import { zipSync } from 'fflate';
import type { OcrSheet } from './buildSheets';

const CANVAS_WIDTH = 3600;
const CANVAS_HEIGHT = 5000;
const MARGIN_X = 220;
const HEADER_Y = 220;
const BODY_Y = 620;
const MARKER_SIZE = 120;
const MONO_FONT = '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const DATA_CHARS_PER_VISUAL_ROW = 48;
const DATA_GROUP_SIZE = 2;

function groupDataForOcr(data: string, groupSize = DATA_GROUP_SIZE): string {
  return data.match(new RegExp(`.{1,${groupSize}}`, 'g'))?.join(' ') ?? data;
}

function formatLineForOcrRows(line: string): string[] {
  const parts = line.split(/\s+/);
  if (parts.length < 6) {
    return [line];
  }
  const header = parts.slice(0, 5).join(' ');
  const data = parts.slice(5).join('');
  const dataRows = data.match(new RegExp(`.{1,${DATA_CHARS_PER_VISUAL_ROW}}`, 'g')) ?? [data];
  return [header, ...dataRows.map((row) => groupDataForOcr(row))];
}

export function renderSheetElement(sheet: OcrSheet, encrypted: boolean): HTMLElement {
  const root = document.createElement('article');
  root.className = 'sheet-preview';
  root.dataset.session = sheet.session;

  const header = document.createElement('header');
  header.className = 'sheet-preview__header';
  header.innerHTML = `
    <div><strong>SNAPTEXT v1</strong></div>
    <div>session ${sheet.session}</div>
    <div>page ${sheet.pageNumber}/${sheet.pageCount}</div>
    <div>${sheet.profile.label} · ${sheet.profile.dataCharsPerLine} chars/chunk</div>
  `;

  const markerTl = document.createElement('span');
  markerTl.className = 'marker marker--tl';
  const markerTr = document.createElement('span');
  markerTr.className = 'marker marker--tr';
  const markerBl = document.createElement('span');
  markerBl.className = 'marker marker--bl';
  const markerBr = document.createElement('span');
  markerBr.className = 'marker marker--br';

  const renderedLines = sheet.lines.flatMap((entry) => formatLineForOcrRows(entry.line));
  const previewHeight = Math.max(2080, 480 + renderedLines.length * sheet.profile.fontSize * 1.48 + 240);
  root.style.minHeight = `${Math.ceil(previewHeight)}px`;

  const lines = document.createElement('pre');
  lines.className = 'sheet-preview__lines';
  lines.style.fontSize = `${sheet.profile.fontSize}px`;
  lines.textContent = renderedLines.join('\n');

  const footer = document.createElement('footer');
  footer.className = 'sheet-preview__footer';
  footer.textContent = `Only scan with snaptext-transfer. Encrypted: ${
    encrypted ? 'yes' : 'no'
  }. Retransmit: ${sheet.retransmit ? 'yes' : 'no'}.`;

  root.append(markerTl, markerTr, markerBl, markerBr, header, lines, footer);
  return root;
}

function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillRect(x, y, MARKER_SIZE, MARKER_SIZE);
}

export function createSheetCanvas(sheet: OcrSheet, encrypted: boolean): HTMLCanvasElement {
  const renderedLines = sheet.lines.flatMap((entry) => formatLineForOcrRows(entry.line));
  const longestLine = Math.max(...renderedLines.map((line) => line.length), 1);
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const fontSize = Math.floor(Math.min(sheet.profile.fontSize * 3.2, usableWidth / (longestLine * 0.56)));
  const lineHeight = Math.ceil(fontSize * 1.45);
  const canvasHeight = Math.max(CANVAS_HEIGHT, BODY_Y + renderedLines.length * lineHeight + 620);
  const footerY = canvasHeight - 260;
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create canvas context.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, canvasHeight);
  ctx.fillStyle = '#000000';
  drawMarker(ctx, 82, 82);
  drawMarker(ctx, CANVAS_WIDTH - MARKER_SIZE - 82, 82);
  drawMarker(ctx, 82, canvasHeight - MARKER_SIZE - 82);
  drawMarker(ctx, CANVAS_WIDTH - MARKER_SIZE - 82, canvasHeight - MARKER_SIZE - 82);

  ctx.textBaseline = 'top';
  ctx.font = `700 88px ${MONO_FONT}`;
  ctx.fillText('SNAPTEXT v1', MARGIN_X, HEADER_Y);
  ctx.font = `54px ${MONO_FONT}`;
  ctx.fillText(`session ${sheet.session}`, MARGIN_X, HEADER_Y + 112);
  ctx.fillText(`page ${sheet.pageNumber}/${sheet.pageCount}`, MARGIN_X + 820, HEADER_Y + 112);
  ctx.fillText(
    `${sheet.profile.label} profile · ${sheet.profile.dataCharsPerLine} chars/chunk`,
    MARGIN_X + 1500,
    HEADER_Y + 112,
  );
  if (sheet.retransmit) {
    ctx.fillText('retransmit set', MARGIN_X, HEADER_Y + 190);
  }

  ctx.font = `500 ${fontSize}px ${MONO_FONT}`;
  for (let i = 0; i < renderedLines.length; i += 1) {
    ctx.fillText(renderedLines[i], MARGIN_X, BODY_Y + i * lineHeight);
  }

  ctx.font = `44px ${MONO_FONT}`;
  ctx.fillText(
    `Only scan with snaptext-transfer. Encrypted: ${encrypted ? 'yes' : 'no'}.`,
    MARGIN_X,
    footerY,
  );
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Unable to export PNG.'));
      }
    }, 'image/png');
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSheetPng(sheet: OcrSheet, encrypted: boolean): Promise<void> {
  const blob = await canvasToBlob(createSheetCanvas(sheet, encrypted));
  downloadBlob(blob, `snaptext-${sheet.session}-page-${String(sheet.pageNumber).padStart(3, '0')}.png`);
}

export async function downloadSheetsZip(sheets: OcrSheet[], encrypted: boolean): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  for (const sheet of sheets) {
    const blob = await canvasToBlob(createSheetCanvas(sheet, encrypted));
    files[`snaptext-${sheet.session}-page-${String(sheet.pageNumber).padStart(3, '0')}.png`] =
      new Uint8Array(await blob.arrayBuffer());
  }
  const zipBytes = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `snaptext-${sheets[0]?.session ?? 'pages'}.zip`);
}
