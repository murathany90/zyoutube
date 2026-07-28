import { describe, expect, it, vi } from 'vitest';
import { persistDeliveredSummary } from './summary-result-delivery';
import type { SummaryResult } from '../ai/types';

function result(): SummaryResult {
  return {
    schemaVersion: 1,
    taskId: 'task-1',
    videoId: 'video-1',
    providerId: 'gemini-gem',
    model: 'gemini-gem',
    outputLanguage: 'tr',
    summaryLength: 'standard',
    createdAt: new Date(0).toISOString(),
    summary: { tr: 'Özet' },
    keyIdeas: [],
    sections: [],
    actionItems: [],
    importantTerms: [],
    warnings: [],
    rawResponseStored: false
  };
}

describe('persistDeliveredSummary', () => {
  it('saves History and notifies the library before terminal acknowledgement', async () => {
    const order: string[] = [];
    const saveSummary = vi.fn(async () => {
      order.push('save');
    });
    const sendMessage = vi.fn(async (message: any) => {
      order.push(message.type);
      return { success: true };
    });

    await persistDeliveredSummary({
      result: result(),
      videoInfo: {
        videoId: 'video-1',
        title: 'Video',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      transcript: []
    }, {
      saveSummary,
      sendMessage
    });

    expect(order).toEqual([
      'save',
      'LIBRARY_ENTRY_UPDATED',
      'ACK_SUMMARY_TERMINAL'
    ]);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'ACK_SUMMARY_TERMINAL',
      taskId: 'task-1'
    });
  });

  it('History save failure keeps terminal state unacknowledged', async () => {
    const sendMessage = vi.fn();

    await expect(persistDeliveredSummary({
      result: result(),
      videoInfo: {
        videoId: 'video-1',
        title: 'Video',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      transcript: []
    }, {
      saveSummary: async () => {
        throw new Error('storage failed');
      },
      sendMessage
    })).rejects.toThrow('storage failed');

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
