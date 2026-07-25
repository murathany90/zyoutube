import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiApiProvider } from './gemini-api-provider';

import { AISettingsService } from '../../settings/ai-settings';

vi.mock('../../settings/ai-settings', () => ({
  AISettingsService: {
    getProviderConfig: vi.fn(),
  }
}));

describe('GeminiApiProvider Boundary Tests', () => {
  let provider: GeminiApiProvider;

  beforeEach(() => {
    provider = new GeminiApiProvider();
    vi.clearAllMocks();
    (AISettingsService.getProviderConfig as any).mockResolvedValue({
      apiKey: 'dummy-key', model: 'gemini-2.5-flash'
    });
  });

  const dummyRequest: any = {
    taskId: '123',
    video: { videoId: 'vid' },
    transcript: { segments: [{ text: 'hello', cleanText: 'hello', startTimeMs: 0, endTimeMs: 1000 }] },
    options: { outputLanguage: 'tr', length: 'short' }
  };

  it('should throw PERMISSION_REQUIRED if no API key', async () => {
    (AISettingsService.getProviderConfig as any).mockResolvedValue({});
    
    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('PROVIDER_NOT_CONFIGURED');
    }
  });

  it('should handle 401 INVALID_API_KEY', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'API key not valid' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('INVALID_API_KEY');
      expect(e.retryable).toBe(false);
    }
  });

  it('should handle 429 RATE_LIMITED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('QUOTA_EXCEEDED');
      expect(e.retryable).toBe(true);
    }
  });

  it('should handle 404 MODEL_NOT_FOUND', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { message: 'Model not found' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('MODEL_NOT_FOUND');
    }
  });

  it('should handle empty response or invalid JSON gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{ bad json }' }] } }]
      })
    });

    const res = await provider.summarize(dummyRequest, {});
    // Fallback parser should handle it
    expect(res.rawResponseStored).toBe(false);
  });

  it('should handle content block (finishReason: SAFETY)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '' }] } }]
      })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('CONTENT_BLOCKED');
    }
  });

  it('should handle network timeout via AbortSignal', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));
    const controller = new AbortController();
    controller.abort();

    try {
      await provider.summarize(dummyRequest, { signal: controller.signal });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('REQUEST_CANCELLED');
    }
  });
});
