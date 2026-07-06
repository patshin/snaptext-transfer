export interface PreprocessOptions {
  maxWidth?: number;
  rotation?: 0 | 90 | 180 | 270;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Unable to load image: ${file.name}`));
    };
    image.src = url;
  });
}

function rotatedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: height, height: width } : { width, height };
}

export async function preprocessImage(
  file: File,
  options: PreprocessOptions = {},
): Promise<HTMLCanvasElement> {
  const maxWidth = options.maxWidth ?? 3600;
  const rotation = options.rotation ?? 0;
  const image = await loadImage(file);
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const size = rotatedSize(sourceWidth, sourceHeight, rotation);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to create preprocessing canvas.');
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate((3 * Math.PI) / 2);
  }
  ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let sum = 0;
  let nearBinaryPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += gray;
    if (gray < 35 || gray > 220) {
      nearBinaryPixels += 1;
    }
  }
  const pixelCount = data.length / 4;
  const average = sum / pixelCount;
  const nearBinaryRatio = nearBinaryPixels / pixelCount;
  const invert = average < 110;
  const threshold = invert ? 120 : 165;
  const shouldBinarize = nearBinaryRatio < 0.92;

  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (invert) {
      gray = 255 - gray;
    }
    gray = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
    const value = shouldBinarize ? (gray > threshold ? 255 : 0) : gray;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
