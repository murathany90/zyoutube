export interface ResponseBaseline {
  modelTurnCount: number;
  lastResponseText: string;
}

export interface ResponseSnapshot {
  baseline: ResponseBaseline;
  currentText: string;
  currentModelTurnCount: number;
  currentElementChanged: boolean;
  streamingActive: boolean;
  stableForMs: number;
  stablePollCount: number;
  notStreamingPollCount: number;
  generationAlreadyStarted?: boolean;
}

export interface ResponseDecision {
  generationStarted: boolean;
  completed: boolean;
}

export function evaluateResponseSnapshot(snapshot: ResponseSnapshot): ResponseDecision {
  const normalizedText = snapshot.currentText.trim();
  const hasNewText = normalizedText.length > 10 &&
    normalizedText !== snapshot.baseline.lastResponseText.trim();
  const generationStarted = Boolean(
    snapshot.generationAlreadyStarted ||
    snapshot.currentModelTurnCount > snapshot.baseline.modelTurnCount ||
    snapshot.currentElementChanged ||
    hasNewText
  );

  return {
    generationStarted,
    completed:
      generationStarted &&
      normalizedText.length >= 50 &&
      !snapshot.streamingActive &&
      snapshot.stableForMs >= 12000 &&
      snapshot.stablePollCount >= 4 &&
      snapshot.notStreamingPollCount >= 3
  };
}
