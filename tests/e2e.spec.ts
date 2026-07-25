import { test, expect, chromium, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('YouTube AI Summary Extension e2e (Fixture based)', () => {
  let browserContext: BrowserContext;
  let page: Page;

  test.beforeAll(async () => {
    const extensionPath = path.resolve(__dirname, '../dist');
    
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  test.afterAll(async () => {
    await browserContext.close();
  });

  test('should render TranscriptTab correctly with fixture data', async () => {
    page = await browserContext.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.goto('http://localhost:3000/?v=dQw4w9WgXcQ');
    
    // Check if the button is injected
    const button = page.locator('#ai-summary-btn');
    await expect(button).toBeVisible({ timeout: 5000 });
    
    // Open the panel
    await button.click();
    
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
    
    await expect(page.locator('text=1 sonuç bulundu.')).toBeVisible();
    
    // Test exact match
    const exactMatchCheckbox = page.getByLabel('Tam İfade');
    await exactMatchCheckbox.check();
    
    await expect(page.locator('text=0 sonuç bulundu.')).toBeVisible();
    
    // Uncheck exact match
    await exactMatchCheckbox.uncheck();
    await expect(page.locator('text=1 sonuç bulundu.')).toBeVisible();
  });
});
