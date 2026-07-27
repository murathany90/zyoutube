import { PromptBuilder } from '../ai/prompt-builder';
import { ResponseParser } from '../ai/response-parser';
import { CorrectionPromptBuilder } from '../ai/prompt-correction';
import { CorrectionResponseParser } from '../ai/correction-parser';

interface TaskContext {
  controller: AbortController;
  heartbeatId: number;
  timeoutId: number;
  startedAt: number;
}

const activeTasks = new Map<string, TaskContext>();
let idleTimer: number | null = null;

function resetIdleTimer() {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
  
  if (activeTasks.size === 0) {
    idleTimer = window.setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'API_SUMMARY_IDLE' }).catch(console.error);
    }, 60000);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'API_SUMMARY_START') {
    if (activeTasks.has(message.taskId)) {
      sendResponse({ success: false, error: 'API_TASK_ALREADY_RUNNING' });
      return true;
    }
    handleApiSummaryStart(message.taskId, message.videoId, message.request, message.config);
    sendResponse({ success: true, accepted: true });
    return true;
  }
  
  if (message.type === 'API_SUMMARY_CANCEL') {
    const task = activeTasks.get(message.taskId);
    if (task) {
      task.controller.abort(new Error('AbortError'));
      // Clean up happens in the finally block of handleApiSummaryStart
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'API_CORRECTION_START') {
    if (activeTasks.has(message.taskId)) {
      sendResponse({ success: false, error: 'API_TASK_ALREADY_RUNNING' });
      return true;
    }
    handleApiCorrectionStart(message.taskId, message.videoId, message.request, message.config);
    sendResponse({ success: true, accepted: true });
    return true;
  }
  
  if (message.type === 'API_CORRECTION_CANCEL') {
    const task = activeTasks.get(message.taskId);
    if (task) {
      task.controller.abort(new Error('AbortError'));
    }
    sendResponse({ success: true });
    return true;
  }
});

async function handleApiSummaryStart(taskId: string, videoId: string, request: any, config: any) {
  const startedAt = performance.now();
  const controller = new AbortController();
  
  const heartbeatId = window.setInterval(() => {
    chrome.runtime.sendMessage({
      type: 'API_SUMMARY_HEARTBEAT',
      taskId,
      videoId
    }).catch(console.error);
  }, 15000);

  const timeoutMs = config.timeoutMs ?? 180000;
  const timeoutId = window.setTimeout(() => {
    controller.abort(new Error('Timeout'));
  }, timeoutMs);

  activeTasks.set(taskId, {
    controller,
    heartbeatId,
    timeoutId,
    startedAt
  });
  
  // 4. Offscreen kabul onayı
  chrome.runtime.sendMessage({ type: 'API_SUMMARY_ACCEPTED', taskId }).catch(console.error);

  resetIdleTimer(); // clear idle timer since we have an active task

  try {
    console.log(`[API Task] offscreen started for task ${taskId}`);
    
    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    const model = config.model || 'gpt-3.5-turbo';
    const body = PromptBuilder.buildApiRequestBody(request, config);

    console.log(`[API Task] POST started`);
    const fetchStart = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...config.customHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    const latencyMs = Math.round(performance.now() - fetchStart);
    console.log(`[API Task] HTTP status: ${response.status}`);

    if (!response.ok) {
      let errorMsg = response.statusText;
      try {
        const rawText = await response.text();
        try {
          const errorData = JSON.parse(rawText);
          errorMsg = errorData?.error?.message || errorData?.message || rawText.slice(0, 500);
        } catch {
          errorMsg = rawText.slice(0, 500);
        }
      } catch {
        /* ignore */
      }
      throw new Error(`Bağlantı hatası: ${response.status} ${errorMsg}`);
    }

    let aiResponseText = '';
    let usage: any = undefined;
    
    try {
      const data = await response.json();
      if (!data.choices || !data.choices[0]) {
         throw new Error("Geçersiz API yanıtı (choices dizisi boş).");
      }
      
      const messageObj = data.choices[0].message;
      if (!messageObj) {
         throw new Error("Geçersiz API yanıtı (message nesnesi eksik).");
      }
      
      aiResponseText = messageObj.content || '';
      
      if (!aiResponseText || aiResponseText.trim() === '') {
        aiResponseText = messageObj.reasoning_content || '';
      }
      
      if (!aiResponseText || aiResponseText.trim() === '') {
        throw new Error("EMPTY_API_RESPONSE: API yanıtı içerik veya düşünme (reasoning) verisi barındırmıyor.");
      }
      
      if (data.choices[0].finish_reason === 'content_filter') {
         throw new Error("İçerik filtrelemesi nedeniyle yanıt alınamadı.");
      }
      
      usage = data.usage;
    } catch (e: any) {
       throw new Error(e.message || "JSON yanıtı işlenemedi.");
    }

    const parsedResult = ResponseParser.parseAndValidate(
      aiResponseText,
      taskId,
      videoId,
      config.id,
      model,
      request.options,
      undefined,
      request.transcript.segments
    );
    
    const finalResult = {
      ...parsedResult,
      latencyMs,
      timestamp: Date.now()
    };
    
    if (usage) {
       finalResult.usage = {
         inputTokens: usage.prompt_tokens || 0,
         outputTokens: usage.completion_tokens || 0,
         totalTokens: usage.total_tokens || 0
       };
    }
    
    if (request.transcript.warnings) {
        finalResult.warnings = finalResult.warnings || [];
        finalResult.warnings.push(...request.transcript.warnings);
    }
    
    console.log(`[API Task] completed`);
    
    chrome.runtime.sendMessage({
        type: 'API_SUMMARY_COMPLETED',
        taskId,
        videoId,
        result: finalResult
    }).then(() => {
        console.log(`[API Task] result delivered`);
    }).catch(e => {
        console.error(`[API Task] delivery failed for task ${taskId}:`, e);
    });
    
  } catch (e: any) {
    console.log(`[API Task] failed:`, e);
    const isTimeout = e.message === 'Timeout';
    const isAbort = e.name === 'AbortError' || e.message === 'AbortError';
    
    const errorCode = isAbort ? 'REQUEST_CANCELLED' : (isTimeout ? 'TIMEOUT' : 'UNKNOWN_ERROR');
    const userMsg = isAbort ? 'İstek kullanıcı tarafından iptal edildi.' : (isTimeout ? 'İstek zaman aşımına uğradı. İşlem çok uzun sürdü.' : (e.message || 'Beklenmeyen bir hata oluştu.'));
    
    chrome.runtime.sendMessage({
        type: 'API_SUMMARY_FAILED',
        taskId,
        videoId,
        error: {
            code: errorCode,
            userMessage: userMsg,
            retryable: !isAbort
        }
    }).catch(err => {
        console.error(`[API Task] delivery failed for task ${taskId}:`, err);
    });
  } finally {
    // 2. Timeout temizliğini garanti et
    const task = activeTasks.get(taskId);
    if (task) {
      window.clearTimeout(task.timeoutId);
      window.clearInterval(task.heartbeatId);
      activeTasks.delete(taskId);
    }
    resetIdleTimer();
  }
}

async function handleApiCorrectionStart(taskId: string, videoId: string, request: any, config: any) {
  const startedAt = performance.now();
  const controller = new AbortController();
  
  const heartbeatId = window.setInterval(() => {
    const elapsed = Math.round((performance.now() - startedAt) / 1000);
    chrome.runtime.sendMessage({
      type: 'API_CORRECTION_PROGRESS',
      taskId,
      videoId,
      stage: 'waiting',
      message: `Yapay zeka yanıtı bekleniyor... ${elapsed} sn`,
      elapsedMs: Math.round(performance.now() - startedAt)
    }).catch(console.error);

    chrome.runtime.sendMessage({
      type: 'API_CORRECTION_HEARTBEAT',
      taskId,
      videoId
    }).catch(console.error);
  }, 15000);

  const timeoutMs = config.correctionTimeoutMs ?? 600000;
  const timeoutId = window.setTimeout(() => {
    controller.abort(new Error('Timeout'));
  }, timeoutMs);

  activeTasks.set(taskId, {
    controller,
    heartbeatId,
    timeoutId,
    startedAt
  });
  
  chrome.runtime.sendMessage({ type: 'API_CORRECTION_ACCEPTED', taskId }).catch(console.error);
  resetIdleTimer();

  try {
    console.log(`[API Task] offscreen correction started for task ${taskId}`);
    
    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    const body = CorrectionPromptBuilder.buildApiRequestBody(request, config);

    console.log(`[API Task] correction POST started`);
    
    const inputChars = JSON.stringify(body).length;
    console.log(`[Correction Request]
segmentCount: ${request.transcript.segments.length}
inputCharacters: ${inputChars}
estimatedInputTokens: ${Math.round(inputChars / 4)}
maxOutputTokens: ${body.max_tokens}
streaming: ${body.stream || false}
reasoningEnabled: ${config.correctionEnableReasoning || false}
model: ${body.model}`);

    chrome.runtime.sendMessage({
      type: 'API_CORRECTION_PROGRESS',
      taskId,
      videoId,
      stage: 'sending',
      message: 'İstek API\'ye gönderiliyor...',
      elapsedMs: Math.round(performance.now() - startedAt)
    }).catch(console.error);
    
    const fetchStart = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...config.customHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    
    const latencyMs = Math.round(performance.now() - fetchStart);
    console.log(`[API Task] correction HTTP status: ${response.status}`);

    if (!response.ok) {
      if (response.status === 504) {
        throw new Error(
          "API sağlayıcısı düzeltme isteğini zamanında tamamlayamadı (504). " +
          "Bu eklenti timeout'u değildir. Streaming açık ve düzeltme reasoning " +
          "kapalı olarak tekrar deneyin."
        );
      }
      let errorMsg = response.statusText;
      try {
        const rawText = await response.text();
        const errorData = JSON.parse(rawText);
        errorMsg = errorData?.error?.message || errorData?.message || rawText.slice(0, 500);
      } catch { /* ignore */ }
      throw new Error(`Bağlantı hatası: ${response.status} ${errorMsg}`);
    }

    let aiResponseText = '';
    let finishReason = '';
    let reasoningContent = '';
    let contentType = 'string';

    if (body.stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let lastProgressTime = performance.now();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;
          
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              aiResponseText += content;
            }
            if (data.choices?.[0]?.finish_reason) {
              finishReason = data.choices[0].finish_reason;
            }
          } catch (e) {
            // ignore
          }
        }
        
        const now = performance.now();
        if (now - lastProgressTime >= 10000) {
          lastProgressTime = now;
          chrome.runtime.sendMessage({
            type: 'API_CORRECTION_PROGRESS',
            taskId,
            videoId,
            stage: 'streaming',
            message: `Yanıt alınıyor... ${aiResponseText.length} karakter`,
            elapsedMs: Math.round(performance.now() - startedAt)
          }).catch(console.error);
        }
      }
    } else {
      const data = await response.json();
      if (!data.choices || !data.choices[0]) {
         throw new Error("Geçersiz API yanıtı (choices dizisi boş).");
      }
      const messageObj = data.choices[0].message;
      if (!messageObj) {
         throw new Error("Geçersiz API yanıtı (message nesnesi eksik).");
      }
      
      contentType = typeof messageObj.content;
      if (typeof messageObj.content === 'string') {
        aiResponseText = messageObj.content;
      } else if (Array.isArray(messageObj.content)) {
        aiResponseText = messageObj.content.map((part: any) => part.text || part.content || '').join('');
      }

      reasoningContent = messageObj.reasoning_content || '';
      finishReason = data.choices[0].finish_reason;
    }
    // Loglama
    let logMessage = `[API Task] Correction Response Info:\n` +
      `- finish_reason: ${finishReason}\n` +
      `- content type: ${contentType}\n` +
      `- content length: ${aiResponseText.length}\n` +
      `- reasoning_content length: ${reasoningContent.length}`;
      
    if (import.meta.env.DEV) {
      logMessage += `\n- preview: ${aiResponseText.substring(0, 300).replace(/\n/g, ' ')}...`;
    }
    
    console.log(logMessage);

    if (finishReason === 'length') {
      throw new Error("Düzeltme cevabı çıktı token sınırında kesildi. API ayarlarındaki \"Düzeltme çıktı token limiti\" değerini artırın.");
    }
    if (finishReason === 'content_filter') {
       throw new Error("İçerik filtrelemesi nedeniyle yanıt alınamadı.");
    }
    
    if (!aiResponseText || aiResponseText.trim() === '') {
      if (reasoningContent && reasoningContent.trim() !== '') {
        throw new Error("Model yalnızca akıl yürütme içeriği döndürdü; nihai JSON cevap bulunamadı.");
      }
      throw new Error("EMPTY_API_RESPONSE: API yanıtı içerik barındırmıyor.");
    }

    chrome.runtime.sendMessage({
      type: 'API_CORRECTION_PROGRESS',
      taskId,
      videoId,
      stage: 'parsing',
      message: 'Yapay zeka yanıtı ayrıştırılıyor...',
      elapsedMs: Math.round(performance.now() - startedAt)
    }).catch(console.error);

    const sentences = CorrectionResponseParser.parse(aiResponseText, finishReason);
    const enrichedSentences = CorrectionResponseParser.enrichCorrectedSentences(
      sentences,
      request.transcript.segments,
      request.transcript.sourceLanguage
    );
    
    const finalResult = {
      sentences: enrichedSentences,
      latencyMs,
      timestamp: Date.now()
    };
    
    console.log(`[API Task] correction completed`);
    
    chrome.runtime.sendMessage({
        type: 'API_CORRECTION_COMPLETED',
        taskId,
        videoId,
        result: finalResult
    }).catch(e => {
        console.error(`[API Task] correction delivery failed:`, e);
    });
    
  } catch (e: any) {
    const isTimeout = e.message === 'Timeout';
    const isAbort = e.name === 'AbortError' || e.message === 'AbortError';
    
    let stage = 'unknown';
    let errorCode = isAbort ? 'REQUEST_CANCELLED' : (isTimeout ? 'TIMEOUT' : 'UNKNOWN_ERROR');
    
    if (e.code === 'CORRECTION_LANGUAGE_MISSING' || e.message.includes('Düzeltme sonucu geçersiz') || e.message.includes('Aralık')) {
      stage = 'validation';
      if (e.code) errorCode = e.code;
    } else if (e.message.includes('JSON olarak ayrıştırılamadı') || e.message.includes('sentences dizisi bulunamadı') || e.message.includes('işlenirken hata oluştu')) {
      stage = 'parsing';
    } else if (e.message.includes('Bağlantı hatası')) {
      stage = 'http';
    } else if (e.message.includes('stream') || e.message.includes('JSON yanıt akışı')) {
      stage = 'streaming';
    }
    
    const userMsg = isAbort ? 'İstek iptal edildi.' : (isTimeout ? 'İstek zaman aşımına uğradı.' : (e.message || 'Beklenmeyen hata.'));
    
    console.error("[ZYouTube Correction Error]", {
      taskId,
      videoId,
      stage,
      errorCode,
      message: e.message,
      model: config.model,
      elapsedMs: Math.round(performance.now() - startedAt),
      diagnostics: e.diagnostics
    });
    
    chrome.runtime.sendMessage({
        type: 'API_CORRECTION_FAILED',
        taskId,
        videoId,
        error: {
            code: errorCode,
            stage,
            userMessage: userMsg,
            technicalMessage: e.message,
            diagnostics: e.diagnostics,
            retryable: !isAbort
        }
    }).catch(err => console.error(err));
  } finally {
    const task = activeTasks.get(taskId);
    if (task) {
      window.clearTimeout(task.timeoutId);
      window.clearInterval(task.heartbeatId);
      activeTasks.delete(taskId);
    }
    resetIdleTimer();
  }
}

