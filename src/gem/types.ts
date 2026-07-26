/**
 * Gemini Gem Types
 * Gemini Gem tarayıcı otomasyonu için tip tanımları.
 * Bu bir API sağlayıcısı DEĞİLDİR — tarayıcı oturumu üzerinden çalışır.
 */

export type SummaryEngine = 'gemini-gem' | 'openai-compatible' | 'chrome-local';

export interface GemSettings {
  gemUrl: string;
  useExistingTab: boolean;
  tryBackgroundTab: boolean;
  fallbackToVisibleTab: boolean;
  autoCloseTab: boolean;
  newChatPerVideo: boolean;
  copyToClipboard: boolean;
  chunkLongTranscripts: boolean;
}

export const DEFAULT_GEM_SETTINGS: GemSettings = {
  gemUrl: '',
  useExistingTab: true,
  tryBackgroundTab: true,
  fallbackToVisibleTab: true,
  autoCloseTab: false,
  newChatPerVideo: true,
  copyToClipboard: true,
  chunkLongTranscripts: true,
};

export type GemStatus =
  | 'not_configured'      // Gem URL ayarlanmadı
  | 'url_valid'           // URL geçerli
  | 'tab_found'           // Gemini sekmesi bulundu
  | 'session_required'    // Google oturumu gerekli
  | 'gem_page_opened'     // Gem sayfası açıldı
  | 'preparing_transcript'// Transkript hazırlanıyor
  | 'sending_message'     // Mesaj gönderiliyor
  | 'waiting_response'    // Yanıt bekleniyor
  | 'response_received'   // Sonuç alındı
  | 'automation_failed'   // Otomasyon başarısız
  | 'user_action_needed'; // Kullanıcı işlemi gerekli

export interface GemStatusInfo {
  status: GemStatus;
  message: string;
  timestamp: number;
}

export interface PanelSettings {
  enabled: boolean;
  autoOpenOnWatchPage: boolean;
  defaultCollapsed: boolean;
}

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  enabled: true,
  autoOpenOnWatchPage: true,
  defaultCollapsed: false,
};

// Gemini content script ile iletişim mesajları
export interface GemAutomationRequest {
  type: 'GEM_AUTOMATE';
  taskId: string;
  videoId: string;
  gemUrl: string;
  prompt: string;
  maxPromptLength: number;
}

export interface GemAutomationResponse {
  type: 'GEM_AUTOMATION_RESULT';
  taskId: string;
  videoId: string;
  success: boolean;
  response?: string;
  error?: string;
  status: GemStatus;
}

export interface GemTabInfo {
  tabId: number;
  url: string;
  isGemPage: boolean;
}
