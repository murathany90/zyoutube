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
import { CorrectionPromptBuilder } from '../prompt-correction';
import { CorrectionResponseParser } from '../correction-parser';
import { ResponseParser } from '../response-parser';
import { AISettingsService } from '../../settings/ai-settings';
import {
  CorrectionResponseTimeoutError,
  readCorrectionResponse
} from '../../offscreen/correction-response-reader';
import type { AIProviderConfig } from '../../settings/types';

type RequestType = 'summary' | 'correction';

interface SafeHttpMetadata {
  httpStatus: number;
  contentType: string;
  bodyCharacterCount: number;
  providerErrorCode?: string;
  providerErrorType?: string;
  requestId?: string;
}

function safeMetadataToken(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const token = String(value);
  return /^[A-Za-z0-9._:/-]{1,128}$/.test(token) ? token : undefined;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: AIProviderId = 'openai-compatible';
  readonly displayName = 'OpenAI Compatible API';

  async isConfigured(): Promise<boolean> {
    const config = await AISettingsService.getProviderConfig(this.id);
    return Boolean(config?.apiKey && config?.baseUrl);
  }

  async validateConfiguration(): Promise<ProviderValidationResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    const errors: string[] = [];
    if (!config?.apiKey) errors.push('API anahtarı eksik.');
    if (!config?.baseUrl) errors.push('Base URL eksik.');
    return { isValid: errors.length === 0, errors };
  }

  async testConnection(
    signal?: AbortSignal,
    requestType: RequestType = 'summary'
  ): Promise<ConnectionTestResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey || !config?.baseUrl) {
      return {
        success: false,
        message: 'API anahtarı veya Base URL yapılandırılmamış.'
      };
    }

    const summaryRequest = this.createConnectionSummaryRequest();
    const correctionRequest = {
      taskId: 'connection-correction',
      video: { videoId: 'connection-test', title: 'Connection Test' },
      transcript: {
        sourceLanguage: 'tr' as const,
        segments: [{
          id: 'segment-1',
          startTimeMs: 0,
          endTimeMs: 1000,
          turkish: 'Bu bir bağlantı testidir.',
          english: 'This is a connection test.'
        }]
      }
    };
    const body = requestType === 'correction'
      ? CorrectionPromptBuilder.buildApiRequestBody(correctionRequest, config)
      : PromptBuilder.buildApiRequestBody(summaryRequest, config);
    const startedAt = performance.now();

    try {
      const response = await fetch(this.getEndpoint(config.baseUrl), {
        method: 'POST',
        headers: this.getHeaders(config),
        body: JSON.stringify(body),
        signal
      });
      const latencyMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        const metadata = await this.readSafeHttpMetadata(response);
        return {
          success: false,
          latencyMs,
          message: this.safeConnectionErrorMessage(requestType, metadata)
        };
      }

      const readResult = await readCorrectionResponse(response, {
        expectedStreaming: Boolean(body.stream),
        firstByteTimeoutMs: requestType === 'correction'
          ? config.correctionFirstByteTimeoutMs ?? 60000
          : config.summaryFirstByteTimeoutMs ?? 60000,
        streamIdleTimeoutMs: requestType === 'correction'
          ? config.correctionStreamIdleTimeoutMs ?? 45000
          : config.summaryStreamIdleTimeoutMs ?? 45000,
        requestStartedAtMs: startedAt
      });

      if (!readResult.content.trim()) {
        return {
          success: false,
          latencyMs,
          message: `${this.requestTypeLabel(requestType)} yanıtında final içerik bulunamadı.`
        };
      }

      if (requestType === 'correction') {
        CorrectionResponseParser.parse(
          readResult.content,
          readResult.finishReason
        );
      } else {
        ResponseParser.parseAndValidate(
          readResult.content,
          summaryRequest.taskId,
          summaryRequest.video.videoId,
          this.id,
          config.model || 'default',
          summaryRequest.options,
          undefined,
          summaryRequest.transcript.segments
        );
      }

      return {
        success: true,
        latencyMs,
        limits: this.readRateLimits(response),
        message: `${this.requestTypeLabel(requestType)} istek formatı ve yanıt ayrıştırması doğrulandı.`
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return { success: false, message: 'İstek iptal edildi.' };
      }
      if (error instanceof CorrectionResponseTimeoutError) {
        return {
          success: false,
          message: `${this.requestTypeLabel(requestType)} yanıtı zaman aşımına uğradı (${error.timeoutKind}).`
        };
      }
      return {
        success: false,
        message: `${this.requestTypeLabel(requestType)} formatı doğrulanamadı.`
      };
    }
  }

  async summarize(
    request: SummaryRequest,
    context: ProviderExecutionContext
  ): Promise<SummaryResult> {
    const config = await AISettingsService.getProviderConfig(this.id);
    if (!config?.apiKey || !config?.baseUrl) {
      throw new AIProviderError({
        code: 'PROVIDER_NOT_CONFIGURED',
        userMessage: 'OpenAI uyumlu sağlayıcı yapılandırılmamış.',
        retryable: false,
        providerId: this.id
      });
    }

    const model = config.model || 'gpt-3.5-turbo';
    const body = PromptBuilder.buildApiRequestBody(
      request,
      config,
      context.customContent
    );
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort();

    if (context.signal?.aborted) {
      controller.abort();
    } else {
      context.signal?.addEventListener('abort', onParentAbort, { once: true });
    }

    const timeoutMs = Math.max(config.timeoutMs || 180000, 60000);
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Summary total timeout'));
    }, timeoutMs);

    try {
      context.onProgress?.('Özetleniyor...', 50);
      const requestStartedAt = performance.now();
      const response = await fetch(this.getEndpoint(config.baseUrl), {
        method: 'POST',
        headers: this.getHeaders(config),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) await this.handleErrorResponse(response);

      const readResult = await readCorrectionResponse(response, {
        expectedStreaming: Boolean(body.stream),
        firstByteTimeoutMs: config.summaryFirstByteTimeoutMs ?? 60000,
        streamIdleTimeoutMs: config.summaryStreamIdleTimeoutMs ?? 45000,
        requestStartedAtMs: requestStartedAt,
        onProgress: () => context.onProgress?.('Yanıt alınıyor...', 75)
      });

      if (
        body.stream &&
        readResult.transport === 'sse' &&
        !readResult.streamDoneReceived &&
        !readResult.finishReason
      ) {
        throw new AIProviderError({
          code: 'INVALID_RESPONSE',
          userMessage: 'API yanıt akışı tamamlanmadan kapandı.',
          retryable: true,
          providerId: this.id
        });
      }
      if (readResult.finishReason === 'content_filter') {
        throw new AIProviderError({
          code: 'CONTENT_BLOCKED',
          userMessage: 'İçerik güvenlik filtresi tarafından engellendi.',
          retryable: false,
          providerId: this.id
        });
      }
      if (!readResult.content.trim()) {
        throw new AIProviderError({
          code: 'INVALID_RESPONSE',
          userMessage: readResult.reasoningContent.trim()
            ? 'Model yalnızca akıl yürütme içeriği döndürdü; final cevap bulunamadı.'
            : 'API boş yanıt döndürdü.',
          retryable: true,
          providerId: this.id
        });
      }

      return ResponseParser.parseAndValidate(
        readResult.content,
        request.taskId,
        request.video.videoId,
        this.id,
        model,
        request.options,
        request.video.durationMs || undefined,
        request.transcript.segments
      );
    } catch (error: any) {
      if (error instanceof AIProviderError) throw error;

      if (timedOut || error instanceof CorrectionResponseTimeoutError) {
        throw new AIProviderError({
          code: 'REQUEST_TIMEOUT',
          userMessage: 'API özet isteği zaman aşımına uğradı.',
          retryable: true,
          providerId: this.id,
          debugMessage: error instanceof CorrectionResponseTimeoutError
            ? `timeoutKind=${error.timeoutKind}`
            : 'timeoutKind=total'
        });
      }
      if (
        context.signal?.aborted ||
        error?.name === 'AbortError' ||
        error?.message === 'AbortError'
      ) {
        throw new AIProviderError({
          code: 'REQUEST_CANCELLED',
          userMessage: 'İstek iptal edildi.',
          retryable: false,
          providerId: this.id
        });
      }

      throw new AIProviderError({
        code: 'NETWORK_ERROR',
        userMessage: 'Ağ veya bağlantı hatası oluştu.',
        retryable: true,
        providerId: this.id,
        debugMessage: safeMetadataToken(error?.code) || error?.name || 'Error'
      });
    } finally {
      clearTimeout(timeoutId);
      context.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private createConnectionSummaryRequest(): SummaryRequest {
    return {
      taskId: 'connection-summary',
      video: {
        videoId: 'connection-test',
        title: 'Connection Test',
        url: 'https://www.youtube.com/watch?v=connection-test'
      },
      transcript: {
        languageCode: 'tr',
        sourceType: 'manual',
        qualityLevel: 'high',
        qualityReasons: [],
        segments: [{
          id: 'segment-1',
          sequence: 1,
          startTimeMs: 0,
          endTimeMs: 1000,
          durationMs: 1000,
          text: 'Bu bir bağlantı testidir.',
          cleanText: 'Bu bir bağlantı testidir.',
          languageCode: 'tr'
        }]
      },
      options: {
        length: 'short',
        outputLanguage: 'tr',
        includeKeyIdeas: true,
        includeSections: true,
        includeActionItems: true
      },
      engine: 'openai-compatible'
    };
  }

  private getEndpoint(baseUrl: string): string {
    const normalized = baseUrl.replace(/\/+$/, '');
    return normalized.endsWith('/chat/completions')
      ? normalized
      : `${normalized}/chat/completions`;
  }

  private getHeaders(config: AIProviderConfig): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...config.customHeaders
    };
  }

  private requestTypeLabel(requestType: RequestType): string {
    return requestType === 'correction' ? 'Düzeltme' : 'Özet';
  }

  private safeConnectionErrorMessage(
    requestType: RequestType,
    metadata: SafeHttpMetadata
  ): string {
    const errorCode = metadata.providerErrorCode
      ? `, kod=${metadata.providerErrorCode}`
      : '';
    return `${this.requestTypeLabel(requestType)} bağlantı hatası: HTTP ${metadata.httpStatus}${errorCode}.`;
  }

  private async readSafeHttpMetadata(response: Response): Promise<SafeHttpMetadata> {
    let rawText = '';
    let providerErrorCode: string | undefined;
    let providerErrorType: string | undefined;

    try {
      rawText = await response.text();
      const parsed = JSON.parse(rawText);
      providerErrorCode = safeMetadataToken(
        parsed?.error?.code ?? parsed?.code
      );
      providerErrorType = safeMetadataToken(
        parsed?.error?.type ?? parsed?.type
      );
    } catch {
      // Response body is intentionally discarded.
    }

    const requestId = safeMetadataToken(
      response.headers.get('x-request-id') ??
      response.headers.get('request-id') ??
      response.headers.get('cf-ray')
    );

    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') || 'unknown',
      bodyCharacterCount: rawText.length,
      ...(providerErrorCode ? { providerErrorCode } : {}),
      ...(providerErrorType ? { providerErrorType } : {}),
      ...(requestId ? { requestId } : {})
    };
  }

  private readRateLimits(response: Response): string | undefined {
    const requests = response.headers.get('x-ratelimit-remaining-requests') ||
      response.headers.get('x-ratelimit-limit-requests') ||
      response.headers.get('ratelimit-remaining');
    const tokens = response.headers.get('x-ratelimit-remaining-tokens') ||
      response.headers.get('x-ratelimit-limit-tokens') ||
      response.headers.get('ratelimit-limit');
    return requests || tokens
      ? `İstek: ${requests || '?'} | Token: ${tokens || '?'}`
      : undefined;
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const metadata = await this.readSafeHttpMetadata(response);
    const common = {
      providerId: this.id,
      statusCode: response.status,
      debugMessage: JSON.stringify(metadata)
    };

    if (response.status === 401) {
      throw new AIProviderError({
        ...common,
        code: 'INVALID_API_KEY',
        userMessage: 'Geçersiz API anahtarı.',
        retryable: false
      });
    }
    if (response.status === 404) {
      throw new AIProviderError({
        ...common,
        code: 'MODEL_NOT_FOUND',
        userMessage: 'Model bulunamadı veya Base URL yanlış.',
        retryable: false
      });
    }
    if (response.status === 429) {
      throw new AIProviderError({
        ...common,
        code: 'QUOTA_EXCEEDED',
        userMessage: 'Kota aşıldı veya istek sınırına ulaşıldı.',
        retryable: true
      });
    }

    throw new AIProviderError({
      ...common,
      code: 'UNKNOWN_ERROR',
      userMessage: `Sunucu hatası: HTTP ${response.status}.`,
      retryable: response.status >= 500
    });
  }
}
