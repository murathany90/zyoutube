import { PromptBuilder } from '../ai/prompt-builder';
import { ResponseParser } from '../ai/response-parser';

let activeAbortController: AbortController | null = null;
let heartbeatInterval: number | null = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'API_SUMMARY_START') {
    handleApiSummaryStart(message.taskId, message.videoId, message.request, message.config);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'API_SUMMARY_CANCEL') {
    if (activeAbortController) {
      activeAbortController.abort(new Error('AbortError'));
      activeAbortController = null;
    }
    clearHeartbeat();
    sendResponse({ success: true });
    return true;
  }
});

function startHeartbeat(taskId: string, videoId: string) {
  clearHeartbeat();
  heartbeatInterval = window.setInterval(() => {
    chrome.runtime.sendMessage({
      type: 'API_SUMMARY_HEARTBEAT',
      taskId,
      videoId
    }).catch(console.error);
  }, 15000);
}

function clearHeartbeat() {
  if (heartbeatInterval !== null) {
    window.clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

async function handleApiSummaryStart(taskId: string, videoId: string, request: any, config: any) {
  try {
    activeAbortController = new AbortController();
    startHeartbeat(taskId, videoId);
    
    console.log(`[API Task] offscreen started for task ${taskId}`);
    
    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    const model = config.model || 'gpt-3.5-turbo';
    const systemPrompt = PromptBuilder.buildSystemPrompt(request, undefined);
    const userPrompt = PromptBuilder.buildUserPrompt(request, undefined, undefined);

    const isNvidiaNIM = urlStr.includes('integrate.api.nvidia.com') || urlStr.includes('nvcr.io');
    
    const body: any = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens,
    };
    
    if (isNvidiaNIM && model.includes('deepseek')) {
      body.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
    } else if (config.responseMode === 'json') {
      body.response_format = { type: 'json_object' };
    }

    const timeoutMs = config.timeoutMs ?? 180000;
    const timeoutId = setTimeout(() => {
       if (activeAbortController) {
           activeAbortController.abort(new Error('Timeout'));
       }
    }, timeoutMs);

    console.log(`[API Task] POST started`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        ...config.customHeaders
      },
      body: JSON.stringify(body),
      signal: activeAbortController.signal
    });
    
    clearTimeout(timeoutId);
    console.log(`[API Task] HTTP status ${response.status}`);
    const latencyMs = 0;

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
    try {
      const data = await response.json();
      aiResponseText = data.choices?.[0]?.message?.content || '';
    } catch (e) {}

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
    
    if (request.transcript.warnings) {
        finalResult.warnings = finalResult.warnings || [];
        finalResult.warnings.push(...request.transcript.warnings);
    }
    
    console.log(`[API Task] completed`);
    clearHeartbeat();
    activeAbortController = null;
    
    chrome.runtime.sendMessage({
        type: 'API_SUMMARY_COMPLETED',
        taskId,
        videoId,
        result: finalResult
    }).catch(e => {
        console.error(`[API Task] delivery failed for task ${taskId}:`, e);
    });
    
  } catch (e: any) {
    console.log(`[API Task] failed:`, e);
    clearHeartbeat();
    activeAbortController = null;
    const isAbort = e.name === 'AbortError' || e.message === 'AbortError' || e.message === 'Timeout';
    
    if (isAbort) {
        chrome.runtime.sendMessage({
            type: 'API_SUMMARY_FAILED',
            taskId,
            videoId,
            error: {
                code: 'REQUEST_CANCELLED',
                userMessage: 'İstek iptal edildi.',
                retryable: false
            }
        }).catch(err => {
            console.error(`[API Task] delivery failed for task ${taskId}:`, err);
        });
    } else {
        chrome.runtime.sendMessage({
            type: 'API_SUMMARY_FAILED',
            taskId,
            videoId,
            error: {
                code: 'UNKNOWN_ERROR',
                userMessage: e.message || 'Beklenmeyen bir hata oluştu.',
                retryable: true
            }
        }).catch(err => {
            console.error(`[API Task] delivery failed for task ${taskId}:`, err);
        });
    }
  }
}
