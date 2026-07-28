export interface CorrectionTaskState {
  taskId: string;
  tabId: number;
  videoId: string;
  status: string;
  startedAt: number;
  lastHeartbeatAt: number;
  completedAt?: number;
  terminalMessage?: CorrectionContentTerminalMessage;
}

export type CorrectionTerminalMessage =
  | {
      type: 'API_CORRECTION_COMPLETED';
      taskId: string;
      videoId: string;
      result: unknown;
    }
  | {
      type: 'API_CORRECTION_FAILED';
      taskId: string;
      videoId: string;
      error: unknown;
    };

type CorrectionContentTerminalMessage =
  | {
      type: 'CORRECTION_COMPLETED';
      taskId: string;
      result: unknown;
    }
  | {
      type: 'CORRECTION_FAILED';
      taskId: string;
      error: unknown;
    };

interface CorrectionTerminalRelayDependencies {
  persist: (key: string, state: CorrectionTaskState) => Promise<void>;
  deliver: (tabId: number, message: CorrectionContentTerminalMessage) => Promise<unknown>;
  remove: (key: string) => Promise<void>;
}

export async function relayCorrectionTerminalMessage(
  message: CorrectionTerminalMessage,
  taskState: CorrectionTaskState,
  dependencies: CorrectionTerminalRelayDependencies
): Promise<void> {
  const storageKey = `api_task_${message.taskId}`;
  const terminalMessage: CorrectionContentTerminalMessage =
    message.type === 'API_CORRECTION_COMPLETED'
      ? {
          type: 'CORRECTION_COMPLETED',
          taskId: message.taskId,
          result: message.result
        }
      : {
          type: 'CORRECTION_FAILED',
          taskId: message.taskId,
          error: message.error
        };

  await dependencies.persist(storageKey, {
    ...taskState,
    status: message.type === 'API_CORRECTION_COMPLETED' ? 'completed' : 'failed',
    completedAt: Date.now(),
    terminalMessage
  });
  await dependencies.deliver(taskState.tabId, terminalMessage);
  await dependencies.remove(storageKey);
}
