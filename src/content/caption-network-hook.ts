interface CaptionCaptureArmMessage {
  source: "zyoutube-isolated";
  type: "ZY_CAPTION_CAPTURE_ARM";
  requestId: string;
  videoId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  expiresAt: number;
}

interface CaptionCaptureResultMessage {
  source: "zyoutube-main";
  type: "ZY_CAPTION_CAPTURE_RESULT";
  requestId: string;
  videoId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  resolvedLanguage: string;
  url: string;
  httpStatus: number;
  contentType: string;
  rawText: string;
}

let activeCapture: CaptionCaptureArmMessage | null = null;
let captureTimeoutId: number | null = null;

function languageMatches(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const normalizedActual = actual.toLowerCase();
  const normalizedExpected = expected.toLowerCase();
  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(`${normalizedExpected}-`) ||
    normalizedExpected.startsWith(`${normalizedActual}-`)
  );
}

function clearActiveCapture() {
  activeCapture = null;
  if (captureTimeoutId !== null) {
    window.clearTimeout(captureTimeoutId);
    captureTimeoutId = null;
  }
}

// Ensure hook is only installed once
if (!(window as any).__zyoutubeCaptionNetworkHookInstalled) {
  (window as any).__zyoutubeCaptionNetworkHookInstalled = true;

  // 1. Hook window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args as any);
    handleNetworkResponse(args[0], response.clone());
    return response;
  };

  // 2. Hook XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    (this as any)._zyUrl = url.toString();
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    this.addEventListener('load', () => {
      if ((this as any)._zyUrl && typeof this.responseText === 'string') {
        const urlStr = (this as any)._zyUrl;
        if (urlStr.includes('/api/timedtext')) {
          handleXHRResponse(urlStr, this.status, this.getResponseHeader('content-type') || '', this.responseText);
        }
      }
    });
    return (originalSend as any).apply(this, args);
  };

  // 3. Listen for ARM messages from isolated world
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    
    const data = event.data;
    if (data && data.source === "zyoutube-isolated" && data.type === "ZY_CAPTION_CAPTURE_ARM") {
      const msg = data as CaptionCaptureArmMessage;
      
      // Cleanup previous
      clearActiveCapture();
      
      if (Date.now() > msg.expiresAt) return; // Already expired
      
      activeCapture = msg;
      
      const remainingTime = msg.expiresAt - Date.now();
      captureTimeoutId = window.setTimeout(() => {
        if (activeCapture?.requestId === msg.requestId) {
          clearActiveCapture();
        }
      }, remainingTime);
    }
  });
}

function processCapturedText(urlStr: string, httpStatus: number, contentType: string, rawText: string) {
  if (!activeCapture) return;
  if (Date.now() > activeCapture.expiresAt) {
    clearActiveCapture();
    return;
  }

  let url: URL;
  try {
    url = new URL(urlStr, window.location.origin);
  } catch {
    return;
  }

  if (!url.pathname.includes("/api/timedtext")) return;

  const responseVideoId = url.searchParams.get("v");
  if (responseVideoId && responseVideoId !== activeCapture.videoId) return;

  const sourceLanguage = url.searchParams.get("lang");
  const targetLanguage = url.searchParams.get("tlang");

  const matches = activeCapture.targetLanguage
    ? languageMatches(targetLanguage, activeCapture.targetLanguage)
    : languageMatches(sourceLanguage, activeCapture.sourceLanguage) && !targetLanguage;

  if (!matches) return;

  // Ignore empty or HTML bodies
  if (!rawText || !rawText.trim()) return;
  const trimmed = rawText.trimStart();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) return;

  // Body length check (>5MB ignore, just in case)
  if (rawText.length > 5 * 1024 * 1024) return;

  // Send result
  const resolvedLanguage = activeCapture.targetLanguage ?? activeCapture.sourceLanguage;
  
  const resultMsg: CaptionCaptureResultMessage = {
    source: "zyoutube-main",
    type: "ZY_CAPTION_CAPTURE_RESULT",
    requestId: activeCapture.requestId,
    videoId: activeCapture.videoId,
    sourceLanguage: activeCapture.sourceLanguage,
    targetLanguage: activeCapture.targetLanguage,
    resolvedLanguage: resolvedLanguage,
    url: urlStr,
    httpStatus,
    contentType,
    rawText
  };

  window.postMessage(resultMsg, "*");
  
  // Cleanup after success
  clearActiveCapture();
}

async function handleNetworkResponse(input: RequestInfo | URL, clonedResponse: Response) {
  try {
    if (!activeCapture) return; // Fast exit
    
    let urlStr = '';
    if (typeof input === 'string') urlStr = input;
    else if (input instanceof URL) urlStr = input.toString();
    else if (input instanceof Request) urlStr = input.url;
    
    if (!urlStr.includes('/api/timedtext')) return;
    
    const text = await clonedResponse.text();
    processCapturedText(urlStr, clonedResponse.status, clonedResponse.headers.get('content-type') || '', text);
  } catch (e) {
    // Ignore clone/read errors
  }
}

function handleXHRResponse(urlStr: string, status: number, contentType: string, text: string) {
  try {
    processCapturedText(urlStr, status, contentType, text);
  } catch (e) {
    // Ignore parsing errors
  }
}
