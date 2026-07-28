import { PromptBuilder } from '../ai/prompt-builder';
import { ResponseParser } from '../ai/response-parser';
import { CorrectionPromptBuilder } from '../ai/prompt-correction';
import { CorrectionResponseParser } from '../ai/correction-parser';
import {
  CorrectionResponseTimeoutError,
  readCorrectionResponse,
  type CorrectionReadMetrics,
  type CorrectionTimeoutKind
} from './correction-response-reader';


export type NormalizedCorrectionError = {
  name: string;
  message: string;
  code: string;
  stack?: string;
  diagnostics?: Record<string, unknown>;
};

export function normalizeUnknownError(
  value: unknown
): NormalizedCorrectionError {
  if (value instanceof Error) {
    const extended = value as Error & {
      code?: string;
      diagnostics?: Record<string, unknown>;
    };

    return {
      name: value.name || "Error",
      message: value.message || "Bilinmeyen hata",
      code: extended.code || "UNKNOWN_ERROR",
      stack: value.stack,
      diagnostics: extended.diagnostics
    };
  }

  if (typeof value === "string") {
    return {
      name: "NonErrorThrown",
      message: value,
      code: "NON_ERROR_THROWN"
    };
  }

  try {
    return {
      name: "NonErrorThrown",
      message: JSON.stringify(value),
      code: "NON_ERROR_THROWN"
    };
  } catch {
    return {
      name: "NonErrorThrown",
      message: String(value),
      code: "NON_ERROR_THROWN"
    };
  }
}

export function createCorrectionError(
  code: string,
  message: string,
  diagnostics?: Record<string, unknown>
) {
  const error = new Error(message) as any;
  error.code = code;
  if (diagnostics) {
    error.diagnostics = diagnostics;
  }
  return error;
}

function normalizeSafeMetadataToken(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const token = String(value);
  return /^[A-Za-z0-9._:/-]{1,128}$/.test(token) ? token : undefined;
}

function createHttpDiagnostics(response: Response, rawText: string, contentType: string) {
  let providerErrorCode: string | undefined;
  let providerErrorType: string | undefined;

  try {
    const parsed = JSON.parse(rawText);
    providerErrorCode = normalizeSafeMetadataToken(parsed?.error?.code ?? parsed?.code);
    providerErrorType = normalizeSafeMetadataToken(parsed?.error?.type ?? parsed?.type);
  } catch {
    // Non-JSON bodies are intentionally not retained.
  }

  const requestId = normalizeSafeMetadataToken(
    response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    response.headers.get('cf-ray')
  );

  return {
    httpStatus: response.status,
    statusText: response.statusText,
    contentType,
    bodyCharacterCount: rawText.length,
    ...(providerErrorCode ? { providerErrorCode } : {}),
    ...(providerErrorType ? { providerErrorType } : {}),
    ...(requestId ? { requestId } : {})
  };
}

interface CorrectionAbortState {
  timedOut?: boolean;
  userCancelled?: boolean;
  timeoutKind?: CorrectionTimeoutKind;
}

export function classifyCorrectionError(
  normalized: NormalizedCorrectionError,
  abortState: CorrectionAbortState = {}
): { code: string, stage: string, retryable: boolean } {
    let stage = 'unknown';
    let code = normalized.code;
    
    if (abortState.timedOut || normalized.code === 'CORRECTION_TIMEOUT') {
      code = 'CORRECTION_TIMEOUT';
    } else if (abortState.userCancelled) {
      code = 'CORRECTION_CANCELLED';
    } else if (
      normalized.name === 'AbortError' ||
      normalized.message === 'AbortError'
    ) {
      code = 'CORRECTION_STREAM_READ_FAILED';
    }

    if (code === 'CORRECTION_HTTP_ERROR' || code === 'CORRECTION_HTTP_504' || code.startsWith('HTTP_')) stage = 'http';
    else if (code === 'CORRECTION_STREAM_READ_FAILED' || code.includes('STREAM_')) stage = 'streaming';
    else if (code === 'CORRECTION_EMPTY_RESPONSE' || code === 'CORRECTION_JSON_PARSE_FAILED' || code === 'CORRECTION_FINAL_CONTENT_MISSING') stage = 'parsing';
    else if (['CORRECTION_SCHEMA_INVALID', 'CORRECTION_RANGE_INVALID', 'CORRECTION_LANGUAGE_MISSING', 'CORRECTION_SEGMENT_COVERAGE_INVALID'].includes(code)) stage = 'validation';
    else if (code === 'CORRECTION_CANCELLED') stage = 'cancelled';
    else if (code === 'CORRECTION_TIMEOUT') stage = 'timeout';
    else code = 'CORRECTION_UNKNOWN';
    
    const retryable = code !== 'CORRECTION_CANCELLED';
    
    return { code, stage, retryable };
}

interface TaskContext {
  controller: AbortController;
  heartbeatId: number;
  timeoutId: number;
  startedAt: number;
  timedOut?: boolean;
  userCancelled?: boolean;
  timeoutKind?: CorrectionTimeoutKind;
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
      task.userCancelled = true;
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
      let rawText = '';
      const contentType = response.headers.get('content-type') || 'unknown';
      try {
        rawText = await response.text();
      } catch { /* ignore */ }

      const err = new Error(`API error: ${response.status} ${response.statusText}`);
      (err as any).code = 'API_ERROR';
      (err as any).diagnostics = createHttpDiagnostics(
        response,
        rawText,
        contentType
      );
      throw err;
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
    
    const errorCode = isAbort ? 'REQUEST_CANCELLED' : (isTimeout ? 'TIMEOUT' : (e.code || 'UNKNOWN_ERROR'));
    const userMsg = isAbort ? 'İstek kullanıcı tarafından iptal edildi.' : (isTimeout ? 'İstek zaman aşımına uğradı. İşlem çok uzun sürdü.' : (e.message || 'Beklenmeyen bir hata oluştu.'));
    
    chrome.runtime.sendMessage({
        type: 'API_SUMMARY_FAILED',
        taskId,
        videoId,
        error: {
            code: errorCode,
            userMessage: userMsg,
            retryable: !isAbort,
            ...(e?.diagnostics ? { diagnostics: e.diagnostics } : {})
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
  const taskContext: TaskContext = {
    controller,
    heartbeatId,
    timeoutId: 0,
    startedAt,
    timedOut: false,
    userCancelled: false
  };
  taskContext.timeoutId = window.setTimeout(() => {
    taskContext.timedOut = true;
    taskContext.timeoutKind = 'total';
    controller.abort(new Error('Correction total timeout'));
  }, timeoutMs);

  activeTasks.set(taskId, taskContext);
  
  chrome.runtime.sendMessage({ type: 'API_CORRECTION_ACCEPTED', taskId }).catch(console.error);
  resetIdleTimer();

  let aiResponseText = '';
  let finishReason = '';
  let reasoningContent = '';
  let streamDoneReceived = false;
  let sseEventCount = 0;
  let contentChunkCount = 0;
  let responseContentType = 'unknown';
  let readMetrics: CorrectionReadMetrics = {
    contentType: 'unknown',
    firstByteMs: null,
    chunkCount: 0,
    receivedBytes: 0,
    receivedCharacters: 0,
    lastSseEventAtMs: null,
    sseEventCount: 0,
    contentChunkCount: 0
  };

  try {
    console.log(`[API Task] offscreen correction started for task ${taskId}`);
    
    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    const body = CorrectionPromptBuilder.buildApiRequestBody(request, config);

    console.log(`[API Task] correction POST started`);
    
    const inputChars = JSON.stringify(body).length;
    const maxOutputTokens = body.max_tokens ?? body.max_completion_tokens;
    console.log(`[Correction Request]
segmentCount: ${request.transcript.segments.length}
inputCharacters: ${inputChars}
estimatedInputTokens: ${Math.round(inputChars / 4)}
maxOutputTokens: ${maxOutputTokens}
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
    responseContentType =
      response.headers?.get?.('content-type') || 'unknown';
    console.log(
      `[API Task] correction response headers: status=${response.status}, ` +
      `contentType=${responseContentType}, headersMs=${latencyMs}`
    );

    if (!response.ok) {
      let rawText = '';
      let respContentType = response.headers.get('content-type') || 'unknown';
      try {
        rawText = await response.text();
      } catch { /* ignore */ }
      const diagnostics = createHttpDiagnostics(response, rawText, respContentType);

      if (response.status === 504) {
        throw createCorrectionError(
          'CORRECTION_HTTP_504',
          'API sağlayıcısı düzeltme isteğini zamanında tamamlayamadı (504).',
          diagnostics
        );
      } else {
        throw createCorrectionError(
          'CORRECTION_HTTP_ERROR',
          `Düzeltme API isteği başarısız oldu: ${response.status}`,
          diagnostics
        );
      }
    }

    try {
      const readResult = await readCorrectionResponse(response, {
        expectedStreaming: Boolean(body.stream),
        firstByteTimeoutMs:
          config.correctionFirstByteTimeoutMs ?? 60000,
        streamIdleTimeoutMs:
          config.correctionStreamIdleTimeoutMs ?? 45000,
        requestStartedAtMs: fetchStart,
        onProgress: (metrics) => {
          chrome.runtime.sendMessage({
            type: 'API_CORRECTION_PROGRESS',
            taskId,
            videoId,
            stage: 'streaming',
            message:
              `Yanıt alınıyor... ${metrics.receivedCharacters} karakter`,
            elapsedMs: Math.round(performance.now() - startedAt)
          }).catch(console.error);
        }
      });

      aiResponseText = readResult.content;
      reasoningContent = readResult.reasoningContent;
      finishReason = readResult.finishReason;
      streamDoneReceived = readResult.streamDoneReceived;
      readMetrics = readResult.metrics;
      sseEventCount = readMetrics.sseEventCount;
      contentChunkCount = readMetrics.contentChunkCount;

      if (
        body.stream &&
        readResult.transport === 'sse' &&
        !streamDoneReceived &&
        !finishReason
      ) {
        throw createCorrectionError(
          'CORRECTION_STREAM_READ_FAILED',
          'API yanıt akışı tamamlanma işareti olmadan kapandı.',
          {
            ...readMetrics,
            streamDoneReceived,
            finishReason
          }
        );
      }
    } catch (error) {
      if (error instanceof CorrectionResponseTimeoutError) {
        taskContext.timedOut = true;
        taskContext.timeoutKind = error.timeoutKind;
        if (!controller.signal.aborted) controller.abort(error);
      }
      throw error;
    }

    console.log(
      `[API Task] correction response metrics: ` +
      `status=${response.status}, contentType=${responseContentType}, ` +
      `firstByteMs=${readMetrics.firstByteMs ?? 'none'}, ` +
      `chunks=${readMetrics.chunkCount}, bytes=${readMetrics.receivedBytes}, ` +
      `characters=${readMetrics.receivedCharacters}, ` +
      `lastSseEventAtMs=${readMetrics.lastSseEventAtMs ?? 'none'}, ` +
      `sseEvents=${sseEventCount}, finishReason=${finishReason || 'none'}`
    );
    
    if (finishReason === 'length') {
      throw new Error("Düzeltme cevabı çıktı token sınırında kesildi. API ayarlarındaki \"Düzeltme çıktı token limiti\" değerini artırın.");
    }
    if (finishReason === 'content_filter') {
       throw new Error("İçerik filtrelemesi nedeniyle yanıt alınamadı.");
    }
    
    if (!aiResponseText || aiResponseText.trim() === '') {
      if (reasoningContent && reasoningContent.trim() !== '') {
        throw createCorrectionError('CORRECTION_FINAL_CONTENT_MISSING', "Model yalnızca akıl yürütme içeriği döndürdü; nihai JSON cevap bulunamadı.");
      }
      throw createCorrectionError('CORRECTION_EMPTY_RESPONSE', "API yanıtı içerik barındırmıyor.");
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
    const normalized = normalizeUnknownError(e);
    const { code, stage, retryable } = classifyCorrectionError(
      normalized,
      taskContext
    );
    
    let userMsg = normalized.message;
    if (code === 'CORRECTION_CANCELLED') userMsg = 'İstek iptal edildi.';
    else if (code === 'CORRECTION_TIMEOUT') userMsg = 'İstek zaman aşımına uğradı.';
    
    const logData = {
      taskId,
      videoId,
      code,
      stage,
      message: normalized.message,
      model: config.model || 'unknown',
      httpStatus:
        normalized.diagnostics?.httpStatus ??
        normalized.diagnostics?.status ??
        null,
      finishReason: finishReason || null,
      streamDoneReceived,
      sseEventCount,
      contentChunkCount,
      responseCharacters: aiResponseText.length,
      responseContentType,
      firstByteMs: readMetrics.firstByteMs,
      chunkCount: readMetrics.chunkCount,
      receivedBytes: readMetrics.receivedBytes,
      receivedCharacters: readMetrics.receivedCharacters,
      lastSseEventAtMs: readMetrics.lastSseEventAtMs,
      timeoutKind: taskContext.timeoutKind || null,
      elapsedMs: Math.round(performance.now() - startedAt),
      diagnostics: normalized.diagnostics || null
    };

    console.error(`[ZYouTube Correction Error]\n${JSON.stringify(logData, null, 2)}`);
    
    chrome.runtime.sendMessage({
        type: 'API_CORRECTION_FAILED',
        taskId,
        videoId,
        error: {
            code,
            stage,
            userMessage: userMsg,
            technicalMessage: normalized.message,
            diagnostics: normalized.diagnostics || {},
            httpStatus: logData.httpStatus,
            finishReason: logData.finishReason,
            streamDoneReceived: logData.streamDoneReceived,
            responseCharacters: logData.responseCharacters,
            responseContentType: logData.responseContentType,
            firstByteMs: logData.firstByteMs,
            chunkCount: logData.chunkCount,
            receivedBytes: logData.receivedBytes,
            receivedCharacters: logData.receivedCharacters,
            lastSseEventAtMs: logData.lastSseEventAtMs,
            timeoutKind: logData.timeoutKind,
            elapsedMs: logData.elapsedMs,
            retryable
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

