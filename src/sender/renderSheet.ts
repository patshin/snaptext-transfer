import { zipSync } from 'fflate';
import type { OcrSheet } from './buildSheets';

const CANVAS_WIDTH = 2200;
const CANVAS_HEIGHT = 3000;
const MARGIN_X = 150;
const HEADER_Y = 150;
const BODY_Y = 390;
const FOOTER_Y = 2870;
const MARKER_SIZE = 86;

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
    <div>${sheet.profile.label} · ${sheet.profile.dataCharsPerLine} chars/line</div>
  `;

  const markerTl = document.createElement('span');
  markerTl.className = 'marker marker--tl';
  const markerTr = document.createElement('span');
  markerTr.className = 'marker marker--tr';
  const markerBl = document.createElement('span');
  markerBl.className = 'marker marker--bl';
  const markerBr = document.createElement('span');
  markerBr.className = 'marker marker--br';

  const lines = document.createElement('pre');
  lines.className = 'sheet-preview__lines';
  lines.style.fontSize = `${sheet.profile.fontSize}px`;
  lines.textContent = sheet.lines.map((entry) => entry.line).join('\n');

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
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create canvas context.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = '#000000';
  drawMarker(ctx, 54, 54);
  drawMarker(ctx, CANVAS_WIDTH - MARKER_SIZE - 54, 54);
  drawMarker(ctx, 54, CANVAS_HEIGHT - MARKER_SIZE - 54);
  drawMarker(ctx, CANVAS_WIDTH - MARKER_SIZE - 54, CANVAS_HEIGHT - MARKER_SIZE - 54);

  ctx.textBaseline = 'top';
  ctx.font = '700 56px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText('SNAPTEXT v1', MARGIN_X, HEADER_Y);
  ctx.font = '36px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText(`session ${sheet.session}`, MARGIN_X, HEADER_Y + 70);
  ctx.fillText(`page ${sheet.pageNumber}/${sheet.pageCount}`, MARGIN_X + 520, HEADER_Y + 70);
  ctx.fillText(
    `${sheet.profile.label} profile · ${sheet.profile.dataCharsPerLine} chars/line`,
    MARGIN_X + 920,
    HEADER_Y + 70,
  );
  if (sheet.retransmit) {
    ctx.fillText('retransmit set', MARGIN_X, HEADER_Y + 122);
  }

  const longestLine = Math.max(...sheet.lines.map((entry) => entry.line.length), 1);
  const usableWidth = CANVAS_WIDTH - MARGIN_X * 2;
  const fontSize = Math.floor(Math.min(sheet.profile.fontSize * 1.55, usableWidth / (longestLine * 0.62)));
  const lineHeight = Math.ceil(fontSize * 1.42);
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  for (let i = 0; i < sheet.lines.length; i += 1) {
    ctx.fillText(sheet.lines[i].line, MARGIN_X, BODY_Y + i * lineHeight);
  }

  ctx.font = '32px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillText(
    `Only scan with snaptext-transfer. Encrypted: ${encrypted ? 'yes' : 'no'}.`,
    MARGIN_X,
    FOOTER_Y,
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
