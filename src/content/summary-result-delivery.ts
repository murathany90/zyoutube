import type { SummaryResult } from '../ai/types';
import { HistoryService } from '../settings/history';
import type { TranscriptSegment } from '../transcript/types';

interface PersistDeliveredSummaryInput {
  result: SummaryResult;
  videoInfo: {
    videoId: string;
    title: string;
    url: string;
  };
  transcript: TranscriptSegment[];
}

interface PersistDeliveredSummaryDependencies {
  saveSummary: typeof HistoryService.saveSummary;
  sendMessage: (message: unknown) => Promise<unknown>;
}

const defaultDependencies: PersistDeliveredSummaryDependencies = {
  saveSummary: (...args) => HistoryService.saveSummary(...args),
  sendMessage: message => chrome.runtime.sendMessage(message)
};

export async function persistDeliveredSummary(
  input: PersistDeliveredSummaryInput,
  dependencies: PersistDeliveredSummaryDependencies = defaultDependencies
): Promise<void> {
  await dependencies.saveSummary(
    input.result,
    input.videoInfo,
    input.transcript
  );

  await dependencies.sendMessage({
    type: 'LIBRARY_ENTRY_UPDATED',
    videoId: input.videoInfo.videoId,
    reason: 'summary'
  });

  await dependencies.sendMessage({
    type: 'ACK_SUMMARY_TERMINAL',
    taskId: input.result.taskId
  });
}
