import {
  AIProvider,
  AIProviderId,
  SummaryRequest,
  SummaryResult,
  ProviderValidationResult,
  ConnectionTestResult,
  ProviderExecutionContext
} from '../types';
import { AIProviderError } from '../errors';
import { PromptBuilder } from '../prompt-builder';
import { ResponseParser } from '../response-parser';
import { AISettingsService } from '../../settings/ai-settings';

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: AIProviderId = 'openai-compatible';
  readonly displayName = 'OpenAI Compatible API';

  async isConfigured(): Promise<boolean> {
    const config = await AISettingsService.getProviderConfig(this.id);
    return !!(config?.apiKey && config?.baseUrl);
  }

  async validateConfiguration(): Promise<ProviderValidationResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    const errors: string[] = [];
    if (!config?.apiKey) errors.push('API anahtarı eksik.');
    if (!config?.baseUrl) errors.push('Base URL eksik.');
    
    return { isValid: errors.length === 0, errors };
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey || !config?.baseUrl) {
      return { success: false, message: 'API anahtarı veya Base URL yapılandırılmamış.' };
    }

    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    try {
      const payload = {
        model: config.model || 'deepseek-chat',
        messages: [{ role: 'user', content: 'Merhaba, bu bir test mesajıdır. Lütfen API bağlantısının başarılı olduğunu belirten çok kısa bir Türkçe özet yanıt ver.' }],
        max_tokens: 50
      };

      const start = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          ...config.customHeaders
        },
        body: JSON.stringify(payload),
        signal
      });
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        let errorMsg = res.statusText;
        try {
          const rawText = await res.text();
          try {
            const errorData = JSON.parse(rawText);
            errorMsg = errorData?.error?.message || errorData?.message || rawText.slice(0, 500);
          } catch {
            errorMsg = rawText.slice(0, 500);
          }
        } catch {
          /* ignore */
        }
        return { success: false, message: `Bağlantı hatası: ${res.status} ${errorMsg}` };
      }

      let aiResponseText = '';
      try {
        const data = await res.json();
        aiResponseText = data.choices?.[0]?.message?.content || '';
      } catch (e) {}

      const limitRequests = res.headers.get('x-ratelimit-remaining-requests') || res.headers.get('x-ratelimit-limit-requests') || res.headers.get('ratelimit-remaining') || res.headers.get('x-ratelimit-remaining');
      const limitTokens = res.headers.get('x-ratelimit-remaining-tokens') || res.headers.get('x-ratelimit-limit-tokens') || res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
      let limitsStr = '';
      if (limitRequests || limitTokens) {
        limitsStr = `İstek: ${limitRequests || '?'} | Token: ${limitTokens || '?'}`;
      }

      return { success: true, latencyMs, limits: limitsStr, message: aiResponseText };
    } catch (e: any) {
      if (e.name === 'AbortError') return { success: false, message: 'İstek iptal edildi.' };
      return { success: false, message: e.message || 'Bilinmeyen bağlantı hatası.' };
    }
  }

  async summarize(request: SummaryRequest, context: ProviderExecutionContext): Promise<SummaryResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey || !config?.baseUrl) {
      throw new AIProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        userMessage: 'OpenAI uyumlu sağlayıcı yapılandırılmamış.',
        retryable: false,
        providerId: this.id
      });
    }

    let urlStr = config.baseUrl;
    while (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = urlStr.endsWith('/chat/completions') ? urlStr : `${urlStr}/chat/completions`;

    const model = config.model || 'gpt-3.5-turbo';
    const systemPrompt = PromptBuilder.buildSystemPrompt(request, context.promptType);
    const userPrompt = PromptBuilder.buildUserPrompt(request, context.promptType, context.customContent);

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
      // NVIDIA deepseek-v4-flash NIM settings
      body.chat_template_kwargs = { thinking: true, reasoning_effort: "high" };
    } else if (config.responseMode === 'json') {
      body.response_format = { type: 'json_object' };
    }

    let controller = new AbortController();
    let onParentAbort: (() => void) | null = null;
    if (context.signal) {
      onParentAbort = () => controller.abort();
      context.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    // Default 180s, minimum 60s — NVIDIA NIM gibi yavaş API'ler için yeterli süre
    const timeoutMs = Math.max(config.timeoutMs || 180000, 60000);
    const timeoutId = setTimeout(() => {
       controller.abort(new Error('Timeout'));
    }, timeoutMs);

    try {
      if (context.onProgress) context.onProgress('Özetleniyor...', 50);

      const doFetch = async (retryCount: number = 0): Promise<Response> => {
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

        // 429 Rate Limit için tek seferlik retry
        if (response.status === 429 && retryCount < 1) {
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader
            ? (parseInt(retryAfterHeader, 10) || 10) * 1000
            : 10000; // Default 10 saniye
          const waitMs = Math.min(retryAfterMs, 30000); // Max 30s bekle
          
          if (context.onProgress) {
            context.onProgress(`Rate limit aşıldı, ${Math.ceil(waitMs/1000)}s sonra yeniden deneniyor...`, 30);
          }
          await new Promise(r => setTimeout(r, waitMs));
          return doFetch(retryCount + 1);
        }

        // 503 Service Unavailable için tek seferlik retry
        if (response.status === 503 && retryCount < 1) {
          if (context.onProgress) {
            context.onProgress('Sunucu meşgul, 5s sonra yeniden deneniyor...', 30);
          }
          await new Promise(r => setTimeout(r, 5000));
          return doFetch(retryCount + 1);
        }

        return response;
      };

      const response = await doFetch();

      clearTimeout(timeoutId);

      // Abort listener temizliği (memory leak önleme)
      if (onParentAbort && context.signal) {
        context.signal.removeEventListener('abort', onParentAbort);
      }

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json();
      if (!data.choices || data.choices.length === 0) {
        throw new AIProviderError({
          code: 'INVALID_RESPONSE',
          userMessage: 'API boş yanıt döndürdü.',
          retryable: true,
          providerId: this.id
        });
      }

      const choice = data.choices[0];
      if (choice.finish_reason === 'content_filter') {
        throw new AIProviderError({
          code: 'CONTENT_BLOCKED',
          userMessage: 'İçerik güvenlik filtresi tarafından engellendi.',
          retryable: false,
          providerId: this.id
        });
      }

      let text = choice.message?.content;
      
      // NVIDIA deepseek gibi modeller sadece reasoning_content döndürebilir
      // Bu durumda reasoning'i content olarak kullan (hata fırlatmak yerine)
      if (!text && choice.message?.reasoning_content) {
        console.warn('[ZYouTube] API sadece reasoning_content döndürdü, içerik olarak kullanılıyor.');
        text = choice.message.reasoning_content;
      }
      
      text = text || '';
      
      const parsedResult = ResponseParser.parseAndValidate(
        text,
        request.taskId,
        request.video.videoId,
        this.id,
        model,
        request.options,
        request.video.durationMs || undefined,
        request.transcript.segments
      );

      if (data.usage) {
        parsedResult.usage = {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        };
      }

      return parsedResult;
    } catch (e: any) {
      clearTimeout(timeoutId);

      // Abort listener temizliği
      if (onParentAbort && context.signal) {
        context.signal.removeEventListener('abort', onParentAbort);
      }

      if (e instanceof AIProviderError) throw e;

      if (e.name === 'AbortError' || e.message === 'Timeout') {
        const isTimeout = e.message === 'Timeout';
        throw new AIProviderError({
          code: isTimeout ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
          userMessage: isTimeout 
            ? `İstek ${Math.round(timeoutMs/1000)} saniye sonra zaman aşımına uğradı. Daha kısa bir transkript veya daha hızlı bir model deneyebilirsiniz.`
            : 'İstek iptal edildi.',
          retryable: isTimeout,
          providerId: this.id,
          debugMessage: e.toString()
        });
      }

      throw new AIProviderError({
        code: 'NETWORK_ERROR',
        userMessage: 'Ağ veya bağlantı hatası oluştu. İnternet bağlantınızı kontrol edin.',
        retryable: true,
        providerId: this.id,
        debugMessage: e.toString()
      });
    }
  }

  private async handleErrorResponse(response: Response) {
    let message = response.statusText;
    try {
      const rawText = await response.text();
      try {
        const errorData = JSON.parse(rawText);
        message = errorData?.error?.message || errorData?.message || rawText.slice(0, 500);
      } catch {
        message = rawText.slice(0, 500);
      }
    } catch {
      /* ignore */
    }

    if (response.status === 401) {
      throw new AIProviderError({
        code: 'INVALID_API_KEY',
        userMessage: 'Geçersiz API Anahtarı.',
        retryable: false,
        providerId: this.id,
        statusCode: 401
      });
    }
    if (response.status === 404) {
      throw new AIProviderError({
        code: 'MODEL_NOT_FOUND',
        userMessage: 'Model bulunamadı veya Base URL yanlış.',
        retryable: false,
        providerId: this.id,
        statusCode: 404
      });
    }
    if (response.status === 429) {
      // Retry-after header bilgisi varsa kullanıcıya bildir
      const retryAfter = response.headers.get('retry-after');
      const remaining = response.headers.get('x-ratelimit-remaining-requests') || response.headers.get('ratelimit-remaining');
      let userMsg = 'Kota aşıldı veya Rate Limit sınırına takıldınız.';
      if (retryAfter) {
        userMsg += ` ${retryAfter} saniye sonra tekrar deneyin.`;
      }
      if (remaining) {
        userMsg += ` (Kalan istek: ${remaining})`;
      }
      throw new AIProviderError({
        code: 'QUOTA_EXCEEDED',
        userMessage: userMsg,
        retryable: true,
        providerId: this.id,
        statusCode: 429
      });
    }

    throw new AIProviderError({
      code: 'UNKNOWN_ERROR',
      userMessage: `Bilinmeyen sunucu hatası: ${response.status}`,
      retryable: response.status >= 500,
      providerId: this.id,
      statusCode: response.status,
      debugMessage: message
    });
  }
}
