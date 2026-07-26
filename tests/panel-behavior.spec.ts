import { test, expect, chromium, BrowserContext, Page, ServiceWorker } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Panel Davranış Testleri', () => {
  let browserContext: BrowserContext;
  let page: Page;
  let extensionId: string;
  let worker: ServiceWorker;

  const fixtureHtml = (videoId: string) => `
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
            videoDetails: { videoId: '${videoId}', lengthSeconds: '212' },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks: [
                  { baseUrl: 'https://www.youtube.com/api/timedtext?v=${videoId}', languageCode: 'en', name: { simpleText: 'English' }, kind: 'asr', isTranslatable: true }
                ]
              }
            }
          };
        </script>
      </body>
    </html>
  `;

  test.beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../dist');
    
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });

    let [bg] = browserContext.serviceWorkers();
    if (!bg) {
      bg = await browserContext.waitForEvent('serviceworker');
    }
    worker = bg;
    extensionId = worker.url().split('/')[2];
    
    await worker.evaluate(() => new Promise<void>(resolve => {
      chrome.storage.local.set({ panelEnabled: true }, resolve);
    }));
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  test.beforeEach(async () => {
    page = await browserContext.newPage();
  });

  test.afterEach(async () => {
    await page.close();
  });

  async function setupPage(videoId: string = 'testVideo123') {
    await page.route(`https://www.youtube.com/watch?v=${videoId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtml(videoId)
      });
    });

    await browserContext.route('https://www.youtube.com/api/timedtext*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'test transcript' }] }
          ]
        })
      });
    });

    await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
  }

  async function setPanelEnabled(enabled: boolean) {
    await worker.evaluate((value: boolean) => {
      return new Promise<void>(resolve => {
        chrome.storage.local.set({ panelEnabled: value }, resolve);
      });
    }, enabled);
  }

  // --- Test 1: First install — panel auto-opens ---
  test('İlk kurulumda panel otomatik açık', async () => {
    await setupPage('videoAutoOpen');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    const hasShadowRoot = await panel.evaluate(el => Boolean(el.shadowRoot));
    expect(hasShadowRoot).toBe(true);
  });

  // --- Test 2: No toggle button in DOM ---
  test('Video altında eklenti ikonu yok', async () => {
    await setupPage('videoNoButton');
    
    await page.waitForTimeout(2000);

    const toggleButton = page.locator('#zyoutube-toggle-button');
    await expect(toggleButton).not.toBeVisible();
    
    const toggleStyles = await page.evaluate(() => !!document.getElementById('zyoutube-toggle-styles'));
    expect(toggleStyles).toBe(false);
  });

  // --- Test 3: Popup toggle kapatınca panel kaldırılıyor ---
  test('Popup toggle kapatınca panel kaldırılıyor', async () => {
    await setupPage('videoToggleOff');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    // Set panelEnabled to false via storage — content script will react via storage.onChanged
    await setPanelEnabled(false);

    await expect(panel).not.toBeVisible({ timeout: 5000 });
  });

  // --- Test 4: Toggle açınca panel geri geliyor ---
  test('Toggle açınca panel geri geliyor', async () => {
    await setPanelEnabled(false);
    
    await setupPage('videoToggleOn');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).not.toBeVisible({ timeout: 5000 });
    
    await setPanelEnabled(true);

    await expect(panel).toBeVisible({ timeout: 5000 });
  });

  // --- Test 5: SPA video geçişinde panel açık kalıyor ---
  test('SPA video geçişinde panel açık kalıyor', async () => {
    await setupPage('firstVideo');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    // Send YOUTUBE_URL_CHANGED via background worker (as the real background would)
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://*.youtube.com/*' }));
    if (tabs.length > 0 && tabs[0].id) {
      await worker.evaluate((tabId) => {
        chrome.tabs.sendMessage(tabId, { type: 'YOUTUBE_URL_CHANGED', url: 'https://www.youtube.com/watch?v=secondVideo' }).catch(() => {});
      }, tabs[0].id);
    }
    
    await page.waitForTimeout(1000);
    
    await expect(panel).toBeVisible({ timeout: 5000 });
    
    const panelCount = await page.evaluate(() => document.querySelectorAll('#zyoutube-panel-host').length);
    expect(panelCount).toBe(1);
  });

  // --- Test 6: Çift panel oluşmuyor ---
  test('Çift panel oluşmuyor', async () => {
    await setupPage('singlePanelCheck');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    // Send YOUTUBE_URL_CHANGED multiple times via background worker
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: 'https://*.youtube.com/*' }));
    if (tabs.length > 0 && tabs[0].id) {
      const tabId = tabs[0].id;
      for (let i = 0; i < 3; i++) {
        await worker.evaluate(({ id, url }: { id: number; url: string }) => {
          chrome.tabs.sendMessage(id, { type: 'YOUTUBE_URL_CHANGED', url }).catch(() => {});
        }, { id: tabId, url: 'https://www.youtube.com/watch?v=singlePanelCheck' });
      }
    }
    
    await page.waitForTimeout(1500);
    
    const panelCount = await page.evaluate(() => document.querySelectorAll('#zyoutube-panel-host').length);
    expect(panelCount).toBe(1);
  });

  // --- Test 7: Panel #secondary içinde, video altında değil ---
  test('Panel sağ sütunda, video altında değil', async () => {
    await setupPage('positionCheck');
    
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    
    const inSecondary = await page.evaluate(() => {
      const el = document.getElementById('zyoutube-panel-host');
      if (!el) return false;
      const parent = el.parentElement;
      return parent?.id === 'secondary' || parent?.id === 'secondary-inner';
    });
    expect(inSecondary).toBe(true);
    
    const inActionsRow = await page.evaluate(() => {
      const el = document.getElementById('zyoutube-panel-host');
      if (!el) return false;
      return !!el.closest('#above-the-fold, #top-level-buttons-computed, #actions-inner');
    });
    expect(inActionsRow).toBe(false);
  });
});
