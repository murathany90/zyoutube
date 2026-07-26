import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('YouTube AI Summary Extension e2e (Fixture based)', () => {
  let browserContext: BrowserContext;
  let page: Page;
  let extensionId: string;

  test.beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../dist');
    
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    // Get extension ID
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }
    extensionId = background.url().split('/')[2];
    
    // Ensure panelEnabled is true for tests
    await background.evaluate(() => new Promise<void>(resolve => {
      chrome.storage.local.set({ panelEnabled: true }, resolve);
    }));
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  test('should render TranscriptTab correctly with fixture data', async () => {
    page = await browserContext.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    
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

    // Use browserContext.route so extension service worker fetch is also intercepted
    await browserContext.route('https://www.youtube.com/api/timedtext*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'hello this is a test' }] },
            { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'hello test second segment' }] }
          ]
        })
      });
    });

    await page.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    
    // Panel should auto-open (no button needed)
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    // Verify no toggle button in DOM
    const toggleButton = page.locator('#zyoutube-toggle-button');
    await expect(toggleButton).not.toBeVisible();
    
    // Verify Shadow Root exists
    const hasShadowRoot = await panel.evaluate(el => Boolean(el.shadowRoot));
    expect(hasShadowRoot).toBe(true);
    
    // Switch to Transcript tab
    const transcriptTabBtn = page.getByRole('button', { name: 'Transkript' });
    await expect(transcriptTabBtn).toBeVisible();
    await transcriptTabBtn.click();
    
    // Check if transcript fetched
    try {
      await expect(page.locator('text=hello this is a test')).toBeVisible({ timeout: 5000 });
    } catch (e) {
      console.log("HTML Dump:", await page.innerHTML('body'));
      throw e;
    }
    
    // Test search functionality
    const searchInput = page.getByPlaceholder('Transkriptte ara...');
    await searchInput.fill('hello test');
    
    await expect(page.locator('text=2 sonuç bulundu.')).toBeVisible();
    
    // Test exact match
    const exactMatchCheckbox = page.getByLabel('Tam İfade');
    await exactMatchCheckbox.check();
    
    await expect(page.locator('text=1 sonuç bulundu.')).toBeVisible();
    
    // Uncheck exact match
    await exactMatchCheckbox.uncheck();
    await expect(page.locator('text=2 sonuç bulundu.')).toBeVisible();

    // Verify only one panel
    const panels = await page.evaluate(() => document.querySelectorAll('#zyoutube-panel-host').length);
    expect(panels).toBe(1);
  });
});
