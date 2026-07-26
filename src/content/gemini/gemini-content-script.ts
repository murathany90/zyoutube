/**
 * Gemini Content Script
 * Gemini sayfasında prompt girişi ve yanıt alma otomasyonu.
 * Yalnızca gemini.google.com origin'inde çalışır.
 * API anahtarı kullanmaz, çerez okumaz, hesap bilgisi toplamaz.
 */

import { GemAutomationRequest } from '../../gem/types';

// Element bulma öncelikleri
function findPromptInput(): HTMLElement | null {
  // 1. ARIA role ile
  const ariaElement = document.querySelector('[role="textbox"][contenteditable="true"]') as HTMLElement;
  if (ariaElement) return ariaElement;

  // 2. contenteditable div
  const editables = document.querySelectorAll('[contenteditable="true"]');
  for (const el of editables) {
    const rect = (el as HTMLElement).getBoundingClientRect();
    // Görünür ve makul boyutta mı?
    if (rect.width > 100 && rect.height > 20) {
      return el as HTMLElement;
    }
  }

  // 3. textarea
  const textarea = document.querySelector('textarea:not([type="hidden"])') as HTMLElement;
  if (textarea) return textarea;

  // 4. Erişilebilirlik etiketleri
  const labeled = document.querySelector('[aria-label*="message" i], [aria-label*="mesaj" i], [aria-label*="prompt" i], [placeholder*="message" i]') as HTMLElement;
  if (labeled) return labeled;

  return null;
}

function findSendButton(): HTMLElement | null {
  // 1. aria-label ile gönder butonu
  const ariaBtn = document.querySelector('[aria-label*="Send" i], [aria-label*="Gönder" i], button[aria-label*="submit" i]') as HTMLElement;
  if (ariaBtn) return ariaBtn;

  // 2. Form içindeki submit
  const submitBtn = document.querySelector('button[type="submit"]') as HTMLElement;
  if (submitBtn) return submitBtn;

  // 3. Mat icon ile gönder butonu (Material Design)
  const matBtn = document.querySelector('button .send-button-container, button[data-test-id="send-button"]') as HTMLElement;
  if (matBtn) return matBtn?.closest('button') as HTMLElement || matBtn;

  return null;
}

function getLatestResponse(): string | null {
  // Asistan yanıtlarını bul
  const containers = document.querySelectorAll(
    '[data-message-author-role="model"], .model-response-text, .response-container'
  );

  if (containers.length > 0) {
    const last = containers[containers.length - 1];
    return last.textContent?.trim() || null;
  }

  // Markdown rendering alanları
  const markdownBlocks = document.querySelectorAll('.markdown, .message-content');
  if (markdownBlocks.length > 0) {
    const last = markdownBlocks[markdownBlocks.length - 1];
    return last.textContent?.trim() || null;
  }

  return null;
}

function isLoginPage(): boolean {
  const url = window.location.href;
  return url.includes('accounts.google.com') ||
    url.includes('/signin') ||
    !!document.querySelector('input[type="email"], input[type="password"]');
}

function isStreamingActive(): boolean {
  // Streaming göstergesi kontrolü
  const stopBtn = document.querySelector('[aria-label*="Stop" i], [aria-label*="Durdur" i]');
  if (stopBtn) return true;

  // Loading spinner
  const spinner = document.querySelector('.loading-indicator, .typing-indicator, [role="progressbar"]');
  if (spinner) return true;

  return false;
}

/**
 * Yanıtın tamamlanmasını bekle.
 * Birden fazla sinyale dayanır: streaming durumu, DOM kararlılığı.
 */
async function waitForResponse(timeoutMs: number = 60000): Promise<string | null> {
  const startTime = Date.now();
  let lastContent = '';
  let stableCount = 0;
  const STABLE_THRESHOLD = 3; // 3 ardışık kontrol aynı sonucu verirse tamamlanmış kabul et
  const CHECK_INTERVAL = 2000;

  // Önce streaming başlamasını bekle
  await new Promise(r => setTimeout(r, 3000));

  while (Date.now() - startTime < timeoutMs) {
    // Streaming aktif mi?
    const streaming = isStreamingActive();

    const currentContent = getLatestResponse() || '';

    if (!streaming && currentContent.length > 0) {
      if (currentContent === lastContent) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) {
          return currentContent;
        }
      } else {
        stableCount = 0;
      }
    } else {
      stableCount = 0;
    }

    lastContent = currentContent;
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }

  // Timeout — son içeriği döndür (varsa)
  const finalContent = getLatestResponse();
  return finalContent && finalContent.length > 50 ? finalContent : null;
}

// Mesaj dinleyici
chrome.runtime.onMessage.addListener((message: GemAutomationRequest, sender, sendResponse) => {
  if (message.type !== 'GEM_AUTOMATE') return;

  // Güvenlik: Yalnızca eklentinin kendi mesajlarını kabul et
  if (!sender.id || sender.id !== chrome.runtime.id) return;

  // Doğrulama
  if (!message.taskId || !message.videoId || !message.prompt) {
    sendResponse({ success: false, error: 'Eksik parametreler.' });
    return;
  }

  if (message.prompt.length > (message.maxPromptLength || 30000)) {
    sendResponse({ success: false, error: 'Prompt çok uzun.' });
    return;
  }

  // Login sayfası mı?
  if (isLoginPage()) {
    sendResponse({ success: false, needsLogin: true, error: 'Google oturumu gerekli.' });
    return;
  }

  // Asenkron otomasyon
  (async () => {
    try {
      // Prompt alanını 10 saniye boyunca bekle, gerekirse Gem onay butonuna tıkla
      let input: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        // Chat with this Gem / Bu Gem ile sohbet et butonunu bul
        const gemChatBtn = Array.from(document.querySelectorAll('button, a')).find(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          return text.includes('chat with this gem') || text.includes('bu gem ile sohbet et') || text.includes('sohbeti başlat');
        });
        if (gemChatBtn) {
           (gemChatBtn as HTMLElement).click();
           await new Promise(r => setTimeout(r, 1000));
        }

        input = findPromptInput();
        if (input) break;
        await new Promise(r => setTimeout(r, 500));
      }

      if (!input) {
        sendResponse({ success: false, error: 'Prompt giriş alanı bulunamadı.' });
        return;
      }

      // Metni yerleştir
      if (input.getAttribute('contenteditable') === 'true') {
        input.focus();
        // ProseMirror ve benzeri rich-text editörler için en güvenilir yöntem
        const success = document.execCommand('insertText', false, message.prompt);
        
        if (!success) {
          // Arka plan sekmelerinde (background tabs) focus() ve execCommand çalışmaz.
          // Yöntem 1: ClipboardEvent (Paste simülasyonu)
          try {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', message.prompt);
            const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
            input.dispatchEvent(pasteEvent);
          } catch(e) {}
          
        // Yöntem 2: beforeinput (ProseMirror modern input handler)
          try {
            const beforeInput = new InputEvent('beforeinput', { inputType: 'insertText', data: message.prompt, bubbles: true, cancelable: true });
            input.dispatchEvent(beforeInput);
          } catch(e) {}
          
          // Yöntem 3: TextEvent (Eski ama güçlü textInput simülasyonu)
          try {
            const textEvent = document.createEvent('TextEvent') as any;
            textEvent.initTextEvent('textInput', true, true, window, message.prompt, 9, "en-US");
            input.dispatchEvent(textEvent);
          } catch (e) {}

          // Fallback
          if (!input.textContent || input.textContent.length < 10) {
            input.textContent = message.prompt;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
        input.focus();
        input.value = message.prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Kısa bekleme — UI'ın güncellenmesi için
      await new Promise(r => setTimeout(r, 500));

      // Yapıştırma işleminin başarılı olup olmadığını kontrol et
      if (input.textContent?.trim().length === 0 && (input as HTMLInputElement).value?.trim().length === 0) {
         sendResponse({ success: false, error: 'Metin yapıştırılamadı (Arka plan kısıtlaması olabilir).' });
         return;
      }

      // Gönder butonunu bul ve tıkla
      const sendBtn = findSendButton();
      if (sendBtn) {
        // ... (bazı butonlar disabled ise tıklanamayabilir)
        sendBtn.click();
      } else {
        // Enter tuşu ile gönder
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }

      // Yanıt bekle
      const response = await waitForResponse(60000);
      if (response) {
        sendResponse({ success: true, text: response });
      } else {
        sendResponse({ success: false, error: 'Yanıt alınamadı veya zaman aşımı.' });
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e.message || 'Otomasyon hatası.' });
    }
  })();

  return true; // Async response
});

console.log('[ZYouTube] Gemini content script loaded.');
