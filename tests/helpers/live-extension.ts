import { chromium, expect, type BrowserContext, type Page, type TestInfo, type Worker } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LiveCorrectionEnvironment } from './load-private-env';

export const APPROVED_LIVE_VIDEOS = [
  'https://www.youtube.com/watch?v=yoYTTMBuptY',
  'https://www.youtube.com/watch?v=l7uS03e7Xug',
  'https://www.youtube.com/watch?v=jjfc9yFbPqg',
  'https://www.youtube.com/watch?v=VGeYo5hzt8U&t=301s'
] as const;

export interface LiveExtensionSession {
  context: BrowserContext;
  background: Worker;
  extensionId: string;
  observedLogs: string[];
  observedExtensionErrors: string[];
  environment: LiveCorrectionEnvironment;
}

interface LiveExtensionLaunchOptions {
  userDataDir?: string;
  channel?: 'chrome';
  gemUrl?: string;
}

async function prepareLiveExtension(
  outputPath: string,
  environment: LiveCorrectionEnvironment
): Promise<string> {
  const projectRoot = path.resolve(import.meta.dirname, '../..');
  const sourceExtension = path.join(projectRoot, 'dist');
  const liveExtension = path.join(outputPath, 'extension');
  await fs.cp(sourceExtension, liveExtension, { recursive: true });

  const manifestPath = path.join(liveExtension, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const apiOrigin = `${new URL(environment.baseUrl).origin}/*`;
  manifest.host_permissions = Array.from(new Set([
    ...(manifest.host_permissions || []),
    apiOrigin
  ]));
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return liveExtension;
}

const observedPages = new WeakSet<Page>();

function observePage(
  page: Page,
  logs: string[],
  extensionErrors: string[]
) {
  if (observedPages.has(page)) return;
  observedPages.add(page);

  page.on('console', message => {
    const text = message.text();
    logs.push(text);
    const sourceUrl = message.location().url || '';
    if (
      message.type() === 'error' &&
      (
        sourceUrl.startsWith('chrome-extension://') ||
        /ZYouTube|\[Transcript\]/.test(text)
      )
    ) {
      extensionErrors.push(text);
    }
  });
  page.on('pageerror', error => {
    logs.push(error.message);
    if (
      /chrome-extension:|ZYouTube|\[Transcript\]/.test(
        `${error.message}\n${error.stack || ''}`
      )
    ) {
      extensionErrors.push(error.message);
    }
  });
}

export async function launchLiveExtension(
  testInfo: TestInfo,
  environment: LiveCorrectionEnvironment,
  options: LiveExtensionLaunchOptions = {}
): Promise<LiveExtensionSession> {
  const extensionPath = await prepareLiveExtension(
    testInfo.outputPath('live-extension'),
    environment
  );
  const observedLogs: string[] = [];
  const observedExtensionErrors: string[] = [];
  const context = await chromium.launchPersistentContext(
    options.userDataDir ||
      environment.liveUserDataDir ||
      testInfo.outputPath('chromium-profile'),
    {
      headless: false,
      ...(options.channel ? { channel: options.channel } : {}),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    }
  );
  context.on('page', page => observePage(
    page,
    observedLogs,
    observedExtensionErrors
  ));

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');
  background.on('console', message => {
    observedLogs.push(message.text());
    if (message.type() === 'error') {
      observedExtensionErrors.push(message.text());
    }
  });
  background.on('pageerror', error => {
    observedLogs.push(error.message);
    observedExtensionErrors.push(error.message);
  });

  const providerConfig = {
    id: 'openai-compatible',
    baseUrl: environment.baseUrl,
    model: environment.model,
    apiKey: undefined,
    isSessionStorage: true,
    temperature: 0.1,
    timeoutMs: 240000,
    summaryFirstByteTimeoutMs: 60000,
    summaryStreamIdleTimeoutMs: 45000,
    maxTokens: environment.summaryMaxTokens,
    summaryTokenParam: environment.summaryTokenParam,
    summaryStreaming: environment.summaryStreaming,
    summaryStreamOptions: environment.summaryStreamOptions,
    summaryJsonMode: environment.summaryJsonMode,
    correctionTimeoutMs: 240000,
    correctionFirstByteTimeoutMs: 60000,
    correctionStreamIdleTimeoutMs: 45000,
    correctionMaxTokens: environment.correctionMaxTokens,
    correctionTokenParam: environment.correctionTokenParam,
    correctionStreaming: environment.correctionStreaming,
    correctionStreamOptions: environment.correctionStreamOptions,
    correctionJsonMode: environment.correctionJsonMode,
    correctionEnableReasoning: false,
    correctionCompatibilityVersion: 3
  };

  await background.evaluate(async ({ config, apiKey, gemUrl }) => {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({
      panelEnabled: true,
      ai_summary_settings: {
        defaultEngine: 'openai-compatible',
        defaultLength: 'short',
        defaultLanguage: 'tr',
        playTimestampOnClick: true,
        providers: {
          'openai-compatible': config,
          'chrome-local': { id: 'chrome-local' }
        }
      },
      ...(gemUrl ? {
        gem_settings: {
          gemUrl,
          tryBackgroundTab: true,
          fallbackToVisibleTab: true,
          autoCloseTab: true,
          newChatPerVideo: true,
          copyToClipboard: false,
          chunkLongTranscripts: false,
          responseTimeoutMs: 240000
        }
      } : {})
    });
    await chrome.storage.session.set({
      'ai_key_session_openai-compatible': apiKey
    });
  }, {
    config: providerConfig,
    apiKey: environment.apiKey,
    gemUrl: options.gemUrl
  });

  const runtimeKeyMatched = await background.evaluate(async expectedKey => {
    const stored = await chrome.storage.session.get(
      'ai_key_session_openai-compatible'
    );
    return stored['ai_key_session_openai-compatible'] === expectedKey;
  }, environment.apiKey);
  expect(runtimeKeyMatched).toBe(true);

  return {
    context,
    background,
    extensionId: new URL(background.url()).hostname,
    observedLogs,
    observedExtensionErrors,
    environment
  };
}

export async function openApprovedCaptionedVideo(
  session: LiveExtensionSession,
  preferredIndex: number
): Promise<{
  page: Page;
  videoId: string;
  url: string;
  title: string;
  transcriptLength: number;
}> {
  const orderedUrls = [
    APPROVED_LIVE_VIDEOS[preferredIndex],
    ...APPROVED_LIVE_VIDEOS.filter((_, index) => index !== preferredIndex)
  ];
  const diagnostics: string[] = [];

  for (const url of orderedUrls) {
    const videoId = new URL(url).searchParams.get('v')!;
    const page = await session.context.newPage();
    observePage(
      page,
      session.observedLogs,
      session.observedExtensionErrors
    );

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 90000
      });
      if (!page.url().includes('youtube.com/watch')) {
        throw new Error(`unexpectedPage=${new URL(page.url()).hostname}`);
      }
      await expect(page.locator('#zyoutube-panel-host')).toBeVisible({
        timeout: 30000
      });

      await expect.poll(async () => {
        return session.background.evaluate(async expectedVideoId => {
          const data = await chrome.storage.local.get('zyoutube_history');
          const history = data.zyoutube_history || [];
          const entry = history.find(
            (item: any) => item.videoId === expectedVideoId
          );
          return entry?.transcript?.length || 0;
        }, videoId);
      }, {
        timeout: 45000,
        intervals: [1000, 2000, 5000]
      }).toBeGreaterThan(0);

      const entry = await session.background.evaluate(
        async expectedVideoId => {
          const data = await chrome.storage.local.get('zyoutube_history');
          return (data.zyoutube_history || []).find(
            (item: any) => item.videoId === expectedVideoId
          );
        },
        videoId
      );

      return {
        page,
        videoId,
        url,
        title: entry.title,
        transcriptLength: entry.transcript.length
      };
    } catch (error: any) {
      diagnostics.push(`${videoId}:${error?.message || error?.name || 'failed'}`);
      await page.close();
    }
  }

  throw new Error(
    `Approved videos did not yield a real caption transcript. ` +
    `If anonymous YouTube returns empty caption bodies, set ` +
    `ZYOUTUBE_LIVE_USER_DATA_DIR to a signed-in dedicated Chrome profile. ` +
    diagnostics.join('; ')
  );
}

export function assertNoApiKeyLeak(session: LiveExtensionSession) {
  expect(session.observedLogs.join('\n')).not.toContain(
    session.environment.apiKey
  );
}

export function assertNoExtensionConsoleErrors(
  session: LiveExtensionSession
) {
  expect(session.observedExtensionErrors).toEqual([]);
}
