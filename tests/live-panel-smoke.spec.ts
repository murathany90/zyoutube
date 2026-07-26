import { test, expect, chromium, BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_VIDEOS = [
  { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', id: 'jNQXAC9IVRw', label: 'Me at the zoo (English)' },
  { url: 'https://www.youtube.com/watch?v=8jPQjjsBbIc', id: '8jPQjjsBbIc', label: 'Turkish content' },
  { url: 'https://www.youtube.com/watch?v=9bZkp7q19f0', id: '9bZkp7q19f0', label: 'Gangnam Style (auto captions)' },
];

function getGitHead(): string {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(); } catch { return 'unknown'; }
}

test.describe('Live Panel Smoke Test', () => {
  let browserContext: BrowserContext;

  test.beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../dist');
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const sw = browserContext.serviceWorkers[0] || await browserContext.waitForEvent('serviceworker', { timeout: 45000 });
    console.log('Extension loaded, ID:', sw.url().split('/')[2]);
    await sw.evaluate(() => new Promise<void>(resolve => chrome.storage.local.set({ panelEnabled: true }, resolve)));
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  for (const video of TEST_VIDEOS) {
    test(`Panel mounts: ${video.label} (${video.id})`, async () => {
      const page = await browserContext.newPage();
      await page.goto(video.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const panel = page.locator('#zyoutube-panel-host');
      await panel.waitFor({ state: 'attached', timeout: 45000 });
      const visible = await panel.isVisible();
      expect(visible).toBe(true);

      const title = await page.locator('h1.ytd-watch-metadata').textContent().catch(() => page.title());
      console.log(`  Title: ${title}`);
      console.log(`  Panel visible: ${visible}`);

      await page.close();
    });
  }
});
