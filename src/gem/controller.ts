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
  private static inFlightSummaries: Map<string, Promise<GemSummaryResult>> = new Map();

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

  static summarize(request: GemSummaryRequest): Promise<GemSummaryResult> {
    const existing = this.inFlightSummaries.get(request.taskId);
    if (existing) return existing;

    const operation = this.runSummary(request);
    const trackedOperation = operation.finally(() => {
      if (this.inFlightSummaries.get(request.taskId) === trackedOperation) {
        this.inFlightSummaries.delete(request.taskId);
      }
    });
    this.inFlightSummaries.set(request.taskId, trackedOperation);
    return trackedOperation;
  }

  private static async runSummary(request: GemSummaryRequest): Promise<GemSummaryResult> {
    const controller = new AbortController();
    this.abortControllers.set(request.taskId, controller);
    let tabResult: { tabId: number; isNew: boolean } | null = null;

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
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs.length > 0 && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'COPY_TO_CLIPBOARD', text: prompt }).catch(() => {});
          }
        } catch {
          // Ignore
        }
      }

      // 5. Gem sekmesini bul veya aç
      this.emitStatus(request.taskId, 'tab_found', 'Gemini sekmesi aranıyor...');
      try {
        tabResult = await GemTabManager.openGemTab(gemSettings.gemUrl, gemSettings);
      } catch (e) {
        this.emitStatus(request.taskId, 'automation_failed', 'Gemini sekmesi açılamadı.');
        return this.fallback(request.taskId, prompt, gemSettings);
      }

      if (controller.signal.aborted) throw new Error('AbortError');

      // 6. Sekme yüklenmesini bekle
      this.emitStatus(request.taskId, 'gem_page_opened', 'Gem sayfası yükleniyor...');
      const loaded = await GemTabManager.waitForTabLoad(tabResult.tabId, 20000);
      if (!loaded) {
        this.emitStatus(request.taskId, 'automation_failed', 'Gem sayfası yüklenemedi.');
        return this.fallback(request.taskId, prompt, gemSettings, tabResult.tabId);
      }

      // Sayfa yüklendiğinde DOM'un hazır olması için ekstra bekleme
      await new Promise(r => setTimeout(r, 2000));

      if (controller.signal.aborted) throw new Error('AbortError');

      // Content script inject kontrolü (Ping ile)
      let isScriptInjected = false;
      try {
        const pingResponse = await chrome.tabs.sendMessage(tabResult.tabId, { type: 'GEM_AUTOMATION_PING' });
        if (pingResponse && pingResponse.success) {
          isScriptInjected = true;
        }
      } catch (e) {
        // Beklenen durum: script henüz inject edilmemiş
      }

      if (!isScriptInjected) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabResult.tabId },
            files: ['src/content/gemini/gemini-content-script.ts'],
          });
          // Hazır olmasını bekle ve doğrula
          await new Promise(r => setTimeout(r, 500));
          await chrome.tabs.sendMessage(tabResult.tabId, { type: 'GEM_AUTOMATION_PING' });
        } catch (e) {
          this.emitStatus(request.taskId, 'automation_failed', 'Content script başlatılamadı.');
          return this.fallback(request.taskId, prompt, gemSettings, tabResult.tabId);
        }
      }

      // 7. Content script ile otomasyon
      this.emitStatus(request.taskId, 'sending_message', 'Prompt gönderiliyor...');

      try {
        const automationRequest: GemAutomationRequest = {
          type: 'GEM_AUTOMATE',
          taskId: request.taskId,
          videoId: request.videoId,
          gemUrl: gemSettings.gemUrl,
          prompt: prompt,
          maxPromptLength: 1000000,
          timeoutMs: gemSettings.responseTimeoutMs || 600000,
        };

        this.emitStatus(request.taskId, 'waiting_response', 'Yanıt bekleniyor...');
        const response = await chrome.tabs.sendMessage(tabResult.tabId, automationRequest);

        if (
          response?.success === true &&
          response?.completed === true &&
          typeof response.text === 'string' &&
          response.text.trim().length > 50
        ) {
          this.emitStatus(request.taskId, 'response_received', 'Yanıt alındı.');
          await new Promise(r => setTimeout(r, 1500)); // Son kez sekmenin varlığını doğrulamak ve bekleme payı bırakmak
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
        return this.fallback(request.taskId, prompt, gemSettings, tabResult.tabId);
      } catch (e) {
        // Content script erişilemedi veya hata verdi
        return this.fallback(request.taskId, prompt, gemSettings, tabResult.tabId);
      }
    } catch (e: any) {
      if (e.message === 'AbortError') {
        this.emitStatus(request.taskId, 'automation_failed', 'İşlem iptal edildi.');
        return { success: false, fallbackUsed: false, status: 'automation_failed' };
      }
      return this.fallback(request.taskId, '', {} as GemSettings, tabResult?.tabId);
    } finally {
      this.abortControllers.delete(request.taskId);
      this.statusCallbacks.delete(request.taskId);
    }
  }

  /**
   * Fallback: Panoya kopyala + görünür sekme + kullanıcıya bildir
   */
  private static async fallback(
    taskId: string,
    _prompt: string,
    gemSettings: GemSettings,
    tabId?: number
  ): Promise<GemSummaryResult> {
    this.emitStatus(taskId, 'user_action_needed', 'Otomasyon tamamlanamadı. Panoya kopyalandı.');

    // Seçilmiş sekmeyi görünür yap; fallback ikinci bir sekme oluşturmamalı.
    if (gemSettings.fallbackToVisibleTab && tabId !== undefined) {
      try {
        await chrome.tabs.update(tabId, { active: true });
      } catch {
        // Sekme artık açık olmayabilir.
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
