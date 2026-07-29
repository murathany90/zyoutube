import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './prompt-builder';
import type { SummaryRequest } from './types';

const request: SummaryRequest = {
  taskId: 'summary-test',
  video: {
    videoId: 'video-1',
    title: 'Test Video',
    url: 'https://www.youtube.com/watch?v=video-1'
  },
  transcript: {
    languageCode: 'tr',
    sourceType: 'manual',
    qualityLevel: 'high',
    qualityReasons: [],
    segments: [{
      id: 'seg-1',
      sequence: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      durationMs: 1000,
      text: 'Test içeriği',
      cleanText: 'Test içeriği',
      languageCode: 'tr'
    }]
  },
  options: {
    length: 'short',
    outputLanguage: 'tr',
    includeKeyIdeas: true,
    includeSections: true,
    includeActionItems: true
  }
};

describe('PromptBuilder summary compatibility settings', () => {
  it('supports max_completion_tokens and disables streaming fields', () => {
    const body = PromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      maxTokens: 4096,
      summaryTokenParam: 'max_completion_tokens',
      summaryStreaming: false,
      summaryJsonMode: false
    });

    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
    expect(body.response_format).toBeUndefined();
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
  });

  it('enables streaming, stream_options and JSON mode independently', () => {
    const body = PromptBuilder.buildApiRequestBody(request, {
      model: 'test-model',
      summaryStreaming: true,
      summaryStreamOptions: true,
      summaryJsonMode: true
    });

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.chat_template_kwargs).toEqual({ thinking: false });
  });
});
