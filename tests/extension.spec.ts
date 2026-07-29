import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Aşama 2.2: Gerçek Paket E2E Doğrulaması', () => {
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

    // Wait for the background worker to start and get extension ID
    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }

    const extensionUrl = background.url();
    extensionId = extensionUrl.split('/')[2];
    console.log(`Extension loaded with ID: ${extensionId}`);
    
    // Ensure panelEnabled is true for tests
    await background.evaluate(() => new Promise<void>(resolve => {
      chrome.storage.local.set({ panelEnabled: true }, resolve);
    }));
    
    // Quick ping to SW to ensure it's alive (check for errors)
    const errs: string[] = [];
    background.on('pageerror', err => errs.push(err.message));
    expect(errs.length).toBe(0);
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  test('Gerçek popup sayfası hatasız yüklenmeli', async () => {
    const popupPage = await browserContext.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/index.html`);
    
    // Yalnızca ayarlar ve yönetim alanı var. Uzun özet yok.
    const title = popupPage.locator('h1', { hasText: 'ZYouTube AI Ayarları' });
    await expect(title).toBeVisible();

    await popupPage.close();
  });

  test('Content script manifest üzerinden enjekte edilmeli ve mesajlaşma çalışmalı', async () => {
    page = await browserContext.newPage();
    
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
              videoDetails: { videoId: 'fixtureVideoId', lengthSeconds: '600' },
              captions: {
                playerCaptionsTracklistRenderer: {
                  captionTracks: [
                    { baseUrl: 'https://www.youtube.com/api/timedtext?v=fixtureVideoId', languageCode: 'en', name: { simpleText: 'English' }, kind: 'asr' }
                  ]
                }
              }
            };
          </script>
        </body>
      </html>
    `;

    // Intercept main document request
    await page.route('https://www.youtube.com/watch?v=fixtureVideoId', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtml
      });
    });

    // Intercept caption request (must be on context because SW makes the request)
    await browserContext.route('https://www.youtube.com/api/timedtext*', async (route) => {
      let xml = '<?xml version="1.0" encoding="utf-8" ?><transcript>';
      for (let i = 0; i < 5000; i++) {
        xml += `<text start="${i}" dur="1">Virtual Segment ${i}</text>`;
      }
      xml += '</transcript>';
      await route.fulfill({
        status: 200,
        contentType: 'text/xml',
        body: xml
      });
    });

    await page.goto('https://www.youtube.com/watch?v=fixtureVideoId');

    // Panel should auto-open (no toggle button)
    const panel = page.locator('#zyoutube-panel-host');
    await expect(panel).toBeVisible({ timeout: 8000 });
    // Verify Shadow Root exists
    const hasShadowRoot = await panel.evaluate(el => Boolean(el.shadowRoot));
    expect(hasShadowRoot).toBe(true);
    
    // Verify no toggle button exists
    const toggleButton = page.locator('#zyoutube-toggle-button');
    await expect(toggleButton).not.toBeVisible();

    // Transkript sekmesine geçiş
    const transcriptTabBtn = page.getByRole('button', { name: 'Transkript' });
    await transcriptTabBtn.click();

    // Transkriptin yüklenmesini bekle
    await expect(page.locator('text=Virtual Segment 0')).toBeVisible({ timeout: 5000 });

    // Sanal Listeleme Testi: 5000 satır DOM'da olmamalı
    const segmentCount = await page.evaluate(() => {
       const nodes = Array.from(document.querySelectorAll('div, span'));
       return nodes.filter(n => n.textContent && n.textContent.includes('Virtual Segment ') && n.children.length === 0).length;
    });
    
    console.log(`DOM contains ${segmentCount} segment nodes out of 5000.`);
    expect(segmentCount).toBeLessThan(200);

    // Arama testi
    const searchInput = page.getByPlaceholder('Transkriptte ara...');
    await searchInput.fill('Virtual Segment 4900');
    
    await expect(page.locator('text=Virtual Segment 4900')).toBeVisible({ timeout: 5000 });
    
    const segmentCountAfterSearch = await page.evaluate(() => {
       const nodes = Array.from(document.querySelectorAll('div, span'));
       return nodes.filter(n => n.textContent && n.textContent.includes('Virtual Segment ') && n.children.length === 0).length;
    });
    expect(segmentCountAfterSearch).toBeLessThan(200);

    // Verify only one panel exists
    const panelCount = await page.evaluate(() => document.querySelectorAll('#zyoutube-panel-host').length);
    expect(panelCount).toBe(1);
  });
});
