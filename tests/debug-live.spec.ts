import { test, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Debug live transcript', async () => {
  const extensionPath = path.resolve(__dirname, '..', 'dist');
  
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--headless=new`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  
  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  background.on('console', msg => console.log('SW LOG:', msg.text()));
  
  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  page.on('request', req => {
    if (req.url().includes('timedtext')) {
      console.log('TIMEDTEXT REQ:', req.url());
    }
  });
  
  page.on('response', async res => {
    if (res.url().includes('timedtext')) {
      console.log('TIMEDTEXT RES:', res.status());
      try {
        const text = await res.text();
        console.log('TIMEDTEXT BODY LENGTH:', text.length);
        console.log('TIMEDTEXT BODY START:', text.substring(0, 100));
      } catch (e) {
        console.log('TIMEDTEXT BODY ERR:', e.message);
      }
    }
  });
  
  console.log('Navigating to YouTube...');
  await page.goto('https://www.youtube.com/watch?v=8jPQjjsBbIc', { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting 15 seconds...');
  await page.waitForTimeout(15000);
  
  const panel = page.locator('#zyoutube-panel-host');
  const count = await panel.count();
  console.log('Panel count:', count);
  
  const scrapeLog = await page.evaluate(() => (window as any).__zyoutube_scrape_log__ || []);
  console.log('Scrape Log:', scrapeLog);
  
  const html = await page.evaluate(() => {
    const panels = document.querySelectorAll('ytd-engagement-panel-section-list-renderer');
    for (const p of Array.from(panels)) {
       if (p.getAttribute('target-id') === 'engagement-panel-searchable-transcript' || 
           p.innerHTML.includes('segment')) {
           return p.innerHTML;
       }
    }
    return 'No transcript panel found';
  });
  const fs = require('fs');
  fs.writeFileSync(path.resolve(__dirname, '../docs/evidence/live-transcript/dom.html'), html);

  await page.waitForTimeout(5000);
      
  const segments = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.substring(0, 200);
  });
  console.log('Segments preview:', segments);

  await page.screenshot({ path: path.resolve(__dirname, '../docs/evidence/live-transcript/debug-live.png') });
  await context.close();
});
