import { PromptBuilder } from '../ai/prompt-builder';
import { ResponseParser } from '../ai/response-parser';

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
    // 4. Offscreen kabul onayı
    chrome.runtime.sendMessage({ type: 'API_SUMMARY_ACCEPTED', taskId: message.taskId }).catch(console.error);
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
       finalResult.usage = usage;
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
    const isAbort = e.name === 'AbortError' || e.message === 'AbortError' || e.message === 'Timeout';
    
    const errorCode = isAbort ? 'REQUEST_CANCELLED' : 'UNKNOWN_ERROR';
    const userMsg = isAbort ? 'İstek iptal edildi.' : (e.message || 'Beklenmeyen bir hata oluştu.');
    
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
