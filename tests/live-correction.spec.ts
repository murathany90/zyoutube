import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateLiveCorrectionEnvironment } from './helpers/load-private-env';

const currentFile = fileURLToPath(import.meta.url);
const testsDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(testsDirectory, '..');
const liveEnvironment = loadPrivateLiveCorrectionEnvironment(projectRoot);

async function prepareLiveExtension(testOutputPath: string): Promise<string> {
  const sourceExtension = path.resolve(projectRoot, 'dist');
  const liveExtension = path.resolve(testOutputPath, 'extension');
  await fs.cp(sourceExtension, liveExtension, { recursive: true });

  const manifestPath = path.join(liveExtension, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const apiOriginPattern = `${new URL(liveEnvironment.baseUrl).origin}/*`;
  manifest.host_permissions = Array.from(new Set([
    ...(manifest.host_permissions || []),
    apiOriginPattern
  ]));
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return liveExtension;
}

function fixtureHtml(): string {
  return `<!DOCTYPE html>
    <html>
      <head><title>Live Correction Fixture - YouTube</title></head>
      <body>
        <div id="secondary"><div id="secondary-inner"></div></div>
        <div id="above-the-fold">
          <div id="top-level-buttons-computed" style="display:flex;"></div>
        </div>
        <div id="movie_player"></div>
        <script>
          const captionBase = 'https://www.youtube.com/api/timedtext?v=liveCorrectionVideo&lang=en';
          const captionTracks = [{
            baseUrl: captionBase,
            languageCode: 'en',
            name: { simpleText: 'English' },
            kind: 'asr',
            isTranslatable: true
          }];
          const playerResponse = {
            videoDetails: { videoId: 'liveCorrectionVideo', lengthSeconds: '4' },
            captions: {
              playerCaptionsTracklistRenderer: {
                captionTracks,
                translationLanguages: [{ languageCode: 'tr', languageName: { simpleText: 'Turkish' } }]
              }
            }
          };
          window.ytInitialPlayerResponse = playerResponse;
          const player = document.getElementById('movie_player');
          player.getPlayerResponse = () => playerResponse;
          player.getOption = (_namespace, key) => {
            if (key === 'tracklist') return captionTracks;
            if (key === 'translationLanguages') return [{ languageCode: 'tr' }];
            return null;
          };
          player.toggleSubtitlesOn = () => undefined;
          player.setOption = (_namespace, key, track) => {
            if (key !== 'track' || !track || !track.languageCode) return;
            const target = track.translationLanguage?.languageCode;
            const url = captionBase + (target ? '&tlang=' + encodeURIComponent(target) : '');
            fetch(url).catch(() => undefined);
          };
        </script>
      </body>
    </html>`;
}

test('real API correction reaches parser, UI, CorrectionDB and History', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const extensionPath = await prepareLiveExtension(testInfo.outputPath('live-extension'));
  let browserContext: BrowserContext | undefined;
  const observedLogs: string[] = [];

  try {
    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });

    browserContext.on('page', (openedPage) => {
      openedPage.on('console', (message) => observedLogs.push(message.text()));
      openedPage.on('pageerror', (error) => observedLogs.push(error.message));
    });

    let [background] = browserContext.serviceWorkers();
    if (!background) {
      background = await browserContext.waitForEvent('serviceworker');
    }
    background.on('console', (message) => observedLogs.push(message.text()));
    background.on('pageerror', (error) => observedLogs.push(error.message));

    const extensionId = new URL(background.url()).hostname;
    const providerConfig = {
      id: 'openai-compatible',
      baseUrl: liveEnvironment.baseUrl,
      model: liveEnvironment.model,
      apiKey: undefined,
      isSessionStorage: true,
      temperature: 0.1,
      correctionTimeoutMs: 240_000,
      correctionMaxTokens: liveEnvironment.correctionMaxTokens,
      correctionTokenParam: liveEnvironment.correctionTokenParam,
      correctionStreaming: liveEnvironment.correctionStreaming,
      correctionStreamOptions: liveEnvironment.correctionStreamOptions,
      correctionJsonMode: liveEnvironment.correctionJsonMode,
      correctionEnableReasoning: false
    };

    await background.evaluate(async ({ config, apiKey }) => {
      await chrome.storage.local.set({
        panelEnabled: true,
        ai_summary_settings: {
          defaultEngine: 'openai-compatible',
          defaultLength: 'standard',
          defaultLanguage: 'tr-en',
          playTimestampOnClick: true,
          providers: {
            'openai-compatible': config,
            'chrome-local': { id: 'chrome-local' }
          }
        }
      });
      await chrome.storage.session.set({
        'ai_key_session_openai-compatible': apiKey
      });
    }, {
      config: providerConfig,
      apiKey: liveEnvironment.apiKey
    });

    const runtimeKeyMatchesEnv = await background.evaluate(async (expectedKey) => {
      const value = await chrome.storage.session.get('ai_key_session_openai-compatible');
      return value['ai_key_session_openai-compatible'] === expectedKey;
    }, liveEnvironment.apiKey);
    expect(runtimeKeyMatchesEnv).toBe(true);

    await browserContext.route(
      'https://www.youtube.com/watch?v=liveCorrectionVideo',
      (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: fixtureHtml()
      })
    );
    await browserContext.route('https://www.youtube.com/api/timedtext*', (route) => {
      const requestUrl = new URL(route.request().url());
      const translated = requestUrl.searchParams.get('tlang') === 'tr';
      const body = translated
        ? '<?xml version="1.0"?><transcript><text start="0" dur="2">Merhaba dünya.</text><text start="2" dur="2">Bu gerçek bir API testidir.</text></transcript>'
        : '<?xml version="1.0"?><transcript><text start="0" dur="2">Hello world.</text><text start="2" dur="2">This is a real API test.</text></transcript>';
      return route.fulfill({ status: 200, contentType: 'text/xml', body });
    });
    await browserContext.route('https://i.ytimg.com/**', (route) => route.abort());

    const youtubePage = await browserContext.newPage();
    youtubePage.on('console', (message) => observedLogs.push(message.text()));
    youtubePage.on('pageerror', (error) => observedLogs.push(error.message));
    await youtubePage.goto('https://www.youtube.com/watch?v=liveCorrectionVideo');

    await expect(youtubePage.locator('#zyoutube-panel-host')).toBeVisible({ timeout: 15_000 });
    await youtubePage.getByRole('button', { name: 'Transkript' }).click();
    await expect(youtubePage.getByText('Merhaba dünya.')).toBeVisible({ timeout: 15_000 });

    const languageSelector = youtubePage.locator('select').filter({
      has: youtubePage.locator('option[value="both"]')
    });
    await languageSelector.selectOption('both');
    await expect(youtubePage.getByText('Hello world.')).toBeVisible({ timeout: 30_000 });

    await youtubePage.getByRole('button', { name: /Düzelt/ }).click();
    await expect(youtubePage.getByText(/Düzeltme tamamlandı/)).toBeVisible({
      timeout: 240_000
    });
    await expect(youtubePage.getByRole('option', { name: 'Orijinal + Düzeltilmiş' })).toBeAttached();

    const correctionRecord = await background.evaluate(async () => {
      const data = await chrome.storage.local.get(
        'corrected_transcript_liveCorrectionVideo'
      );
      return data.corrected_transcript_liveCorrectionVideo || null;
    });
    expect(correctionRecord).toBeTruthy();
    expect(correctionRecord.sentences.length).toBeGreaterThan(0);
    expect(correctionRecord.sentences.every(
      (sentence: any) => sentence.correctedTurkish && sentence.correctedEnglish
    )).toBe(true);

    const historyPage = await browserContext.newPage();
    historyPage.on('console', (message) => observedLogs.push(message.text()));
    historyPage.on('pageerror', (error) => observedLogs.push(error.message));
    await historyPage.goto(
      `chrome-extension://${extensionId}/history.html?videoId=liveCorrectionVideo`
    );
    await expect(historyPage.getByRole('button', {
      name: 'Düzeltilmiş Transkript'
    })).toBeVisible({ timeout: 15_000 });
    await expect(historyPage.getByText('Kayıt bulunamadı.')).not.toBeVisible();

    expect(observedLogs.join('\n')).not.toContain(liveEnvironment.apiKey);
    console.log(JSON.stringify({
      envLoaded: true,
      runtimeKeyMatched: runtimeKeyMatchesEnv,
      apiResponseParsed: true,
      correctedSentenceCount: correctionRecord.sentences.length,
      correctionDbStored: true,
      historyVisible: true,
      apiKeyLogged: false
    }));
  } catch (error) {
    const sanitizedLogs = observedLogs
      .map((entry) => entry.split(liveEnvironment.apiKey).join('<redacted>'))
      .slice(-100);
    console.error(`[live-correction diagnostics]\n${sanitizedLogs.join('\n')}`);
    throw error;
  } finally {
    await browserContext?.close();
  }
});
