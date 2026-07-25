import { AITask, AITaskStatus, SummaryRequest, SummaryResult } from './types';
import { AIProviderRegistry } from './registry';
import { AIProviderError } from './errors';
import { AISettingsService } from '../settings/ai-settings';

export class AITaskManager {
  private static tasks: Map<string, AITask> = new Map();
  private static abortControllers: Map<string, AbortController> = new Map();

  static async startTask(
    request: SummaryRequest,
    tabId: number,
    onProgress?: (status: AITaskStatus, message?: string, progress?: number) => void
  ): Promise<SummaryResult> {
    const existingTask = Array.from(this.tasks.values()).find(t => t.videoId === request.video.videoId && t.tabId === tabId && t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed');
    
    if (existingTask) {
      await this.cancelTask(existingTask.taskId);
    }

    const settings = await AISettingsService.getSettings();
    const providerId = settings.defaultProviderId;

    const task: AITask = {
      taskId: request.taskId,
      tabId,
      videoId: request.video.videoId,
      providerId,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tasks.set(task.taskId, task);
    
    const controller = new AbortController();
    this.abortControllers.set(task.taskId, controller);

    try {
      const provider = AIProviderRegistry.getProvider(providerId);
      if (!provider) {
        throw new AIProviderError({
          code: 'PROVIDER_NOT_CONFIGURED',
          userMessage: 'Seçili AI sağlayıcısı bulunamadı.',
          retryable: false,
          providerId
        });
      }

      this.updateStatus(task.taskId, 'preparing', onProgress);

      // (Önizleme: Burada token hesaplama ve chunking mantığı gelecek)
      // Şimdilik doğrudan sağlayıcıya gönderiyoruz
      this.updateStatus(task.taskId, 'summarizing', onProgress);

      const result = await provider.summarize(request, {
        signal: controller.signal,
        onProgress: (msg, prog) => {
          if (onProgress) onProgress('summarizing', msg, prog);
        }
      });

      this.updateStatus(task.taskId, 'completed', onProgress);
      this.tasks.delete(task.taskId);
      this.abortControllers.delete(task.taskId);

      return result;
    } catch (e: any) {
      this.tasks.delete(task.taskId);
      this.abortControllers.delete(task.taskId);
      
      if (e instanceof AIProviderError) {
        this.updateStatus(task.taskId, e.code === 'REQUEST_CANCELLED' ? 'cancelled' : 'failed', onProgress);
        throw e;
      }

      const isAbort = e.name === 'AbortError' || e.message === 'Timeout';
      this.updateStatus(task.taskId, isAbort ? 'cancelled' : 'failed', onProgress);
      
      throw new AIProviderError({
        code: isAbort ? 'REQUEST_CANCELLED' : 'UNKNOWN_ERROR',
        userMessage: isAbort ? 'İstek iptal edildi.' : 'Beklenmeyen bir hata oluştu.',
        retryable: !isAbort,
        providerId
      });
    }
  }

  static async cancelTask(taskId: string): Promise<void> {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }
    
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
      // provider'a iptal bildirimi (destekliyorsa)
      const provider = AIProviderRegistry.getProvider(task.providerId);
      if (provider && provider.cancel) {
        await provider.cancel(taskId).catch(() => {});
      }
    }
  }

  private static updateStatus(
    taskId: string, 
    status: AITaskStatus, 
    onProgress?: (status: AITaskStatus, message?: string, progress?: number) => void
  ) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      if (onProgress) onProgress(status);
    }
  }
}
