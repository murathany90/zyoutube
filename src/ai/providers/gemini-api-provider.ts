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

export class GeminiApiProvider implements AIProvider {
  readonly id: AIProviderId = 'gemini-api';
  readonly displayName = 'Gemini API';

  async isConfigured(): Promise<boolean> {
    const config = await AISettingsService.getProviderConfig(this.id);
    return !!config?.apiKey;
  }

  async validateConfiguration(): Promise<ProviderValidationResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey) {
      return { isValid: false, errors: ['API anahtarı eksik.'] };
    }
    return { isValid: true, errors: [] };
  }

  async testConnection(signal?: AbortSignal): Promise<ConnectionTestResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey) {
      return { success: false, message: 'API anahtarı yapılandırılmamış.' };
    }

    const model = config.model || 'gemini-2.5-flash';
    // Test endpoint using models.get or generateContent with empty text
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${config.apiKey}`;

    try {
      const start = performance.now();
      const res = await fetch(url, { signal });
      const latencyMs = Math.round(performance.now() - start);

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        return { success: false, message: `Bağlantı hatası: ${res.status} ${res.statusText} ${errorData?.error?.message || ''}` };
      }

      return { success: true, latencyMs };
    } catch (e: any) {
      if (e.name === 'AbortError') return { success: false, message: 'İstek iptal edildi.' };
      return { success: false, message: e.message || 'Bilinmeyen bağlantı hatası.' };
    }
  }

  async summarize(request: SummaryRequest, context: ProviderExecutionContext): Promise<SummaryResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey) {
      throw new AIProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        userMessage: 'Gemini API yapılandırılmamış.',
        retryable: false,
        providerId: this.id
      });
    }

    const model = config.model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;

    const systemPrompt = PromptBuilder.buildSystemPrompt(request);
    const userPrompt = PromptBuilder.buildUserPrompt(request);

    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens,
        responseMimeType: 'application/json'
      }
    };

    let controller = new AbortController();
    if (context.signal) {
       context.signal.addEventListener('abort', () => controller.abort());
    }

    // timeout handling
    const timeoutId = setTimeout(() => {
       controller.abort(new Error('Timeout'));
    }, config.timeoutMs || 30000);

    try {
      if (context.onProgress) context.onProgress('Özetleniyor...', 50);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json();
      if (!data.candidates || data.candidates.length === 0) {
        throw new AIProviderError({
          code: 'INVALID_RESPONSE',
          userMessage: 'API boş yanıt döndürdü.',
          retryable: true,
          providerId: this.id
        });
      }

      const candidate = data.candidates[0];
      if (candidate.finishReason === 'SAFETY') {
        throw new AIProviderError({
          code: 'CONTENT_BLOCKED',
          userMessage: 'İçerik güvenlik filtresi tarafından engellendi.',
          retryable: false,
          providerId: this.id
        });
      }

      const text = candidate.content?.parts?.[0]?.text || '';
      
      const parsedResult = ResponseParser.parseAndValidate(
        text,
        request.taskId,
        request.video.videoId,
        this.id,
        model,
        request.options
      );

      // Add token usage if available
      if (data.usageMetadata) {
        parsedResult.usage = {
          inputTokens: data.usageMetadata.promptTokenCount,
          outputTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount
        };
      }

      return parsedResult;
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e instanceof AIProviderError) throw e;

      if (e.name === 'AbortError' || e.message === 'Timeout') {
        throw new AIProviderError({
          code: e.message === 'Timeout' ? 'REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
          userMessage: e.message === 'Timeout' ? 'İstek zaman aşımına uğradı.' : 'İstek iptal edildi.',
          retryable: e.message === 'Timeout',
          providerId: this.id,
          debugMessage: e.toString()
        });
      }

      throw new AIProviderError({
        code: 'NETWORK_ERROR',
        userMessage: 'Ağ veya bağlantı hatası oluştu.',
        retryable: true,
        providerId: this.id,
        debugMessage: e.toString()
      });
    }
  }

  private async handleErrorResponse(response: Response) {
    let errorData = null;
    try {
      errorData = await response.json();
    } catch {
      /* ignore */
    }

    const message = errorData?.error?.message || response.statusText;

    if (response.status === 400 && message.includes('API key not valid')) {
      throw new AIProviderError({
        code: 'INVALID_API_KEY',
        userMessage: 'Geçersiz API Anahtarı.',
        retryable: false,
        providerId: this.id,
        statusCode: 400
      });
    }
    if (response.status === 404) {
      throw new AIProviderError({
        code: 'MODEL_NOT_FOUND',
        userMessage: 'Model bulunamadı.',
        retryable: false,
        providerId: this.id,
        statusCode: 404
      });
    }
    if (response.status === 429) {
      throw new AIProviderError({
        code: 'QUOTA_EXCEEDED',
        userMessage: 'Kota aşıldı veya Rate Limit sınırına takıldınız.',
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
