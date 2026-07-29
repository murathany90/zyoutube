import { describe, expect, it } from 'vitest';
import {
  evaluateResponseSnapshot,
  type ResponseBaseline
} from './response-detector';

const baseline: ResponseBaseline = {
  modelTurnCount: 1,
  lastResponseText: 'An older Gemini response'
};

describe('Gemini response detector', () => {
  it('accepts a stable new response when the strict model selector is absent', () => {
    const result = evaluateResponseSnapshot({
      baseline,
      currentText: 'A new response that is long enough to be treated as a completed Gemini answer.',
      currentModelTurnCount: 1,
      currentElementChanged: false,
      streamingActive: false,
      stableForMs: 12000,
      stablePollCount: 4,
      notStreamingPollCount: 3
    });

    expect(result.generationStarted).toBe(true);
    expect(result.completed).toBe(true);
  });

  it('does not accept the baseline response as a new answer', () => {
    const result = evaluateResponseSnapshot({
      baseline,
      currentText: baseline.lastResponseText,
      currentModelTurnCount: 1,
      currentElementChanged: false,
      streamingActive: false,
      stableForMs: 30000,
      stablePollCount: 10,
      notStreamingPollCount: 10
    });

    expect(result.generationStarted).toBe(false);
    expect(result.completed).toBe(false);
  });

  it('waits until streaming is inactive and the text is stable', () => {
    const result = evaluateResponseSnapshot({
      baseline,
      currentText: 'A new response that is still being generated and is not stable enough yet.',
      currentModelTurnCount: 2,
      currentElementChanged: true,
      streamingActive: true,
      stableForMs: 12000,
      stablePollCount: 4,
      notStreamingPollCount: 0
    });

    expect(result.generationStarted).toBe(true);
    expect(result.completed).toBe(false);
  });
});
