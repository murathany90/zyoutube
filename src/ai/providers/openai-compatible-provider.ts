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

    // OpenAI models endpoint test
    let urlStr = config.baseUrl;
    if (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = `${urlStr}/models`;

    try {
      const start = performance.now();
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          ...config.customHeaders
        },
        signal
      });
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
    if (!config?.apiKey || !config?.baseUrl) {
      throw new AIProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        userMessage: 'OpenAI uyumlu sağlayıcı yapılandırılmamış.',
        retryable: false,
        providerId: this.id
      });
    }

    let urlStr = config.baseUrl;
    if (urlStr.endsWith('/')) urlStr = urlStr.slice(0, -1);
    const url = `${urlStr}/chat/completions`;

    const model = config.model || 'gpt-3.5-turbo';
    const systemPrompt = PromptBuilder.buildSystemPrompt(request, context.promptType);
    const userPrompt = PromptBuilder.buildUserPrompt(request, context.promptType, context.customContent);

    const body = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' } // Bazı modeller desteklemez, ama standart için deniyoruz
    };

    let controller = new AbortController();
    if (context.signal) {
       context.signal.addEventListener('abort', () => controller.abort());
    }

    const timeoutId = setTimeout(() => {
       controller.abort(new Error('Timeout'));
    }, config.timeoutMs || 30000);

    try {
      if (context.onProgress) context.onProgress('Özetleniyor...', 50);

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

      clearTimeout(timeoutId);

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
      if (choice.finish_reason === 'length') {
         // Kısmen geldi, ne yapmalıyız? Şimdilik devam edelim.
      } else if (choice.finish_reason === 'content_filter') {
        throw new AIProviderError({
          code: 'CONTENT_BLOCKED',
          userMessage: 'İçerik güvenlik filtresi tarafından engellendi.',
          retryable: false,
          providerId: this.id
        });
      }

      const text = choice.message?.content || '';
      
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
