import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GemSettings } from './types';

const {
  getGemSettings,
  validateGemUrl,
  openGemTab,
  waitForTabLoad,
  maybeCloseTab
} = vi.hoisted(() => ({
  getGemSettings: vi.fn(),
  validateGemUrl: vi.fn(() => ({ valid: true })),
  openGemTab: vi.fn(),
  waitForTabLoad: vi.fn(),
  maybeCloseTab: vi.fn()
}));

vi.mock('./settings', () => ({
  GemSettingsService: {
    getGemSettings,
    validateGemUrl
  }
}));

vi.mock('./tab-manager', () => ({
  GemTabManager: {
    openGemTab,
    waitForTabLoad,
    maybeCloseTab
  }
}));

import { GemController, type GemSummaryRequest } from './controller';

function settings(): GemSettings {
  return {
    gemUrl: 'https://gemini.google.com/gem/test',
    tryBackgroundTab: true,
    fallbackToVisibleTab: true,
    autoCloseTab: true,
    newChatPerVideo: true,
    copyToClipboard: false,
    chunkLongTranscripts: false,
    responseTimeoutMs: 120000
  };
}

function request(taskId: string): GemSummaryRequest {
  return {
    taskId,
    videoId: 'video-1',
    videoTitle: 'Video',
    videoUrl: 'https://www.youtube.com/watch?v=video-1',
    segments: [{
      id: 's1',
      sequence: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      durationMs: 1000,
      text: 'Transcript',
      cleanText: 'Transcript',
      languageCode: 'en'
    }],
    languageCode: 'en',
    sourceType: 'manual',
    summaryLength: 'standard',
    outputLanguage: 'tr'
  };
}

describe('GemController task idempotency and fallback tab reuse', () => {
  const tabsSendMessage = vi.fn();
  const tabsUpdate = vi.fn();
  const tabsCreate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        sendMessage: tabsSendMessage,
        update: tabsUpdate,
        create: tabsCreate
      },
      scripting: {
        executeScript: vi.fn()
      }
    });
    getGemSettings.mockResolvedValue(settings());
    openGemTab.mockResolvedValue({ tabId: 7, isNew: false });
    waitForTabLoad.mockResolvedValue(true);
    maybeCloseTab.mockResolvedValue(undefined);
    tabsUpdate.mockResolvedValue({ id: 7 });
  });

  it('duplicate taskId shares one automation and one Gemini tab', async () => {
    tabsSendMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === 'GEM_AUTOMATION_PING') return { success: true };
      return {
        success: true,
        completed: true,
        text: 'Bu, tek Gemini sekmesinden dönen yeterince uzun ve kararlı bir özet yanıtıdır.'
      };
    });

    const first = GemController.summarize(request('duplicate-task'));
    const second = GemController.summarize(request('duplicate-task'));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(openGemTab).toHaveBeenCalledTimes(1);
    expect(
      tabsSendMessage.mock.calls.filter(([, message]) =>
        message.type === 'GEM_AUTOMATE'
      )
    ).toHaveLength(1);
  });

  it('automation fallback activates the selected tab instead of creating a second tab', async () => {
    tabsSendMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === 'GEM_AUTOMATION_PING') return { success: true };
      return { success: false, completed: false };
    });

    const result = await GemController.summarize(request('fallback-task'));

    expect(result.fallbackUsed).toBe(true);
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
  });
});
