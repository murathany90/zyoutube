import { describe, expect, it } from 'vitest';
import { CorrectionPromptBuilder } from './prompt-correction';
import { CorrectionRequest } from './types';

const request: CorrectionRequest = {
  taskId: 'correction-test',
  video: {
    videoId: 'video-1',
    title: 'Test Video'
  },
  transcript: {
    sourceLanguage: 'tr',
    segments: [
      {
        id: 'seg-1',
        startTimeMs: 0,
        endTimeMs: 1000,
        turkish: 'Merhaba',
        english: 'Hello'
      }
    ]
  }
};

describe('CorrectionPromptBuilder', () => {
  it('parca icin kesin segment indeks araligini prompta ekler', () => {
    const prompt = CorrectionPromptBuilder.buildUserPrompt(request);

    expect(prompt).toContain('Geçerli indeks aralığı 0-0');
    expect(prompt).toContain('to değeri tam olarak 0');
  });

  it('provider ayarı yoksa sınırlı çıktıyla streaming uyumluluk varsayılanlarını kullanır', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model'
    });

    expect(body.max_tokens).toBe(16384);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.response_format).toBeUndefined();
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
  });

  it('correctionStreaming false olduğunda stream alanlarını göndermez', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionStreaming: false
    });

    expect(body.stream).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
  });

  it('provider max_completion_tokens istediğinde max_tokens yerine onu kullanır', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionMaxTokens: 4096,
      correctionTokenParam: 'max_completion_tokens'
    });

    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
  });

  it('aşırı çıktı token limitini güvenli üst sınırda tutar', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionMaxTokens: 1_000_000
    });

    expect(body.max_tokens).toBe(65_536);
  });

  it('stream_options ve json mode kapatılabilir', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionStreaming: true,
      correctionStreamOptions: false,
      correctionJsonMode: false
    });

    expect(body.stream).toBe(true);
    expect(body.stream_options).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it('reasoning açıldığında thinking ve reasoning_effort gönderir', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionEnableReasoning: true
    });

    expect(body.chat_template_kwargs).toEqual({
      thinking: true,
      reasoning_effort: 'high'
    });
  });
});
