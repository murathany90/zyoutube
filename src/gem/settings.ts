/**
 * Gemini Gem Settings
 * Gem URL doğrulama ve ayar yönetimi.
 */
import { GemSettings, DEFAULT_GEM_SETTINGS, PanelSettings, DEFAULT_PANEL_SETTINGS } from './types';

const GEM_SETTINGS_KEY = 'gem_settings';
const PANEL_SETTINGS_KEY = 'panel_settings';
const MIGRATION_KEY = 'gem_migration_v1_done';

export class GemSettingsService {
  /**
   * Gem URL doğrulama
   * Yalnızca https://gemini.google.com/ origin kabul edilir.
   */
  static validateGemUrl(url: string): { valid: boolean; error?: string } {
    if (!url || url.trim() === '') {
      return { valid: false, error: 'Gem URL boş olamaz.' };
    }

    try {
      const parsed = new URL(url);

      // Tehlikeli şemalar
      if (['javascript:', 'data:', 'file:', 'blob:', 'ftp:'].includes(parsed.protocol)) {
        return { valid: false, error: 'Geçersiz URL şeması. Yalnızca https kabul edilir.' };
      }

      if (parsed.protocol !== 'https:') {
        return { valid: false, error: 'URL https olmalıdır.' };
      }

      if (parsed.hostname !== 'gemini.google.com') {
        return { valid: false, error: 'URL yalnızca gemini.google.com adresinden olabilir.' };
      }

      if (parsed.username || parsed.password) {
        return { valid: false, error: 'URL içinde kullanıcı adı veya parola bulunamaz.' };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: 'Geçersiz URL formatı.' };
    }
  }

  static async getGemSettings(): Promise<GemSettings> {
    if (typeof chrome === 'undefined' || !chrome.storage) return DEFAULT_GEM_SETTINGS;
    try {
      const data = await chrome.storage.local.get(GEM_SETTINGS_KEY);
      return { ...DEFAULT_GEM_SETTINGS, ...(data[GEM_SETTINGS_KEY] || {}) };
    } catch {
      return DEFAULT_GEM_SETTINGS;
    }
  }

  static async saveGemSettings(settings: GemSettings): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    await chrome.storage.local.set({ [GEM_SETTINGS_KEY]: settings });
  }

  static async getPanelSettings(): Promise<PanelSettings> {
    if (typeof chrome === 'undefined' || !chrome.storage) return DEFAULT_PANEL_SETTINGS;
    try {
      const data = await chrome.storage.local.get(PANEL_SETTINGS_KEY);
      return { ...DEFAULT_PANEL_SETTINGS, ...(data[PANEL_SETTINGS_KEY] || {}) };
    } catch {
      return DEFAULT_PANEL_SETTINGS;
    }
  }

  static async savePanelSettings(settings: PanelSettings): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) return;
    await chrome.storage.local.set({ [PANEL_SETTINGS_KEY]: settings });
  }

  /**
   * Eski Gemini API ayarlarından migration.
   * Tek sefer çalışır.
   */
  static async migrateFromGeminiApi(): Promise<{ migrated: boolean; message: string }> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      return { migrated: false, message: 'Storage mevcut değil.' };
    }

    try {
      const done = await chrome.storage.local.get(MIGRATION_KEY);
      if (done[MIGRATION_KEY]) {
        return { migrated: false, message: 'Migration zaten yapıldı.' };
      }

      const oldData = await chrome.storage.local.get('ai_summary_settings');
      const oldSettings = oldData['ai_summary_settings'];

      let message = 'Migration tamamlandı.';

      if (oldSettings?.providers?.['gemini-api']?.apiKey) {
        // Eski anahtarı silmek yerine kullanıcıya bildir.
        // Güvenlik için otomatik silmiyoruz.
        message = 'Eski Gemini API anahtarınız bulundu. Bu anahtar artık ana akışta kullanılmamaktadır. Popup > API sekmesinden eski anahtarınızı silebilirsiniz.';
      }

      if (oldSettings?.defaultProviderId === 'gemini-api') {
        // Varsayılan motoru gemini-gem olarak değiştir
        oldSettings.defaultProviderId = 'gemini-gem';
        await chrome.storage.local.set({ 'ai_summary_settings': oldSettings });
      }

      await chrome.storage.local.set({ [MIGRATION_KEY]: true });

      return { migrated: true, message };
    } catch (e) {
      return { migrated: false, message: 'Migration hatası: ' + String(e) };
    }
  }
}
