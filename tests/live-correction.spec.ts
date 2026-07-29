import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateLiveCorrectionEnvironment } from './helpers/load-private-env';
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
const environment = loadPrivateLiveCorrectionEnvironment(projectRoot);

test('real YouTube captions reach API correction, UI, CorrectionDB and History', async ({}, testInfo) => {
  test.setTimeout(360000);
  expect(environment.correctionStreaming).toBe(true);
  const session = await launchLiveExtension(testInfo, environment);

  try {
    const video = await openApprovedCaptionedVideo(session, 3);
    await video.page.getByRole('button', { name: /Düzelt/ }).click();
    const completionMessage = video.page.getByText(/Düzeltme tamamlandı/);
    const errorMessage = video.page.locator('.bg-red-100').last();
    const terminalState = await Promise.race([
      completionMessage.waitFor({ state: 'visible', timeout: 240000 })
        .then(() => 'completed' as const),
      errorMessage.waitFor({ state: 'visible', timeout: 240000 })
        .then(() => 'failed' as const)
    ]);
    if (terminalState === 'failed') {
      throw new Error(
        `Live correction failed: ${(await errorMessage.textContent())?.trim()}`
      );
    }
    await expect(completionMessage).toBeVisible();
    await expect(video.page.getByRole('option', {
      name: 'Orijinal + Düzeltilmiş'
    })).toBeAttached();

    const correctionRecord = await session.background.evaluate(
      async expectedVideoId => {
        const data = await chrome.storage.local.get(
          `corrected_transcript_${expectedVideoId}`
        );
        return data[`corrected_transcript_${expectedVideoId}`] || null;
      },
      video.videoId
    );
    expect(correctionRecord).toBeTruthy();
    expect(correctionRecord.sentences.length).toBeGreaterThan(0);
    expect(correctionRecord.sentences.every(
      (sentence: any) =>
        sentence.correctedTurkish && sentence.correctedEnglish
    )).toBe(true);

    const historyPage = await session.context.newPage();
    await historyPage.goto(
      `chrome-extension://${session.extensionId}/history.html?videoId=${video.videoId}`
    );
    await expect(historyPage.getByRole('button', {
      name: 'Düzeltilmiş Transkript'
    })).toBeVisible({ timeout: 15000 });
    await expect(historyPage.getByText('Kayıt bulunamadı.')).not.toBeVisible();

    assertNoApiKeyLeak(session);
    assertNoExtensionConsoleErrors(session);
    console.log(JSON.stringify({
      approvedVideoId: video.videoId,
      realTranscriptSegments: video.transcriptLength,
      streaming: true,
      apiResponseParsed: true,
      correctedSentenceCount: correctionRecord.sentences.length,
      correctionDbStored: true,
      historyVisible: true,
      apiKeyLogged: false
    }));
  } finally {
    await session.context.close();
  }
});
