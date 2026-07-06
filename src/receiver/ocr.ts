import { PSM, createWorker } from 'tesseract.js';
import { preprocessImage } from './imagePreprocess';

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

function assetPath(path: string): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base}${path}`;
}

function scoreOcrText(text: string): number {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      const parts = line.split(/\s+/);
      return parts.length >= 6 && /[0-9A-Za-z]{20,}/.test(line);
    }).length;
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
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    const recognized: string[] = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      let bestText = '';
      let bestScore = -1;
      for (const rotation of rotations) {
        options.onProgress?.({
          fileIndex,
          fileCount: files.length,
          status: `preprocess ${rotation}deg`,
          progress: 0,
        });
        const canvas = await preprocessImage(files[fileIndex], { rotation });
        const result = await worker.recognize(canvas);
        const text = result.data.text;
        const score = scoreOcrText(text);
        if (score > bestScore) {
          bestText = text;
          bestScore = score;
        }
      }
      recognized.push(bestText);
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
