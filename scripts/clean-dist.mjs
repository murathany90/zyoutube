import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const distPath = path.resolve(projectRoot, 'dist');
const relativeDistPath = path.relative(projectRoot, distPath);

if (
  !relativeDistPath ||
  relativeDistPath.startsWith('..') ||
  path.isAbsolute(relativeDistPath)
) {
  throw new Error(`Refusing to clean unsafe dist path: ${distPath}`);
}

await rm(distPath, { recursive: true, force: true });
