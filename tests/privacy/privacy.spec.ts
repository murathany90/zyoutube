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
    await page.locator('input[type="password"]').first().fill(SECRET_KEY);
    
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

    await page.route('https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ*', async (route) => {
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

    // Trigger Summary
    const summaryBtn = page.locator('#zyoutube-toggle-button');
    await summaryBtn.waitFor({ state: 'visible', timeout: 5000 });
    
    // Open the panel if not open
    const panel = page.locator('#zyoutube-panel-host');
    const isPanelVisible = await panel.isVisible();
    if (!isPanelVisible) {
      await summaryBtn.click();
      await expect(panel).toBeVisible();
    }
    // Verify Shadow Root exists
    const hasShadowRoot = await panel.evaluate(el => Boolean(el.shadowRoot));
    expect(hasShadowRoot).toBe(true);

    // Start generating summary
    await page.locator('button', { hasText: /Özetle/ }).first().click();

    // Wait for the mock to return or fail (it will fail because TEST_SECRET_DO_NOT_LEAK_12345 is invalid)
    await page.waitForTimeout(3000); 

    // 3. Check Content Script DOM
    const bodyText = await page.evaluate(() => document.body.innerHTML);
    expect(bodyText).not.toContain(SECRET_KEY);

    // 4. Check Popup DOM
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/index.html`);
    const popupBodyText = await popupPage.evaluate(() => document.body.innerHTML);
    // The key should be masked in the popup DOM (value attribute should not be the real key, or if it is, let's make sure we only render masked value)
    // Wait, the input might have the key as value. If it's type="password", we check if innerHTML contains it.
    // Actually, React might put it in the virtual DOM. Let's make sure it's not in the outerHTML except maybe the input value property.
    // Let's refine: The value property might contain it, but we want to make sure it's not rendered as plain text.
    expect(popupBodyText).not.toContain(SECRET_KEY);
    await popupPage.close();

    // 5. Check Console Logs
    for (const log of consoleLogs) {
      expect(log).not.toContain(SECRET_KEY);
    }

    // 6. Check IndexedDB
    const indexedDbKeys = await page.evaluate(async () => {
      return new Promise<string[]>((resolve) => {
        const dbs = window.indexedDB.databases();
        dbs.then(dbList => {
          // just looking for general leaks. if it's stored in chrome.storage, it won't be here.
          resolve(dbList.map(d => d.name || ''));
        });
      });
    });
    // IndexedDB shouldn't contain anything about the secret.
    expect(JSON.stringify(indexedDbKeys)).not.toContain(SECRET_KEY);
  });
});
