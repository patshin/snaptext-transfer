import { PSM, createWorker } from 'tesseract.js';
import { preprocessImage } from './imagePreprocess';
import { parseOcrText } from './parseOcrText';

export interface OcrProgress {
  fileIndex: number;
  fileCount: number;
  status: string;
  progress: number;
}

export interface RecognizeOptions {
  tryRotations?: boolean;
  onProgress?: (progress: OcrProgress) => void;
}

const OCR_WHITELIST = '0123456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -_';
const PAGE_SEGMENT_MODES = [PSM.SINGLE_BLOCK, PSM.SINGLE_COLUMN, PSM.SPARSE_TEXT];
const CROP_MODES: Array<'data-region' | 'full'> = ['data-region', 'full'];

interface OcrCandidate {
  text: string;
  score: number;
}

function assetPath(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${path}`;
}

function heuristicLineScore(text: string): number {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      const parts = line.split(/\s+/);
      return parts.length >= 6 && /[0-9A-Za-z]{20,}/.test(line);
    }).length;
}

function scoreOcrText(text: string): number {
  const parsed = parseOcrText(text);
  const bestSession = parsed.sessions[0];
  const received = bestSession?.records.size ?? 0;
  return received * 100_000 + parsed.parsedLines * 1_000 + heuristicLineScore(text) - parsed.crcFailures * 2;
}

export async function recognizeImages(files: File[], options: RecognizeOptions = {}): Promise<string> {
  if (files.length === 0) {
    return '';
  }

  const rotations: Array<0 | 90 | 180 | 270> = options.tryRotations ? [0, 90, 180, 270] : [0];
  const worker = await createWorker('eng', 1, {
    workerPath: assetPath('tesseract/worker.min.js'),
    corePath: assetPath('tesseract/core'),
    langPath: assetPath('tesseract/lang-data'),
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (message) => {
      options.onProgress?.({
        fileIndex: 0,
        fileCount: files.length,
        status: String(message.status ?? 'ocr'),
        progress: Number(message.progress ?? 0),
      });
    },
  });

  try {
    await worker.setParameters({
      tessedit_char_whitelist: OCR_WHITELIST,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    const recognized: string[] = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const candidates: OcrCandidate[] = [];
      let bestScore = -1;
      for (const rotation of rotations) {
        for (const cropMode of CROP_MODES) {
          const canvas = await preprocessImage(files[fileIndex], { rotation, cropMode });
          for (const pageSegMode of PAGE_SEGMENT_MODES) {
            options.onProgress?.({
              fileIndex,
              fileCount: files.length,
              status: `ocr ${cropMode} ${rotation}deg psm ${pageSegMode}`,
              progress: 0,
            });
            await worker.setParameters({
              tessedit_pageseg_mode: pageSegMode,
            });
            const result = await worker.recognize(canvas);
            const text = result.data.text;
            const score = scoreOcrText(text);
            if (text.trim()) {
              candidates.push({ text, score });
            }
            if (score > bestScore) {
              bestScore = score;
            }
          }
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const usefulCandidates = candidates.filter((candidate) => candidate.score > 0);
      const selectedCandidates = usefulCandidates.length > 0 ? usefulCandidates : candidates.slice(0, 1);
      recognized.push(selectedCandidates.map((candidate) => candidate.text).join('\n'));
      options.onProgress?.({
        fileIndex,
        fileCount: files.length,
        status: 'done',
        progress: 1,
      });
    }
    return recognized.join('\n');
  } finally {
    await worker.terminate();
  }
}
