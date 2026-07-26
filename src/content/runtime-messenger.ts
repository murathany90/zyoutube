export type RuntimeErrorCode =
  | 'EXTENSION_CONTEXT_INVALIDATED'
  | 'BACKGROUND_UNAVAILABLE'
  | 'BACKGROUND_TIMEOUT'
  | 'BACKGROUND_VERSION_MISMATCH'
  | 'REQUEST_CANCELLED';

export class RuntimeMessengerError extends Error {
  constructor(
    public code: RuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'RuntimeMessengerError';
  }
}

export interface RuntimeMessageOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const errorLogCache = new Map<string, number>();
function shouldLog(key: string): boolean {
  const now = Date.now();
  const last = errorLogCache.get(key);
  if (last && now - last < 5000) return false;
  errorLogCache.set(key, now);
  return true;
}

export async function sendRuntimeMessage<TPayload = any, TResponse = any>(
  message: TPayload,
  options?: RuntimeMessageOptions
): Promise<TResponse> {
  const timeoutMs = options?.timeoutMs ?? 3000;

  return new Promise<TResponse>((resolve, reject) => {
    try {
      if (!chrome?.runtime?.id) {
        reject(new RuntimeMessengerError('BACKGROUND_UNAVAILABLE', 'Extension context not available'));
        return;
      }

      let timedOut = false;

      if (options?.signal) {
        if (options.signal.aborted) {
          reject(new RuntimeMessengerError('REQUEST_CANCELLED', 'Request was cancelled'));
          return;
        }
        const onAbort = () => {
          timedOut = true;
          reject(new RuntimeMessengerError('REQUEST_CANCELLED', 'Request was cancelled'));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        reject(new RuntimeMessengerError('BACKGROUND_TIMEOUT', 'Background did not respond in time'));
      }, timeoutMs);

      chrome.runtime.sendMessage(message, (response: any) => {
        window.clearTimeout(timeoutId);

        if (timedOut) return;

        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          if (errMsg.includes('invalidated') || errMsg.includes('Extension context')) {
            if (shouldLog('invalidated')) {
              console.warn('ZYouTube: Extension context invalidated');
            }
            reject(new RuntimeMessengerError('EXTENSION_CONTEXT_INVALIDATED', 'Eklenti güncellendi. Lütfen sayfayı yenileyin.'));
          } else {
            reject(new RuntimeMessengerError('BACKGROUND_UNAVAILABLE', errMsg));
          }
        } else {
          resolve(response as TResponse);
        }
      });
    } catch (e: any) {
      if (e instanceof RuntimeMessengerError) {
        reject(e);
        return;
      }
      const errMsg = e.message || '';
      if (errMsg.includes('invalidated') || errMsg.includes('Extension context')) {
        if (shouldLog('invalidated')) {
          console.warn('ZYouTube: Extension context invalidated');
        }
        reject(new RuntimeMessengerError('EXTENSION_CONTEXT_INVALIDATED', 'Eklenti güncellendi. Lütfen sayfayı yenileyin.'));
      } else {
        reject(new RuntimeMessengerError('BACKGROUND_UNAVAILABLE', errMsg));
      }
    }
  });
}
