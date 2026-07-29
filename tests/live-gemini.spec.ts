import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPrivateLiveCorrectionEnvironment,
  loadPrivateLiveGeminiEnvironment
} from './helpers/load-private-env';
import {
  assertNoExtensionConsoleErrors,
  assertNoApiKeyLeak,
  launchLiveExtension,
  openApprovedCaptionedVideo
} from './helpers/live-extension';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

test('real Gemini Web session uses one tab and persists the summary', async ({}, testInfo) => {
  test.setTimeout(360000);
  const apiEnvironment = loadPrivateLiveCorrectionEnvironment(projectRoot);
  const geminiEnvironment = loadPrivateLiveGeminiEnvironment(projectRoot);
  expect(
    apiEnvironment.liveUserDataDir,
    'ZYOUTUBE_LIVE_USER_DATA_DIR is required for the signed-in Gemini test.'
  ).toBeTruthy();
  const session = await launchLiveExtension(testInfo, apiEnvironment, {
    userDataDir: apiEnvironment.liveUserDataDir,
    gemUrl: geminiEnvironment.gemUrl
  });

  try {
    const geminiPage = await session.context.newPage();
    await geminiPage.goto(geminiEnvironment.gemUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    const needsLogin =
      geminiPage.url().includes('accounts.google.com') ||
      await geminiPage.locator(
        'input[type="email"], input[type="password"]'
      ).count() > 0;
    expect(needsLogin, 'GEMINI_SESSION_REQUIRED').toBe(false);

    const video = await openApprovedCaptionedVideo(session, 3);
    await video.page.getByRole('button', {
      name: 'Özet',
      exact: true
    }).click();
    const engineSelect = video.page.locator('select').filter({
      has: video.page.locator('option[value="gemini-gem"]')
    });
    await engineSelect.selectOption('gemini-gem');

    const geminiTabsBefore = session.context.pages().filter(
      page => page.url().startsWith('https://gemini.google.com/')
    ).length;
    expect(geminiTabsBefore).toBeGreaterThanOrEqual(1);

    await video.page.getByRole('button', {
      name: 'Gemini Gem ile Özetle'
    }).click();
    await expect(video.page.getByRole('button', {
      name: 'Yeniden Oluştur'
    })).toBeVisible({ timeout: 300000 });

    const geminiTabsAfter = session.context.pages().filter(
      page => page.url().startsWith('https://gemini.google.com/')
    ).length;
    expect(geminiTabsAfter).toBe(geminiTabsBefore);
    expect(geminiPage.isClosed()).toBe(false);

    const stored = await session.background.evaluate(
      async expectedVideoId => {
        const data = await chrome.storage.local.get('zyoutube_history');
        return (data.zyoutube_history || []).find(
          (entry: any) => entry.videoId === expectedVideoId
        );
      },
      video.videoId
    );
    expect(stored.summary?.providerId).toBe('gemini-gem');
    expect(
      stored.summary?.summary?.tr || stored.summary?.summary?.en
    ).toBeTruthy();
    assertNoApiKeyLeak(session);
    assertNoExtensionConsoleErrors(session);

    console.log(JSON.stringify({
      approvedVideoId: video.videoId,
      realTranscriptSegments: video.transcriptLength,
      geminiSessionAuthenticated: true,
      geminiTabsBefore,
      geminiTabsAfter,
      summaryCardVisible: true,
      historyStored: true,
      apiKeyLogged: false
    }));
  } finally {
    await session.context.close();
  }
});
