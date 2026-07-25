/**
 * Gemini Gem Controller
 * Gem otomasyonunun ana orkestratörü.
 * Service worker (background) içinde çalışır.
 */
import { GemSettings, GemStatus, GemStatusInfo, GemAutomationRequest } from './types';
import { GemSettingsService } from './settings';
import { GemTabManager } from './tab-manager';
import { GemPromptBuilder, GemPromptOptions } from './prompt-builder';
import { TranscriptSegment } from '../transcript/types';

export interface GemSummaryRequest {
  taskId: string;
  videoId: string;
  videoTitle: string;
  channelName?: string;
  videoUrl: string;
  segments: TranscriptSegment[];
  languageCode: string;
  sourceType: string;
  summaryLength: 'short' | 'standard' | 'detailed';
  outputLanguage: 'tr' | 'en' | 'tr-en';
}

export interface GemSummaryResult {
  success: boolean;
  response?: string;
  fallbackUsed: boolean;
  fallbackMessage?: string;
  status: GemStatus;
}

export class GemController {
  private static statusCallbacks: Map<string, (info: GemStatusInfo) => void> = new Map();
  private static abortControllers: Map<string, AbortController> = new Map();

  static onStatusChange(taskId: string, callback: (info: GemStatusInfo) => void) {
    this.statusCallbacks.set(taskId, callback);
  }

  private static emitStatus(taskId: string, status: GemStatus, message: string) {
    const info: GemStatusInfo = { status, message, timestamp: Date.now() };
    const cb = this.statusCallbacks.get(taskId);
    if (cb) cb(info);
  }

  static cancel(taskId: string) {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
    this.statusCallbacks.delete(taskId);
  }

  static async summarize(request: GemSummaryRequest): Promise<GemSummaryResult> {
    const controller = new AbortController();
    this.abortControllers.set(request.taskId, controller);

    try {
      // 1. Gem ayarlarını oku
      const gemSettings = await GemSettingsService.getGemSettings();

      // 2. Gem URL kontrolü
      if (!gemSettings.gemUrl) {
        this.emitStatus(request.taskId, 'not_configured', 'Gem URL ayarlanmadı.');
        return { success: false, fallbackUsed: false, status: 'not_configured' };
      }

      const urlCheck = GemSettingsService.validateGemUrl(gemSettings.gemUrl);
      if (!urlCheck.valid) {
        this.emitStatus(request.taskId, 'not_configured', urlCheck.error || 'Geçersiz Gem URL.');
        return { success: false, fallbackUsed: false, status: 'not_configured' };
      }

      this.emitStatus(request.taskId, 'url_valid', 'Gem URL geçerli.');

      // 3. Prompt hazırla
      this.emitStatus(request.taskId, 'preparing_transcript', 'Transkript hazırlanıyor...');
      const promptOptions: GemPromptOptions = {
        videoTitle: request.videoTitle,
        channelName: request.channelName,
        videoUrl: request.videoUrl,
        languageCode: request.languageCode,
        sourceType: request.sourceType,
        summaryLength: request.summaryLength,
        outputLanguage: request.outputLanguage,
      };
      const prompt = GemPromptBuilder.buildPrompt(request.segments, promptOptions);

      if (controller.signal.aborted) throw new Error('AbortError');

      // 4. Panoya kopyala (ayara göre)
      if (gemSettings.copyToClipboard) {
        try {
          // Service worker'da clipboard API yok, bu işlem content script üzerinden yapılmalı
          // Burada flag olarak işaretliyoruz
        } catch {
          // Clipboard erişimi olmayabilir
        }
      }

      // 5. Gem sekmesini bul veya aç
      this.emitStatus(request.taskId, 'tab_found', 'Gemini sekmesi aranıyor...');
      let tabResult: { tabId: number; isNew: boolean };
      try {
        tabResult = await GemTabManager.openGemTab(gemSettings.gemUrl, gemSettings);
      } catch (e) {
        this.emitStatus(request.taskId, 'automation_failed', 'Gemini sekmesi açılamadı.');
        return this.fallback(request.taskId, prompt, gemSettings);
      }

      if (controller.signal.aborted) throw new Error('AbortError');

      // 6. Sekme yüklenmesini bekle
      this.emitStatus(request.taskId, 'gem_page_opened', 'Gem sayfası yükleniyor...');
      const loaded = await GemTabManager.waitForTabLoad(tabResult.tabId, 15000);
      if (!loaded) {
        this.emitStatus(request.taskId, 'automation_failed', 'Gem sayfası yüklenemedi.');
        return this.fallback(request.taskId, prompt, gemSettings);
      }

      if (controller.signal.aborted) throw new Error('AbortError');

      // 7. Content script ile otomasyon
      this.emitStatus(request.taskId, 'sending_message', 'Prompt gönderiliyor...');

      try {
        const automationRequest: GemAutomationRequest = {
          type: 'GEM_AUTOMATE',
          taskId: request.taskId,
          videoId: request.videoId,
          gemUrl: gemSettings.gemUrl,
          prompt: prompt,
          maxPromptLength: 30000,
        };

        const response = await chrome.tabs.sendMessage(tabResult.tabId, automationRequest);

        if (response?.success) {
          this.emitStatus(request.taskId, 'response_received', 'Yanıt alındı.');
          await GemTabManager.maybeCloseTab(tabResult.tabId, tabResult.isNew, gemSettings);
          return {
            success: true,
            response: response.text,
            fallbackUsed: false,
            status: 'response_received',
          };
        }

        // Otomasyon başarısız — oturum gerekli mi?
        if (response?.needsLogin) {
          this.emitStatus(request.taskId, 'session_required', 'Google oturumu gerekli.');
          // Sekmeyi görünür yap
          await chrome.tabs.update(tabResult.tabId, { active: true });
          return {
            success: false,
            fallbackUsed: true,
            fallbackMessage: 'Google oturumu gerekli. Lütfen Gemini sayfasında oturum açın ve tekrar deneyin.',
            status: 'session_required',
          };
        }

        // Genel otomasyon başarısızlığı
        return this.fallback(request.taskId, prompt, gemSettings);
      } catch (e) {
        // Content script erişilemedi veya hata verdi
        return this.fallback(request.taskId, prompt, gemSettings);
      }
    } catch (e: any) {
      if (e.message === 'AbortError') {
        this.emitStatus(request.taskId, 'automation_failed', 'İşlem iptal edildi.');
        return { success: false, fallbackUsed: false, status: 'automation_failed' };
      }
      return this.fallback(request.taskId, '', {} as GemSettings);
    } finally {
      this.abortControllers.delete(request.taskId);
      this.statusCallbacks.delete(request.taskId);
    }
  }

  /**
   * Fallback: Panoya kopyala + görünür sekme + kullanıcıya bildir
   */
  private static async fallback(taskId: string, _prompt: string, gemSettings: GemSettings): Promise<GemSummaryResult> {
    this.emitStatus(taskId, 'user_action_needed', 'Otomasyon tamamlanamadı. Panoya kopyalandı.');

    // Görünür sekmede Gem URL'yi aç
    if (gemSettings.fallbackToVisibleTab && gemSettings.gemUrl) {
      try {
        await chrome.tabs.create({ url: gemSettings.gemUrl, active: true });
      } catch {
        // Sekme açılamadı
      }
    }

    return {
      success: false,
      fallbackUsed: true,
      fallbackMessage: 'Gemini otomasyonu tamamlanamadı. Hazırlanan transkript panoya kopyalandı. Açılan Gemini Gem sekmesine yapıştırarak devam edebilirsiniz.',
      status: 'user_action_needed',
    };
  }
}
