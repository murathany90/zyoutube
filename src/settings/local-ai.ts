export interface LocalAIStatus {
  isSupported: boolean;
  isReady: boolean;
  capabilities?: any;
  needsDownload?: boolean;
}

export class LocalAIChecker {
  static async checkStatus(): Promise<LocalAIStatus> {
    // Runtime feature detection for Chrome built-in AI (window.ai)
    const ai = (window as any).ai;
    
    if (!ai) {
      return {
        isSupported: false,
        isReady: false
      };
    }

    try {
      // Chrome's experimental AI usually has languageModel or textSession
      if (ai.languageModel && typeof ai.languageModel.capabilities === 'function') {
        const capabilities = await ai.languageModel.capabilities();
        
        return {
          isSupported: true,
          isReady: capabilities.available === 'readily',
          needsDownload: capabilities.available === 'after-download',
          capabilities
        };
      }
      
      return {
        isSupported: true,
        isReady: false
      };
    } catch (e) {
      return {
        isSupported: true,
        isReady: false
      };
    }
  }
}
