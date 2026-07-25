import { AITask, AITaskStatus, SummaryRequest, SummaryResult, AIProviderId } from './types';
import { AIProviderRegistry } from './registry';
import { AIProviderError } from './errors';
import { AISettingsService } from '../settings/ai-settings';
import { TranscriptChunker } from './chunker';
import { SummaryCache } from './cache';
import { GemController } from '../gem/controller';
import { SummaryEngine } from '../gem/types';

export class AITaskManager {
  private static tasks: Map<string, AITask> = new Map();
  private static abortControllers: Map<string, AbortController> = new Map();

  static async startTask(
    request: SummaryRequest,
    tabId: number,
    onProgress?: (status: AITaskStatus, message?: string, progress?: number) => void
  ): Promise<SummaryResult> {
    // Aynı video için çalışan eski görevi iptal et
    const existingTask = Array.from(this.tasks.values()).find(
      t => t.videoId === request.video.videoId && t.tabId === tabId &&
        t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed'
    );
    if (existingTask) {
      await this.cancelTask(existingTask.taskId);
    }

    const settings = await AISettingsService.getSettings();
    const engine: SummaryEngine = request.engine || settings.defaultEngine;

    const task: AITask = {
      taskId: request.taskId,
      tabId,
      videoId: request.video.videoId,
      engine,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tasks.set(task.taskId, task);
    const controller = new AbortController();
    this.abortControllers.set(task.taskId, controller);

    try {
      // ─── Gemini Gem akışı ───
      if (engine === 'gemini-gem') {
        return await this.runGemEngine(request, task, onProgress);
      }

      // ─── API akışı (openai-compatible, chrome-local) ───
      const providerId: AIProviderId = engine as AIProviderId;
      task.providerId = providerId;

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
        this.cleanup(task.taskId);
        return cacheResult;
      }

      this.updateStatus(task.taskId, 'chunking', onProgress);
      const chunks = TranscriptChunker.chunkSegments(request.transcript.segments, 3000);

      if (chunks.length === 1) {
        this.updateStatus(task.taskId, 'summarizing', onProgress);
        const result = await provider.summarize(request, {
          signal: controller.signal,
          onProgress: (msg, prog) => {
            if (onProgress) onProgress('summarizing', msg, prog);
          }
        });
        await SummaryCache.set(request, providerId, modelName, result);
        this.updateStatus(task.taskId, 'completed', onProgress);
        this.cleanup(task.taskId);
        return result;
      }

      // Multi-chunk
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
      if (onProgress) onProgress('merging', 'Ara özetler birleştiriliyor...', 90);
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
      this.cleanup(task.taskId);
      return finalResult;

    } catch (e: any) {
      this.cleanup(task.taskId);
      if (e instanceof AIProviderError) {
        this.updateStatus(task.taskId, e.code === 'REQUEST_CANCELLED' ? 'cancelled' : 'failed', onProgress);
        throw e;
      }
      const isAbort = e.name === 'AbortError' || e.message === 'AbortError' || e.message === 'Timeout';
      this.updateStatus(task.taskId, isAbort ? 'cancelled' : 'failed', onProgress);
      throw new AIProviderError({
        code: isAbort ? 'REQUEST_CANCELLED' : 'UNKNOWN_ERROR',
        userMessage: isAbort ? 'İstek iptal edildi.' : (e.userMessage || 'Beklenmeyen bir hata oluştu.'),
        retryable: !isAbort,
      });
    }
  }

  private static async runGemEngine(
    request: SummaryRequest,
    task: AITask,
    onProgress?: (status: AITaskStatus, message?: string, progress?: number) => void
  ): Promise<SummaryResult> {
    this.updateStatus(task.taskId, 'preparing', onProgress, 'Gemini Gem hazırlanıyor...');

    GemController.onStatusChange(task.taskId, (info) => {
      if (onProgress) onProgress('summarizing', info.message, undefined);
    });

    const gemResult = await GemController.summarize({
      taskId: request.taskId,
      videoId: request.video.videoId,
      videoTitle: request.video.title,
      channelName: request.video.channelName,
      videoUrl: request.video.url,
      segments: request.transcript.segments,
      languageCode: request.transcript.languageCode,
      sourceType: request.transcript.sourceType,
      summaryLength: request.options.length,
      outputLanguage: request.options.outputLanguage,
    });

    if (gemResult.success && gemResult.response) {
      const result: SummaryResult = {
        schemaVersion: 1,
        taskId: request.taskId,
        videoId: request.video.videoId,
        providerId: 'gemini-gem',
        model: 'gemini-gem',
        outputLanguage: request.options.outputLanguage,
        summaryLength: request.options.length,
        createdAt: new Date().toISOString(),
        summary: { tr: gemResult.response },
        keyIdeas: [],
        sections: [],
        actionItems: [],
        importantTerms: [],
        warnings: [],
        rawResponseStored: false,
      };
      this.updateStatus(task.taskId, 'completed', onProgress);
      this.cleanup(task.taskId);
      return result;
    }

    // Fallback kullanıldı veya başarısız
    if (gemResult.fallbackUsed) {
      throw new AIProviderError({
        code: 'GEM_AUTOMATION_FAILED',
        userMessage: gemResult.fallbackMessage || 'Gemini otomasyonu başarısız. Transkript panoya kopyalandı.',
        retryable: true,
      });
    }

    throw new AIProviderError({
      code: 'GEM_NOT_CONFIGURED',
      userMessage: 'Gemini Gem ayarları eksik veya geçersiz.',
      retryable: false,
    });
  }

  static async cancelTask(taskId: string): Promise<void> {
    const controller = this.abortControllers.get(taskId);
    if (controller) controller.abort();
    GemController.cancel(taskId);
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = 'cancelled';
      task.updatedAt = Date.now();
      if (task.providerId) {
        const provider = AIProviderRegistry.getProvider(task.providerId);
        if (provider?.cancel) await provider.cancel(taskId).catch(() => {});
      }
    }
    this.cleanup(taskId);
  }

  private static cleanup(taskId: string) {
    this.tasks.delete(taskId);
    this.abortControllers.delete(taskId);
  }

  private static updateStatus(
    taskId: string,
    status: AITaskStatus,
    onProgress?: (status: AITaskStatus, message?: string, progress?: number) => void,
    message?: string
  ) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = Date.now();
      if (onProgress) onProgress(status, message);
    }
  }
}
