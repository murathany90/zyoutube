import { ExtensionSettings, DEFAULT_SETTINGS, AIProviderConfig, AIProviderId } from './types';

export class AISettingsService {
  private static STORAGE_KEY = 'ai_summary_settings';
  private static SESSION_PREFIX = 'ai_key_session_';

  static async getSettings(): Promise<ExtensionSettings> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return DEFAULT_SETTINGS;
    }

    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const savedSettings = data[this.STORAGE_KEY] as Partial<ExtensionSettings> | undefined;

      if (!savedSettings) {
        return DEFAULT_SETTINGS;
      }

      // Merge defaults with saved
      const merged: ExtensionSettings = {
        ...DEFAULT_SETTINGS,
        ...savedSettings,
        providers: {
          ...DEFAULT_SETTINGS.providers
        }
      };

      // Migration: eski defaultProviderId varsa defaultEngine'e çevir
      if (!savedSettings.defaultEngine && savedSettings.defaultProviderId) {
        if (savedSettings.defaultProviderId === 'gemini-api') {
          merged.defaultEngine = 'gemini-gem';
        } else if (savedSettings.defaultProviderId === 'openai-compatible') {
          merged.defaultEngine = 'openai-compatible';
        } else if (savedSettings.defaultProviderId === 'chrome-local') {
          merged.defaultEngine = 'chrome-local';
        }
      }

      // Deep merge providers
      if (savedSettings.providers) {
        for (const [key, value] of Object.entries(savedSettings.providers)) {
          if (key === 'gemini-api') continue; // Eski Gemini API provider'ı atla
          
          if (key === 'openai-compatible' && value.timeoutMs === 30000) {
            value.timeoutMs = 180000;
          }

          merged.providers[key] = {
            ...DEFAULT_SETTINGS.providers[key],
            ...value
          };
        }
      }

      // Restore session keys
      for (const [key, provider] of Object.entries(merged.providers)) {
        if (provider.isSessionStorage) {
          const sessionData = await chrome.storage.session.get(this.SESSION_PREFIX + key);
          const sessionKey = sessionData[this.SESSION_PREFIX + key];
          if (sessionKey) {
            provider.apiKey = sessionKey;
          } else {
            provider.apiKey = undefined;
          }
        }
      }

      return merged;
    } catch (e) {
      console.error('Failed to get settings:', e);
      return DEFAULT_SETTINGS;
    }
  }

  static async saveSettings(settings: ExtensionSettings): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) return;

    try {
      const localSettings: ExtensionSettings = JSON.parse(JSON.stringify(settings));

      // Separate session keys
      for (const [key, provider] of Object.entries(localSettings.providers)) {
        if (provider.isSessionStorage && provider.apiKey) {
          await chrome.storage.session.set({ [this.SESSION_PREFIX + key]: provider.apiKey });
          provider.apiKey = undefined;
        } else if (!provider.isSessionStorage) {
          await chrome.storage.session.remove(this.SESSION_PREFIX + key);
        }
      }

      await chrome.storage.local.set({ [this.STORAGE_KEY]: localSettings });
    } catch (e) {
      console.error('Failed to save settings:', e);
      throw e;
    }
  }

  static async getProviderConfig(providerId: AIProviderId): Promise<AIProviderConfig> {
    const settings = await this.getSettings();
    return settings.providers[providerId] || DEFAULT_SETTINGS.providers[providerId];
  }
}
