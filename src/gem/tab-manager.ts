/**
 * Gemini Gem Tab Manager
 * Gemini sekmelerini bulma, açma ve yönetme.
 */
import { GemSettings, GemTabInfo } from './types';

export class GemTabManager {
  /**
   * Açık Gemini sekmelerini bul.
   */
  static async findGeminiTabs(): Promise<GemTabInfo[]> {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    return tabs
      .filter(t => t.id !== undefined)
      .map(t => ({
        tabId: t.id!,
        url: t.url || '',
        isGemPage: t.url?.includes('/gem/') || false,
      }));
  }

  /**
   * Belirtilen Gem URL'sine sahip mevcut sekmeyi bul.
   */
  static async findMatchingGemTab(gemUrl: string): Promise<GemTabInfo | null> {
    const tabs = await this.findGeminiTabs();
    // Aynı Gem URL'ye sahip sekmeyi ara
    for (const tab of tabs) {
      try {
        const tabOriginPath = new URL(tab.url).pathname;
        const gemOriginPath = new URL(gemUrl).pathname;
        if (tabOriginPath === gemOriginPath) {
          return tab;
        }
      } catch {
        continue;
      }
    }
    // Herhangi bir Gemini sekmesi
    return tabs.length > 0 ? tabs[0] : null;
  }

  /**
   * Yeni Gemini sekmesi aç veya mevcut olanı kullan.
   */
  static async openGemTab(gemUrl: string, settings: GemSettings): Promise<{ tabId: number; isNew: boolean }> {
    // Önce mevcut Gemini sekmesini bulmayı dene
    if (!settings.newChatPerVideo) {
      const existing = await this.findMatchingGemTab(gemUrl);
      if (existing) {
        // Mevcut sekmeyi doğru URL'ye yönlendir (gerekirse)
        try {
          const currentTab = await chrome.tabs.get(existing.tabId);
          if (currentTab.url !== gemUrl) {
            await chrome.tabs.update(existing.tabId, { url: gemUrl });
          }
          // Sekmeyi arka planda tut (aktif yapma)
          await chrome.tabs.update(existing.tabId, { active: false });
          return { tabId: existing.tabId, isNew: false };
        } catch {
          // Sekme artık yoksa veya erişilemiyorsa yeni aç
        }
      }
    }

    // Yeni sekme aç — aktif: false yaparak Youtube sekmesinde kalınmasını sağlıyoruz
    const tab = await chrome.tabs.create({
      url: gemUrl,
      active: false,
    });

    if (!tab.id) throw new Error('Sekme oluşturulamadı.');

    return { tabId: tab.id, isNew: true };
  }

  /**
   * Sekmenin yüklenmesini bekle.
   */
  static async waitForTabLoad(tabId: number, timeoutMs: number = 15000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }, timeoutMs);

      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Zaten yüklüyse kontrol et
      chrome.tabs.get(tabId).then(tab => {
        if (tab.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      }).catch(() => {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      });
    });
  }

  /**
   * Sekmeyi kapat (autoClose ayarına göre).
   */
  static async maybeCloseTab(tabId: number, isNew: boolean, settings: GemSettings): Promise<void> {
    if (settings.autoCloseTab && isNew) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // Sekme zaten kapatılmış olabilir
      }
    }
  }
}
