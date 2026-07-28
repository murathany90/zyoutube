import { describe, expect, it, vi } from 'vitest';
import {
  SummaryTaskCoordinator,
  acknowledgeSummaryTerminal,
  relaySummaryTerminalMessage,
  summaryTaskStorageKey,
  type SummaryTaskState,
  type SummaryTerminalMessage
} from './summary-terminal-relay';

function taskState(): SummaryTaskState {
  return {
    taskId: 'task-1',
    tabId: 42,
    videoId: 'video-1',
    engine: 'gemini-gem',
    status: 'summarizing',
    startedAt: 100,
    lastHeartbeatAt: 100
  };
}

describe('summary terminal relay', () => {
  it('terminal result is persisted before delivery and retained until UI acknowledgement', async () => {
    const session = new Map<string, SummaryTaskState>();
    const order: string[] = [];
    const message: SummaryTerminalMessage = {
      type: 'SUMMARY_COMPLETED',
      taskId: 'task-1',
      videoId: 'video-1',
      result: { summary: { tr: 'Özet' } }
    };

    await relaySummaryTerminalMessage(message, taskState(), {
      persist: async (key, state) => {
        order.push('persist');
        session.set(key, state);
      },
      deliver: async (_tabId, contentMessage) => {
        order.push('deliver');
        expect(session.get(summaryTaskStorageKey('task-1'))).toMatchObject({
          status: 'completed',
          terminalMessage: contentMessage
        });
      }
    });

    expect(order).toEqual(['persist', 'deliver']);
    expect(session.has(summaryTaskStorageKey('task-1'))).toBe(true);
  });

  it('failed UI delivery keeps the recoverable terminal result', async () => {
    const session = new Map<string, SummaryTaskState>();

    await expect(relaySummaryTerminalMessage({
      type: 'SUMMARY_COMPLETED',
      taskId: 'task-1',
      videoId: 'video-1',
      result: { summary: { tr: 'Özet' } }
    }, taskState(), {
      persist: async (key, state) => {
        session.set(key, state);
      },
      deliver: async () => {
        throw new Error('panel unavailable');
      }
    })).rejects.toThrow('panel unavailable');

    expect(session.get(summaryTaskStorageKey('task-1'))?.terminalMessage).toBeTruthy();
  });

  it('UI acknowledgement removes terminal state and releases the context lock', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const coordinator = new SummaryTaskCoordinator();
    coordinator.acquire(42, 'video-1', 'task-1');

    await acknowledgeSummaryTerminal('task-1', coordinator, { remove });

    expect(remove).toHaveBeenCalledWith(summaryTaskStorageKey('task-1'));
    expect(coordinator.acquire(42, 'video-1', 'task-2')).toEqual({
      taskId: 'task-2',
      isNew: true
    });
  });
});

describe('SummaryTaskCoordinator', () => {
  it('duplicate start for the same tab and video returns the existing task', () => {
    const coordinator = new SummaryTaskCoordinator();

    expect(coordinator.acquire(42, 'video-1', 'task-1')).toEqual({
      taskId: 'task-1',
      isNew: true
    });
    expect(coordinator.acquire(42, 'video-1', 'task-2')).toEqual({
      taskId: 'task-1',
      isNew: false
    });
  });

  it('different videos have independent locks', () => {
    const coordinator = new SummaryTaskCoordinator();

    coordinator.acquire(42, 'video-1', 'task-1');
    expect(coordinator.acquire(42, 'video-2', 'task-2')).toEqual({
      taskId: 'task-2',
      isNew: true
    });
  });
});
