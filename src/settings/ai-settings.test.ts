import { afterEach, describe, expect, it, vi } from 'vitest';
import { AISettingsService } from './ai-settings';

describe('AISettingsService correction compatibility migration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('eski aşırı token limitini düşürür ve streaming tercihini korur', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            ai_summary_settings: {
              providers: {
                'openai-compatible': {
                  id: 'openai-compatible',
                  correctionMaxTokens: 1_000_000,
                  correctionStreaming: true,
                  correctionStreamOptions: true
                }
              }
            }
          }),
          set: save
        },
        session: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    const settings = await AISettingsService.getSettings();
    const provider = settings.providers['openai-compatible'];

    expect(provider.correctionMaxTokens).toBe(16_384);
    expect(provider.correctionStreaming).toBe(true);
    expect(provider.correctionStreamOptions).toBe(true);
    expect(provider.correctionJsonMode).toBe(false);
    expect(provider.correctionCompatibilityVersion).toBe(3);
    expect(provider.summaryStreaming).toBe(true);
    expect(provider.summaryStreamOptions).toBe(true);
    expect(provider.summaryJsonMode).toBe(false);
    expect(provider.summaryCompatibilityVersion).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('eski özel ve makul token limitini korur', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            ai_summary_settings: {
              providers: {
                'openai-compatible': {
                  id: 'openai-compatible',
                  correctionMaxTokens: 8_192
                }
              }
            }
          }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        session: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    const settings = await AISettingsService.getSettings();
    expect(
      settings.providers['openai-compatible'].correctionMaxTokens
    ).toBe(8_192);
  });

  it('guncel summary uyumluluk tercihlerini korur', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            ai_summary_settings: {
              providers: {
                'openai-compatible': {
                  id: 'openai-compatible',
                  summaryCompatibilityVersion: 1,
                  summaryStreaming: false,
                  summaryStreamOptions: false,
                  summaryJsonMode: true
                }
              }
            }
          }),
          set: vi.fn().mockResolvedValue(undefined)
        },
        session: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    const settings = await AISettingsService.getSettings();
    const provider = settings.providers['openai-compatible'];

    expect(provider.summaryStreaming).toBe(false);
    expect(provider.summaryStreamOptions).toBe(false);
    expect(provider.summaryJsonMode).toBe(true);
  });

  it('kapanan content script contextinde storage hatasini loglamaz', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(
      () => undefined
    );
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn().mockRejectedValue(
            new Error('Access to storage is not allowed from this context.')
          )
        }
      }
    });

    const settings = await AISettingsService.getSettings();

    expect(settings.defaultEngine).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('kapanan contextte saveSettings storage hatasini loglamaz', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(
      () => undefined
    );
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: vi.fn().mockRejectedValue(
            new Error('Access to storage is not allowed from this context.')
          )
        },
        session: {
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined)
        }
      }
    });

    await expect(AISettingsService.saveSettings({
      defaultEngine: 'openai-compatible',
      defaultLength: 'short',
      defaultLanguage: 'tr',
      playTimestampOnClick: true,
      providers: {
        'openai-compatible': {
          id: 'openai-compatible',
          isSessionStorage: false
        },
        'chrome-local': { id: 'chrome-local' }
      }
    })).resolves.toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
