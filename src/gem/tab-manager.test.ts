import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GemTabManager } from './tab-manager';
import type { GemSettings } from './types';

const settings: GemSettings = {
  gemUrl: 'https://gemini.google.com/gem/test',
  tryBackgroundTab: true,
  fallbackToVisibleTab: true,
  autoCloseTab: true,
  newChatPerVideo: true,
  copyToClipboard: false,
  chunkLongTranscripts: false,
  responseTimeoutMs: 120000
};

describe('GemTabManager ownership', () => {
  const tabsMock = {
    query: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', { tabs: tabsMock });
  });

  it('new-chat preference still reuses an existing Gemini tab', async () => {
    tabsMock.query.mockResolvedValue([{
      id: 7,
      url: 'https://gemini.google.com/gem/test',
      status: 'complete'
    }]);
    tabsMock.get.mockResolvedValue({
      id: 7,
      url: 'https://gemini.google.com/gem/test',
      status: 'complete'
    });
    tabsMock.update.mockResolvedValue({ id: 7 });

    await expect(
      GemTabManager.openGemTab(settings.gemUrl, settings)
    ).resolves.toEqual({ tabId: 7, isNew: false });

    expect(tabsMock.create).not.toHaveBeenCalled();
  });

  it('user-owned existing tab is never closed', async () => {
    await GemTabManager.maybeCloseTab(7, false, settings);
    expect(tabsMock.remove).not.toHaveBeenCalled();
  });

  it('extension-created tab closes only after successful ownership check', async () => {
    tabsMock.remove.mockResolvedValue(undefined);
    await GemTabManager.maybeCloseTab(8, true, settings);
    expect(tabsMock.remove).toHaveBeenCalledWith(8);
  });
});
