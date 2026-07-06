import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public', 'tesseract');
const coreDir = join(publicDir, 'core');
const langDir = join(publicDir, 'lang-data');

function ensureCleanDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function copyRequired(source, target) {
  if (!existsSync(source)) {
    throw new Error(`Missing Tesseract asset: ${source}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function walk(dir, predicate, matches = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, predicate, matches);
    } else if (predicate(path)) {
      matches.push(path);
    }
  }
  return matches;
}

function packageRoot(packageName) {
  return dirname(require.resolve(`${packageName}/package.json`));
}

ensureCleanDir(publicDir);
mkdirSync(coreDir, { recursive: true });
mkdirSync(langDir, { recursive: true });

const tesseractRoot = packageRoot('tesseract.js');
const workerCandidates = [
  join(tesseractRoot, 'dist', 'worker.min.js'),
  join(tesseractRoot, 'dist', 'worker.min.mjs'),
];
const workerPath = workerCandidates.find((path) => existsSync(path));
if (!workerPath) {
  throw new Error('Unable to find tesseract.js worker script in node_modules/tesseract.js/dist');
}
copyRequired(workerPath, join(publicDir, 'worker.min.js'));

const coreRoot = packageRoot('tesseract.js-core');
const coreFiles = walk(coreRoot, (path) => /tesseract-core.*\.wasm(\.js)?$/.test(path));
if (coreFiles.length === 0) {
  throw new Error('Unable to find tesseract.js-core wasm assets');
}
for (const file of coreFiles) {
  copyRequired(file, join(coreDir, relative(coreRoot, file)));
}

const engRoot = packageRoot('@tesseract.js-data/eng');
const trainedData = walk(engRoot, (path) => path.endsWith('eng.traineddata.gz'))[0];
if (!trainedData) {
  throw new Error('Unable to find eng.traineddata.gz in @tesseract.js-data/eng');
}
copyRequired(trainedData, join(langDir, 'eng.traineddata.gz'));

console.log('Copied local Tesseract assets to public/tesseract');
