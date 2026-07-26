import { test, expect, chromium, BrowserContext } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EVIDENCE_DIR = path.resolve(__dirname, '../docs/evidence/live-transcript');
const CDP_PORT = 9222;

const TEST_VIDEOS = [
  { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', id: 'jNQXAC9IVRw', label: 'Me at the zoo (English)' },
  { url: 'https://www.youtube.com/watch?v=8dT2jCIplUU', id: '8dT2jCIplUU', label: 'Failing video' },
];

function getGitHead(): string {
  try { return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim(); } catch { return 'unknown'; }
}

interface VideoTestResult {
  videoUrl: string; videoId: string; label: string;
  title: string; segmentCount: number; first100Chars: string;
  panelFound: boolean; segmentsInDom: boolean;
  spinnerActive: boolean | null; usedExistingPage: boolean;
  extensionSwTargets: number;
  captionRequests: Array<{ url: string; status: number; bodyLength: number }>;
  scrapeLog: string[]; errors: string[];
}

test.describe('Live YouTube Transcript Test (Real Chrome via CDP)', () => {
  let ctx: BrowserContext;
  let cdpAvailable = false;
  const results: VideoTestResult[] = [];

  test.beforeAll(async () => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    try {
      const extensionPath = path.resolve(__dirname, '../dist');
      ctx = await chromium.launchPersistentContext('', {
        headless: false,
        args: [
          `--headless=new`,
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`
        ]
      });
      cdpAvailable = true;
      console.log(`Launched Chromium with extension. Existing pages: ${ctx.pages().length}`);
    } catch (e) {
      console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              SETUP INSTRUCTIONS (one-time)                          ║
║                                                                      ║
║ 1. Close all Chrome windows                                          ║
║ 2. Open PowerShell as admin and run:                                ║
║                                                                      ║
║    & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"      ║
║        --remote-debugging-port=9222                                 ║
║        --no-first-run                                               ║
║                                                                      ║
║ 3. In the Chrome window that opens:                                 ║
║    - Go to chrome://extensions                                      ║
║    - Enable Developer mode                                          ║
║    - Click "Load unpacked" → select the dist/ folder                ║
║    - Log into Google if needed                                      ║
║    - Open YouTube in a tab (required for test)                      ║
║ 4. Run this test again                                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);
    }
  });

  test.afterAll(async () => {
    if (!cdpAvailable) return;

    const sha = getGitHead();
    const reportPath = path.resolve(EVIDENCE_DIR, 'live-test-results-cdp.md');
    let report = `# Live YouTube Transcript Test Results (Real Chrome via CDP)\n\n`;
    report += `Date: ${new Date().toISOString()}\n`;
    report += `Git SHA: ${sha}\n`;
    report += `CDP: http://127.0.0.1:${CDP_PORT}\n\n`;

    for (const r of results) {
      report += `## ${r.label} (${r.videoId})\n\n`;
      report += `- **Title:** ${r.title}\n`;
      report += `- **Segment count:** ${r.segmentCount}\n`;
      report += `- **First 100 chars:** \`${r.first100Chars}\`\n`;
      report += `- **Panel found:** ${r.panelFound}\n`;
      report += `- **Used existing page:** ${r.usedExistingPage}\n`;
      report += `- **Segments in DOM:** ${r.segmentsInDom}\n`;
      report += `- **Spinner active:** ${r.spinnerActive}\n`;
      report += `- **Extension CDP targets:** ${r.extensionSwTargets}\n`;
      report += `- **Errors:** ${r.errors.length ? r.errors.join('; ') : 'None'}\n`;
      if (r.captionRequests.length > 0) {
        report += `- **Caption requests:**\n`;
        r.captionRequests.forEach(cr => report += `  - ${cr.status} / ${cr.bodyLength}B\n`);
      }
      if (r.scrapeLog.length > 0) {
        report += `- **Scrape log:**\n`;
        r.scrapeLog.forEach(l => report += `  - ${l}\n`);
      }
      report += '\n';
    }

    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`Report: ${reportPath}`);

    try { await ctx.close(); } catch {}
  });

  for (const video of TEST_VIDEOS) {
    test(`${video.label} (${video.id})`, async () => {
      test.skip(!cdpAvailable, 'Chrome CDP not available. See setup instructions above.');

      // Use an existing page if possible (content scripts inject in real tabs)
      let usedExistingPage = false;
      let page = ctx.pages().find(p => p.url().includes('youtube.com/watch'));
      if (!page) {
        page = ctx.pages()[0] || await ctx.newPage();
      } else {
        usedExistingPage = true;
      }

      const result: VideoTestResult = {
        videoUrl: video.url, videoId: video.id, label: video.label,
        title: '', segmentCount: 0, first100Chars: '',
        panelFound: false, segmentsInDom: false,
        spinnerActive: null, usedExistingPage,
        extensionSwTargets: 0,
        captionRequests: [], scrapeLog: [], errors: [],
      };

      const captionReqs: VideoTestResult['captionRequests'] = [];
      await page.route('**/api/timedtext**', async (route) => {
        const req = route.request();
        const resp = await route.fetch();
        const body = await resp.text();
        captionReqs.push({ url: req.url(), status: resp.status(), bodyLength: body.length });
        await route.fulfill({ response: resp });
      });

      await page.goto(video.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      console.log(`\n=== ${video.label} ===`);
      await page.waitForTimeout(5000);

      const panelHost = page.locator('#zyoutube-panel-host');
      const pc = await panelHost.count();
      result.panelFound = pc > 0;
      console.log(`Panel: ${result.panelFound}, Used existing page: ${usedExistingPage}`);

      if (result.panelFound) {
        for (let i = 0; i < 90; i++) {
          const sc = await page.evaluate(() => {
            const host = document.getElementById('zyoutube-panel-host');
            if (!host?.shadowRoot) return -1;
            const root = host.shadowRoot.getElementById('zyoutube-react-root');
            if (!root) return -1;
            const text = root.textContent || '';
            const matches = text.match(/\d+:\d{2}/g);
            return matches ? matches.length : 0;
          });
          if (sc > 0) { result.segmentCount = sc; break; }
          await page.waitForTimeout(500);
        }

        if (result.segmentCount > 0) {
          result.segmentsInDom = true;
          const firstSegments = await page.evaluate(() => {
            const host = document.getElementById('zyoutube-panel-host');
            if (!host?.shadowRoot) return [];
            const root = host.shadowRoot.getElementById('zyoutube-react-root');
            if (!root) return [];
            const divs = root.querySelectorAll('[class*="gap-2"] > div > div.flex-1');
            return Array.from(divs).slice(0, 3).map(el => el.textContent?.trim() || '');
          });
          result.first100Chars = firstSegments.join(' ').substring(0, 100);
        } else {
          result.spinnerActive = await page.evaluate(() => {
            const host = document.getElementById('zyoutube-panel-host');
            if (!host?.shadowRoot) return null;
            return !!host.shadowRoot.querySelector('[class*="animate-spin"]');
          }).catch(() => null);
        }
      } else {
        result.errors.push('Content script not injected');
      }

      try {
        result.scrapeLog = await page.evaluate(() => (window as any).__zyoutube_scrape_log__ || []);
      } catch {}

      try {
        const cdpSession = await page.context().newCDPSession(page);
        const targets = (await cdpSession.send('Target.getTargets')).targetInfos;
        result.extensionSwTargets = targets.filter(t => t.url?.startsWith('chrome-extension://')).length;
        console.log(`Extension CDP targets: ${result.extensionSwTargets}`);
      } catch {}

      result.captionRequests = captionReqs;
      try { result.title = await page.locator('h1.ytd-watch-metadata').textContent().catch(() => page.title()); }
      catch {}

      const ssPath = path.resolve(EVIDENCE_DIR, `${video.id}.png`);
      try { await page.screenshot({ path: ssPath, fullPage: false }); } catch {}

      console.log(`Segments: ${result.segmentCount}`);
      console.log(`First 100: "${result.first100Chars}"`);
      console.log(`Caption reqs: ${JSON.stringify(captionReqs)}`);
      if (result.errors.length) console.log(`Errors: ${result.errors.join('; ')}`);

      results.push(result);

      expect(result.segmentCount).toBeGreaterThan(0);
      expect(result.first100Chars.trim().length).toBeGreaterThanOrEqual(20);
    });
  }
});
