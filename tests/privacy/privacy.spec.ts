import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Privacy and Security Validation', () => {
  let context: BrowserContext;
  let page: Page;
  let extensionId: string;
  const SECRET_KEY = 'TEST_SECRET_DO_NOT_LEAK_12345';
  const consoleLogs: string[] = [];

  test.beforeAll(async () => {
    const extensionPath = path.join(__dirname, '../../dist');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    let [background] = context.serviceWorkers();
    if (!background)
      background = await context.waitForEvent('serviceworker');

    const extensionIdMatch = background.url().match(/chrome-extension:\/\/([^\/]+)\//);
    if (!extensionIdMatch) {
      throw new Error('Could not find extension ID');
    }
    extensionId = extensionIdMatch[1];

    // Ensure panelEnabled is true for tests
    await background.evaluate(() => new Promise<void>(resolve => {
      chrome.storage.local.set({ panelEnabled: true }, resolve);
    }));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    page = await context.newPage();
    page.on('console', msg => {
      consoleLogs.push(msg.text());
    });
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('API key should never be leaked in DOM, Console or IndexedDB', async () => {
    // 1. Setup - Open popup and set API key
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    await page.waitForSelector('text=ZYouTube Ayarları');
    
    // Choose API tab and enter API key
    await page.locator('button:has-text("API")').click();
    
    // There are 3 inputs in API tab: baseUrl, apiKey, model
    // We want the password one (API key)
    await page.locator('input[placeholder="https://api.deepseek.com/v1"]').fill('https://api.mymemory.translated.net/v1');
    await page.locator('input[type="password"]').first().fill(SECRET_KEY);
    await page.locator('button:has-text("Kaydet")').click();
    
    // Check it's saved by waiting for success message
    await expect(page.locator('text=Kaydedildi')).toBeVisible();

    // 2. Open YouTube page via route interception
    const fixtureHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>YouTube</title></head>
        <body>
          <div id="secondary"><div id="secondary-inner"></div></div>
          <div id="above-the-fold">
            <div id="top-level-buttons-computed" style="display:flex;"></div>
          </div>
          <script>
            window.ytInitialPlayerResponse = {
              videoDetails: { videoId: 'dQw4w9WgXcQ', lengthSeconds: '212' },
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [
                    { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ', languageCode: 'en', name: { simpleText: 'English' }, kind: 'asr', isTranslatable: true }
                  ]
                }
              }
            };
          </script>
        </body>
      </html>
    `;

    await page.route('https://www.youtube.com/watch?v=dQw4w9WgXcQ', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtml
      });
    });

    await context.route('https://www.youtube.com/api/timedtext*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'test transcript content' }] }
          ]
        })
      });
    });

    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // Panel should auto-open (no button click needed)
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    // Verify Shadow Root exists
    const hasShadowRoot = await panel.evaluate(el => Boolean(el.shadowRoot));
    expect(hasShadowRoot).toBe(true);

    // Give the injected panel a brief moment to finish initial effects before
    // checking the host page for accidental secret exposure.
    await page.waitForTimeout(500);

    // 3. Verify the API key is NOT present in the page content
    const pageContent = await page.content();
    expect(pageContent).not.toContain(SECRET_KEY);

    // 4. Verify the API key is NOT present in console logs
    const leakedInConsole = consoleLogs.some(log => log.includes(SECRET_KEY));
    expect(leakedInConsole).toBe(false);

    // 5. Open indexedDB and check for the secret
    const hasSecretInIndexedDB = await page.evaluate((secret) => {
      return new Promise((resolve) => {
        const request = indexedDB.open('ZYouTube');
        request.onerror = () => resolve(false);
        request.onsuccess = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('settings')) {
            resolve(false);
            return;
          }
          const tx = db.transaction('settings', 'readonly');
          const store = tx.objectStore('settings');
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const values = getAll.result;
            resolve(values.some((v: any) => 
              JSON.stringify(v).includes(secret)
            ));
          };
          getAll.onerror = () => resolve(false);
        };
      });
    }, SECRET_KEY);
    expect(hasSecretInIndexedDB).toBe(false);

    // 6. Verify no toggle button exists
    const toggleButton = page.locator('#zyoutube-toggle-button');
    await expect(toggleButton).not.toBeVisible();

    // 7. Verify only one panel
    const panelCount = await page.evaluate(() => document.querySelectorAll('#zyoutube-panel-host').length);
    expect(panelCount).toBe(1);
  });
});
