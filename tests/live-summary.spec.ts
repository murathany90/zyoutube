import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPrivateLiveCorrectionEnvironment } from './helpers/load-private-env';
import {
  assertNoApiKeyLeak,
  launchLiveExtension,
  openApprovedCaptionedVideo
} from './helpers/live-extension';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const environment = loadPrivateLiveCorrectionEnvironment(projectRoot);

test('real YouTube captions persist transcript-only state and API summary through History', async ({}, testInfo) => {
  test.setTimeout(360000);
  expect(environment.summaryStreaming).toBe(false);
  const session = await launchLiveExtension(testInfo, environment);

  try {
    const video = await openApprovedCaptionedVideo(session, 1);

    const transcriptOnlyEntry = await session.background.evaluate(
      async expectedVideoId => {
        const data = await chrome.storage.local.get('zyoutube_history');
        return (data.zyoutube_history || []).find(
          (entry: any) => entry.videoId === expectedVideoId
        );
      },
      video.videoId
    );
    expect(transcriptOnlyEntry.transcript.length).toBeGreaterThan(0);
    expect(transcriptOnlyEntry.summary).toBeUndefined();

    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/index.html`);
    await popup.getByRole('button', { name: 'Özet Listesi' }).click();
    await expect(popup.getByText(video.title, { exact: false })).toBeVisible();
    await expect(popup.getByText('Transkript', { exact: true })).toBeVisible();
    await expect(popup.getByText('Özet oluşturulmamış')).toBeVisible();

    const transcriptDetail = await session.context.newPage();
    await transcriptDetail.goto(
      `chrome-extension://${session.extensionId}/history.html?videoId=${video.videoId}`
    );
    await expect(transcriptDetail.getByRole('button', {
      name: 'Özet Detayı'
    })).toBeEnabled();
    await expect(transcriptDetail.getByText(
      'Bu video için özet oluşturulmamış.'
    )).toBeVisible();
    await transcriptDetail.getByRole('button', {
      name: 'Orijinal Transkript'
    }).click();
    await expect(transcriptDetail.getByPlaceholder(
      'Transkript içinde ara...'
    )).toBeVisible();

    await video.page.getByRole('button', { name: 'Özet' }).click();
    const engineSelect = video.page.locator('select').filter({
      has: video.page.locator('option[value="openai-compatible"]')
    });
    await engineSelect.selectOption('openai-compatible');
    const languageSelect = video.page.locator('select').filter({
      has: video.page.locator('option[value="tr-en"]')
    });
    await languageSelect.selectOption('tr');
    await video.page.getByRole('button', { name: 'Şimdi Özetle' }).click();
    await expect(video.page.getByRole('button', {
      name: 'Yeniden Oluştur'
    })).toBeVisible({ timeout: 240000 });

    await expect.poll(async () => {
      return session.background.evaluate(async expectedVideoId => {
        const data = await chrome.storage.local.get('zyoutube_history');
        const entry = (data.zyoutube_history || []).find(
          (entry: any) => entry.videoId === expectedVideoId
        );
        return Boolean(entry?.summary?.summary?.tr);
      }, video.videoId);
    }, {
      timeout: 30000,
      intervals: [500, 1000, 2000]
    }).toBe(true);

    const stored = await session.background.evaluate(
      async expectedVideoId => {
        const data = await chrome.storage.local.get('zyoutube_history');
        return (data.zyoutube_history || []).find(
          (entry: any) => entry.videoId === expectedVideoId
        );
      },
      video.videoId
    );
    expect(stored.summary?.summary?.tr).toBeTruthy();
    expect(stored.transcript.length).toBeGreaterThan(0);
    const duplicateCount = await session.background.evaluate(
      async expectedVideoId => {
        const data = await chrome.storage.local.get('zyoutube_history');
        return (data.zyoutube_history || []).filter(
          (entry: any) => entry.videoId === expectedVideoId
        ).length;
      },
      video.videoId
    );
    expect(duplicateCount).toBe(1);

    await transcriptDetail.reload();
    await expect(transcriptDetail.getByText(
      'Bu video için özet oluşturulmamış.'
    )).not.toBeVisible();

    assertNoApiKeyLeak(session);
    console.log(JSON.stringify({
      approvedVideoId: video.videoId,
      realTranscriptSegments: video.transcriptLength,
      transcriptOnlyPopupVisible: true,
      transcriptOnlyDetailVisible: true,
      streaming: false,
      apiSummaryParsed: true,
      summaryCardVisible: true,
      historyStored: true,
      duplicateHistoryEntries: duplicateCount,
      apiKeyLogged: false
    }));
  } finally {
    await session.context.close();
  }
});
