import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = resolve(root, 'public', 'icons');
const source = await readFile(resolve(iconDir, 'zyoutube-ai.svg'), 'utf8');
const sizes = [16, 32, 48, 128];

await mkdir(iconDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
    });

    await page.setContent(`
      <style>
        html, body { margin: 0; width: 100%; height: 100%; background: transparent; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      ${source}
    `);

    await page.locator('svg').screenshot({
      path: resolve(iconDir, `zyoutube-ai-${size}.png`),
      omitBackground: true,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
