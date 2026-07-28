import { describe, expect, it } from 'vitest';
import {
  relayCorrectionTerminalMessage,
  type CorrectionTaskState,
  type CorrectionTerminalMessage
} from './correction-terminal-relay';

function createTaskState(): CorrectionTaskState {
  return {
    taskId: 'task-1',
    tabId: 42,
    videoId: 'video-1',
    status: 'preparing',
    startedAt: 100,
    lastHeartbeatAt: 100
  };
}

describe('relayCorrectionTerminalMessage', () => {
  it('session kaydini ancak content script teslimi tamamlandiktan sonra siler', async () => {
    const session = new Map<string, CorrectionTaskState>();
    let finishDelivery!: () => void;
    const delivery = new Promise<void>((resolve) => {
      finishDelivery = resolve;
    });
    const delivered: unknown[] = [];
    const message: CorrectionTerminalMessage = {
      type: 'API_CORRECTION_COMPLETED',
      taskId: 'task-1',
      videoId: 'video-1',
      result: { sentences: [{ id: 'sentence-1' }] }
    };

    const relay = relayCorrectionTerminalMessage(message, createTaskState(), {
      persist: async (key, value) => {
        session.set(key, value);
      },
      deliver: async (_tabId, contentMessage) => {
        delivered.push(contentMessage);
        await delivery;
      },
      remove: async (key) => {
        session.delete(key);
      }
    });

    await Promise.resolve();

    expect(session.get('api_task_task-1')).toMatchObject({
      status: 'completed',
      terminalMessage: {
        type: 'CORRECTION_COMPLETED',
        taskId: 'task-1'
      }
    });
    expect(delivered).toEqual([
      {
        type: 'CORRECTION_COMPLETED',
        taskId: 'task-1',
        result: { sentences: [{ id: 'sentence-1' }] }
      }
    ]);

    finishDelivery();
    await relay;

    expect(session.has('api_task_task-1')).toBe(false);
  });

  it('content script teslimi basarisizsa terminal session kaydini korur', async () => {
    const session = new Map<string, CorrectionTaskState>();
    const message: CorrectionTerminalMessage = {
      type: 'API_CORRECTION_FAILED',
      taskId: 'task-1',
      videoId: 'video-1',
      error: { code: 'CORRECTION_HTTP_ERROR' }
    };

    await expect(relayCorrectionTerminalMessage(message, createTaskState(), {
      persist: async (key, value) => {
        session.set(key, value);
      },
      deliver: async () => {
        throw new Error('content script unavailable');
      },
      remove: async (key) => {
        session.delete(key);
      }
    })).rejects.toThrow('content script unavailable');

    expect(session.get('api_task_task-1')).toMatchObject({
      status: 'failed',
      terminalMessage: {
        type: 'CORRECTION_FAILED',
        taskId: 'task-1'
      }
    });
  });
});
