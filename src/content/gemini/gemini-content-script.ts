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
  // 1. aria-label ile gönder butonu (genişletilmiş)
  const ariaBtn = document.querySelector(
    '[aria-label*="Send" i], [aria-label*="Gönder" i], ' +
    'button[aria-label*="submit" i], button[aria-label*="Send message" i]'
  ) as HTMLElement;
  if (ariaBtn) return ariaBtn;

  // 2. data-testid ile (Gemini güncel UI)
  const testIdBtn = document.querySelector(
    'button[data-testid="send-button"], button[data-test-id="send-button"], ' +
    '[data-testid*="send" i]'
  ) as HTMLElement;
  if (testIdBtn) return testIdBtn;

  // 3. Form içindeki submit
  const submitBtn = document.querySelector('button[type="submit"]') as HTMLElement;
  if (submitBtn) return submitBtn;

  // 4. Mat icon ile gönder butonu (Material Design)
  const matBtn = document.querySelector('button .send-button-container') as HTMLElement;
  if (matBtn) return matBtn.closest('button') as HTMLElement || matBtn;

  // 5. SVG send icon içeren buton (Gemini'nin ikonlu butonu)
  const svgBtns = document.querySelectorAll('button');
  for (const btn of svgBtns) {
    const rect = (btn as HTMLElement).getBoundingClientRect();
    // Gönder butonu genellikle input alanının sağında, küçük boyutlu
    if (rect.width > 20 && rect.width < 80 && rect.height > 20 && rect.height < 80) {
      const svg = btn.querySelector('svg');
      const hasArrowIcon = svg?.querySelector('path[d*="M2"], path[d*="m2"], path[d*="send"]');
      if (hasArrowIcon) return btn as HTMLElement;
    }
  }

  return null;
}

function getLatestResponseInternal(): string | null {
  // Strategy 1: Data attributes and strict tags
  const modelContainers = document.querySelectorAll(
    '[data-message-author-role="model"], ' +
    'message-content[data-message-author-role="model"], ' +
    '.model-response-text, ' +
    'model-message'
  );
  if (modelContainers.length > 0) {
    const last = modelContainers[modelContainers.length - 1] as HTMLElement;
    const text = last.innerText?.trim() || last.textContent?.trim() || null;
    if (text && text.length > 20) return text;
  }

  // Strategy 2: Common response classes in conversation area
  const turnContainers = document.querySelectorAll(
    '.conversation-container [class*="response"], ' +
    '.chat-history [class*="model"], ' +
    '[class*="turn-content"], ' +
    '[class*="response-content"], ' +
    '.markdown, ' +
    '.message-content'
  );
  
  if (turnContainers.length > 0) {
    for (let i = turnContainers.length - 1; i >= 0; i--) {
      const el = turnContainers[i] as HTMLElement;
      // Yan menüdeki geçmiş öğelerini atlamak için
      if (el.closest('nav') || el.closest('aside') || el.closest('drawers')) continue;
      
      const text = el.innerText?.trim() || el.textContent?.trim() || '';
      if (text.length > 50 && !el.closest('[contenteditable="true"]')) {
        return text;
      }
    }
  }

  // Strategy 3: Herhangi bir div içindeki en son uzun blok (Sidebar ve input hariç)
  const allDivs = document.querySelectorAll('div[class]');
  let bestCandidate: string | null = null;
  let bestIndex = -1;
  for (let i = allDivs.length - 1; i >= Math.max(0, allDivs.length - 60); i--) {
    const div = allDivs[i] as HTMLElement;
    if (div.closest('nav') || div.closest('aside') || div.closest('[contenteditable="true"]')) continue;
    
    const cls = div.className || '';
    if (typeof cls === 'string' && (cls.includes('message') || cls.includes('response') || 
        cls.includes('content') || cls.includes('text') ||
        cls.includes('output') || cls.includes('answer'))) {
      const text = div.innerText?.trim() || '';
      if (text.length > 100) {
        if (i > bestIndex) {
          bestCandidate = text;
          bestIndex = i;
        }
      }
    }
  }
  
  return bestCandidate;
}

function getLatestResponse(): string | null {
  const text = getLatestResponseInternal();
  if (!text) return null;
  
  // Gemini'nin kod yürütme bloklarını yoksaymak için, son "📝 Genel Özet"i bul ve oradan sonrasını al
  const marker = "📝 Genel Özet";
  const lastIndex = text.lastIndexOf(marker);
  if (lastIndex !== -1) {
    return text.substring(lastIndex);
  }
  return text;
}

function isLoginPage(): boolean {
  const url = window.location.href;
  return url.includes('accounts.google.com') ||
    url.includes('/signin') ||
    !!document.querySelector('input[type="email"], input[type="password"]');
}

interface BaselineState {
  modelTurnCount: number;
  lastResponseText: string;
  lastResponseElement: HTMLElement | null;
}

function captureResponseState(): BaselineState {
  const modelContainers = document.querySelectorAll(
    '[data-message-author-role="model"], ' +
    'message-content[data-message-author-role="model"], ' +
    '.model-response-text, ' +
    'model-message'
  );
  
  const lastElement = modelContainers.length > 0 ? modelContainers[modelContainers.length - 1] as HTMLElement : null;
  const lastText = lastElement ? (lastElement.innerText?.trim() || lastElement.textContent?.trim() || '') : '';
  
  return {
    modelTurnCount: modelContainers.length,
    lastResponseText: lastText,
    lastResponseElement: lastElement
  };
}

function isStreamingActive(): boolean {
  // Streaming göstergesi kontrolü (genişletilmiş)
  const stopBtn = document.querySelector(
    '[aria-label*="Stop" i], [aria-label*="Durdur" i], [aria-label*="cancel" i], [aria-label*="yanıtı durdur" i], ' +
    'button[data-testid*="stop" i]'
  );
  if (stopBtn) {
    const rect = (stopBtn as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }

  const matIcons = document.querySelectorAll('mat-icon');
  for (const icon of matIcons) {
    const text = icon.textContent?.toLowerCase() || '';
    if (text.includes('stop') || text.includes('cancel')) {
      const rect = (icon as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
  }

  // Loading spinner
  const spinners = document.querySelectorAll(
    '.loading-indicator, .typing-indicator, [role="progressbar"], [aria-busy="true"], ' +
    '.response-streaming, [data-is-streaming="true"], .streaming-response'
  );
  for (const spinner of spinners) {
    const rect = (spinner as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }

  // Gemini animasyonlu nokta göstergesi
  const dotsList = document.querySelectorAll('.thinking-indicator, .dot-animation, .loading-dots');
  for (const dots of dotsList) {
    const rect = (dots as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  }

  return false;
}

/**
 * Yanıtın tamamlanmasını bekle.
 * Birden fazla sinyale dayanır: streaming durumu, DOM kararlılığı.
 */
async function waitForResponse(options: { baseline: BaselineState; timeoutMs: number }): Promise<{ completed: boolean; text: string; diagnostics?: any } | { timeout: true; partialText: string; diagnostics?: any }> {
  const { baseline, timeoutMs } = options;
  const startTime = Date.now();
  
  let generationStarted = false;
  let lastText = '';
  let lastChangeAt = Date.now();
  let stablePollCount = 0;
  let notStreamingPollCount = 0;
  
  // Observer setup
  const conversationArea = document.querySelector('.conversation-container, .chat-history, main') || document.body;
  const observer = new MutationObserver((mutations) => {
    let changed = false;
    for (const m of mutations) {
      if (m.type === 'childList' || m.type === 'characterData') {
        changed = true; break;
      }
    }
    if (changed) {
      const currentText = getLatestResponse() || '';
      if (currentText !== lastText) {
        lastChangeAt = Date.now();
      }
    }
  });
  
  observer.observe(conversationArea, { childList: true, subtree: true, characterData: true });

  const CHECK_INTERVAL = 2000;

  try {
    while (Date.now() - startTime < timeoutMs) {
      const streaming = isStreamingActive();
      const currentContent = getLatestResponse() || '';
      
      const modelContainers = document.querySelectorAll(
        '[data-message-author-role="model"], ' +
        'message-content[data-message-author-role="model"], ' +
        '.model-response-text, ' +
        'model-message'
      );
      
      const currentElement = modelContainers.length > 0 ? modelContainers[modelContainers.length - 1] as HTMLElement : null;
      
      if (!generationStarted) {
        if (modelContainers.length > baseline.modelTurnCount || currentElement !== baseline.lastResponseElement || (currentContent.length > 10 && currentContent !== baseline.lastResponseText)) {
          generationStarted = true;
          console.log('[ZYouTube Gemini] Generation started');
        }
      }

      if (currentContent !== lastText) {
        lastText = currentContent;
        lastChangeAt = Date.now();
        stablePollCount = 0;
      } else {
        stablePollCount++;
      }
      
      if (!streaming) {
        notStreamingPollCount++;
      } else {
        notStreamingPollCount = 0;
      }

      const elapsedMs = Date.now() - startTime;
      const stableForMs = Date.now() - lastChangeAt;
      const responseCharacters = currentContent.length;

      // Report progress to background
      chrome.runtime.sendMessage({
        type: 'GEMINI_PROGRESS',
        payload: {
          status: 'waiting_response',
          message: 'Gemini yanıt üretiyor…',
          elapsedMs,
          responseCharacters,
          streamingActive: streaming,
          stableForMs
        }
      }).catch(() => {});
      
      console.log(`[ZYouTube Gemini] Response progress { elapsedMs: ${elapsedMs}, responseCharacters: ${responseCharacters}, streamingActive: ${streaming}, stableForMs: ${stableForMs} }`);

      // Completion conditions
      if (
        generationStarted &&
        responseCharacters >= 50 &&
        stableForMs >= 12000 &&
        stablePollCount >= 4 &&
        notStreamingPollCount >= 3 &&
        currentElement && document.body.contains(currentElement)
      ) {
        console.log(`[ZYouTube Gemini] Response completed { elapsedMs: ${elapsedMs}, responseCharacters: ${responseCharacters}, stableForMs: ${stableForMs} }`);
        return {
          completed: true,
          text: currentContent,
          diagnostics: {
            generationStarted,
            stableForMs,
            stablePollCount,
            notStreamingPollCount,
            elapsedMs,
            responseCharacters
          }
        };
      }

      await new Promise(r => setTimeout(r, CHECK_INTERVAL));
    }

    // Timeout
    const elapsedMs = Date.now() - startTime;
    console.log(`[ZYouTube Gemini] Response timeout { elapsedMs: ${elapsedMs}, partialCharacters: ${lastText.length} }`);
    return {
      timeout: true,
      partialText: lastText,
      diagnostics: {
        generationStarted,
        stableForMs: Date.now() - lastChangeAt,
        stablePollCount,
        notStreamingPollCount,
        elapsedMs,
        responseCharacters: lastText.length
      }
    };
  } finally {
    observer.disconnect();
  }
}

// Mesaj dinleyici
declare global {
  interface Window {
    __ZYOUTUBE_GEMINI_AUTOMATION_LOADED__?: boolean;
  }
}

if (!window.__ZYOUTUBE_GEMINI_AUTOMATION_LOADED__) {
  window.__ZYOUTUBE_GEMINI_AUTOMATION_LOADED__ = true;
  registerGeminiMessageListener();
}

function registerGeminiMessageListener() {
  chrome.runtime.onMessage.addListener((message: GemAutomationRequest | any, sender, sendResponse) => {
    if (message.type === 'GEM_AUTOMATION_PING') {
      sendResponse({ success: true, version: 2 });
      return true;
    }
  if (message.type !== 'GEM_AUTOMATE') return;

  // Güvenlik: Yalnızca eklentinin kendi mesajlarını kabul et
  if (!sender.id || sender.id !== chrome.runtime.id) return;

  // Doğrulama
  if (!message.taskId || !message.videoId || !message.prompt) {
    sendResponse({ success: false, error: 'Eksik parametreler.' });
    return;
  }

  if (message.prompt.length > (message.maxPromptLength || 1000000)) {
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

      // Metin yerleştirme fonksiyonu
      const insertTextIntoInput = (el: HTMLElement, text: string): boolean => {
        if (el.getAttribute('contenteditable') === 'true') {
          el.focus();
          // ProseMirror ve benzeri rich-text editörler için en güvenilir yöntem
          const success = document.execCommand('insertText', false, text);
          
          if (!success) {
            // Arka plan sekmelerinde (background tabs) focus() ve execCommand çalışmaz.
            // Yöntem 1: ClipboardEvent (Paste simülasyonu)
            try {
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', text);
              const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer });
              el.dispatchEvent(pasteEvent);
            } catch(e) {}
            
            // Yöntem 2: beforeinput (ProseMirror modern input handler)
            try {
              const beforeInput = new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true });
              el.dispatchEvent(beforeInput);
            } catch(e) {}
            
            // Yöntem 3: TextEvent (Eski ama güçlü textInput simülasyonu)
            try {
              const textEvent = document.createEvent('TextEvent') as any;
              textEvent.initTextEvent('textInput', true, true, window, text, 9, "en-US");
              el.dispatchEvent(textEvent);
            } catch (e) {}

            // Fallback: Doğrudan içeriği yerleştir
            if (!el.textContent || el.textContent.length < 10) {
              el.textContent = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          return true;
        } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
          el.focus();
          el.value = text;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      };

      // Metin içeriğinin başarılı yazılıp yazılmadığını kontrol et
      const hasContent = (el: HTMLElement): boolean => {
        const tc = el.textContent?.trim() || '';
        const val = (el as HTMLInputElement).value?.trim?.() || '';
        return tc.length > 10 || val.length > 10;
      };

      const baseline = captureResponseState();
      // İlk deneme: Metni yerleştir
      insertTextIntoInput(input, message.prompt);
      await new Promise(r => setTimeout(r, 800));

      // Yapıştırma başarısız olduysa, background tab çalışmama sorununu aşmak için
      // chrome API ile sekmeyi aktif yap ve yeniden dene
      if (!hasContent(input)) {
        console.warn('[ZYouTube] İlk yapıştırma denemesi başarısız, sekme aktif edilerek yeniden deneniyor...');
        try {
          // Background'a "beni aktif yap" mesajı gönder
          chrome.runtime.sendMessage({ type: 'ACTIVATE_CURRENT_TAB' });
          await new Promise(r => setTimeout(r, 1000));
          
          // Input'u yeniden bul (DOM değişmiş olabilir)
          input = findPromptInput();
          if (input) {
            insertTextIntoInput(input, message.prompt);
            await new Promise(r => setTimeout(r, 800));
          }
        } catch (retryErr) {
          console.warn('[ZYouTube] Sekme aktif etme denemesi başarısız:', retryErr);
        }
      }

      // Son kontrol
      if (!input || !hasContent(input)) {
        sendResponse({ success: false, error: 'Metin yapıştırılamadı. Lütfen Gemini sekmesini ön plana getirin ve tekrar deneyin.' });
        return;
      }

      // Gönder butonunu bul ve tıkla
      await new Promise(r => setTimeout(r, 300));
      const sendBtn = findSendButton();
      if (sendBtn) {
        // Disabled kontrolü
        if (sendBtn.hasAttribute('disabled')) {
          // Buton henüz aktif değilse kısa bekle
          await new Promise(r => setTimeout(r, 1000));
        }
        sendBtn.click();
      } else {
        // Enter tuşu ile gönder
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
        }));
      }

      // Yanıt bekle
      const response = await waitForResponse({
        baseline,
        timeoutMs: message.timeoutMs || 600000
      });
      
      if ('completed' in response && response.completed) {
        sendResponse({ success: true, completed: true, text: response.text, diagnostics: response.diagnostics });
      } else if ('timeout' in response && response.timeout) {
        sendResponse({ success: false, completed: false, partialText: response.partialText, error: 'Gemini yanıtı belirtilen sürede tamamlanmadı.', diagnostics: response.diagnostics });
      } else {
        sendResponse({ success: false, error: 'Bilinmeyen yanıt hatası.' });
      }
    } catch (e: any) {
      sendResponse({ success: false, error: e.message || 'Otomasyon hatası.' });
    }
  })();

  return true; // Async response
  });
}

console.log('[ZYouTube] Gemini content script loaded.');
