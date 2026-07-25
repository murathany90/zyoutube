import { SummaryRequest } from '../ai/types';
import { AITaskManager } from '../ai/task-manager';
import { ExtensionMessage } from './index';

export function setupAIMessageHandlers() {
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    if (!sender.tab || !sender.tab.id) return;

    if (message.type === 'START_SUMMARY') {
      const { request } = message as { type: 'START_SUMMARY'; request: SummaryRequest };
      const tabId = sender.tab.id;

      AITaskManager.startTask(request, tabId, (status, msg, progress) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_PROGRESS',
          taskId: request.taskId,
          status,
          message: msg,
          progress
        }).catch(() => {});
      }).then((result) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_COMPLETED',
          taskId: request.taskId,
          result
        }).catch(() => {});
      }).catch((error) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_FAILED',
          taskId: request.taskId,
          error: {
            code: error.code || 'UNKNOWN_ERROR',
            userMessage: error.userMessage || error.message || 'Bir hata oluştu.',
            retryable: error.retryable ?? true
          }
        }).catch(() => {});
      });

      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'CANCEL_SUMMARY') {
      const { taskId } = message as { type: 'CANCEL_SUMMARY'; taskId: string };
      AITaskManager.cancelTask(taskId).catch(console.error);
      sendResponse({ success: true });
      return true;
    }
  });
}
