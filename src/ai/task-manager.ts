import { AITask, AITaskStatus, SummaryRequest, SummaryResult } from './types';
import { AIProviderRegistry } from './registry';
import { AIProviderError } from './errors';
import { AISettingsService } from '../settings/ai-settings';
import { TranscriptChunker } from './chunker';
import { SummaryCache } from './cache';

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

      const providerConfig = settings.providers[providerId];
      const modelName = providerConfig?.model || 'default';
      
      // Cache Kontrolü
      const cacheResult = await SummaryCache.get(request, providerId, modelName);
      if (cacheResult) {
        this.updateStatus(task.taskId, 'completed', onProgress);
        this.tasks.delete(task.taskId);
        this.abortControllers.delete(task.taskId);
        return cacheResult;
      }

      this.updateStatus(task.taskId, 'chunking', onProgress);
      const chunks = TranscriptChunker.chunkSegments(request.transcript.segments, 3000); // about 12000 chars

      if (chunks.length === 1) {
        // Single request
        this.updateStatus(task.taskId, 'summarizing', onProgress);
        const result = await provider.summarize(request, {
          signal: controller.signal,
          onProgress: (msg, prog) => {
            if (onProgress) onProgress('summarizing', msg, prog);
          }
        });
        await SummaryCache.set(request, providerId, modelName, result);
        this.updateStatus(task.taskId, 'completed', onProgress);
        this.tasks.delete(task.taskId);
        this.abortControllers.delete(task.taskId);
        return result;
      }

      // Multi-chunk request
      this.updateStatus(task.taskId, 'summarizing', onProgress);
      const chunkResults: SummaryResult[] = [];
      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) throw new Error('AbortError');
        
        if (onProgress) onProgress('summarizing', `Bölüm ${i + 1}/${chunks.length} özetleniyor...`, ((i + 1) / chunks.length) * 80);
        
        const chunkContent = chunks[i].segments.map(s => `[${s.startTimeMs}] ${s.cleanText || s.text}`).join('\n');
        
        const res = await provider.summarize(request, {
          signal: controller.signal,
          promptType: 'chunk',
          customContent: chunkContent
        });
        chunkResults.push(res);
      }

      this.updateStatus(task.taskId, 'merging', onProgress);
      if (onProgress) onProgress('merging', `Ara özetler birleştiriliyor...`, 90);
      
      const mergeContent = JSON.stringify(chunkResults.map(r => ({
        keyIdeas: r.keyIdeas,
        sections: r.sections,
        importantTerms: r.importantTerms,
        warnings: r.warnings
      })), null, 2);

      const finalResult = await provider.summarize(request, {
        signal: controller.signal,
        promptType: 'merge',
        customContent: mergeContent
      });

      await SummaryCache.set(request, providerId, modelName, finalResult);

      this.updateStatus(task.taskId, 'completed', onProgress);
      this.tasks.delete(task.taskId);
      this.abortControllers.delete(task.taskId);

      return finalResult;
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
