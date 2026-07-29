import type { SummaryResult } from '../ai/types';
import type { SummaryEngine } from '../gem/types';

export type SummaryContentTerminalMessage =
  | {
      type: 'SUMMARY_COMPLETED';
      taskId: string;
      videoId: string;
      result: SummaryResult | unknown;
    }
  | {
      type: 'SUMMARY_FAILED';
      taskId: string;
      videoId: string;
      error: unknown;
    };

export type SummaryTerminalMessage = SummaryContentTerminalMessage;

export interface SummaryTaskState {
  taskId: string;
  tabId: number;
  videoId: string;
  engine: SummaryEngine;
  status: string;
  startedAt: number;
  lastHeartbeatAt: number;
  completedAt?: number;
  terminalMessage?: SummaryContentTerminalMessage;
}

interface SummaryTerminalRelayDependencies {
  persist: (key: string, state: SummaryTaskState) => Promise<void>;
  deliver: (
    tabId: number,
    message: SummaryContentTerminalMessage
  ) => Promise<unknown>;
}

export function summaryTaskStorageKey(taskId: string): string {
  return `summary_task_${taskId}`;
}

function summaryContextKey(tabId: number, videoId: string): string {
  return `${tabId}:${videoId}`;
}

export class SummaryTaskCoordinator {
  private readonly taskByContext = new Map<string, string>();
  private readonly contextByTask = new Map<string, string>();

  acquire(
    tabId: number,
    videoId: string,
    proposedTaskId: string
  ): { taskId: string; isNew: boolean } {
    const contextKey = summaryContextKey(tabId, videoId);
    const existingTaskId = this.taskByContext.get(contextKey);
    if (existingTaskId) {
      return { taskId: existingTaskId, isNew: false };
    }

    this.taskByContext.set(contextKey, proposedTaskId);
    this.contextByTask.set(proposedTaskId, contextKey);
    return { taskId: proposedTaskId, isNew: true };
  }

  remember(state: SummaryTaskState): void {
    const contextKey = summaryContextKey(state.tabId, state.videoId);
    this.taskByContext.set(contextKey, state.taskId);
    this.contextByTask.set(state.taskId, contextKey);
  }

  release(taskId: string): void {
    const contextKey = this.contextByTask.get(taskId);
    if (!contextKey) return;
    this.contextByTask.delete(taskId);
    if (this.taskByContext.get(contextKey) === taskId) {
      this.taskByContext.delete(contextKey);
    }
  }
}

export async function relaySummaryTerminalMessage(
  message: SummaryTerminalMessage,
  taskState: SummaryTaskState,
  dependencies: SummaryTerminalRelayDependencies
): Promise<void> {
  const terminalState: SummaryTaskState = {
    ...taskState,
    status: message.type === 'SUMMARY_COMPLETED' ? 'completed' : 'failed',
    completedAt: Date.now(),
    terminalMessage: message
  };

  await dependencies.persist(
    summaryTaskStorageKey(message.taskId),
    terminalState
  );
  await dependencies.deliver(taskState.tabId, message);
}

export async function acknowledgeSummaryTerminal(
  taskId: string,
  coordinator: SummaryTaskCoordinator,
  dependencies: {
    remove: (key: string) => Promise<void>;
  }
): Promise<void> {
  await dependencies.remove(summaryTaskStorageKey(taskId));
  coordinator.release(taskId);
}
