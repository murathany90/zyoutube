import { AIProvider, AIProviderId } from './types';
import { OpenAICompatibleProvider } from './providers/openai-compatible-provider';

export class AIProviderRegistry {
  private static providers: Map<AIProviderId, AIProvider> = new Map();

  static {
    this.registerProvider(new OpenAICompatibleProvider());
  }

  static registerProvider(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }

  static getProvider(id: AIProviderId): AIProvider | undefined {
    return this.providers.get(id);
  }

  static getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }
}
