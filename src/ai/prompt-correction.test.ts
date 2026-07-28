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

  it('stream_options ve json mode kapatılabilir', () => {
    const body = CorrectionPromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      correctionStreamOptions: false,
      correctionJsonMode: false
    });

    expect(body.stream).toBe(true);
    expect(body.stream_options).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });
});
