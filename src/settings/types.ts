import { SummaryEngine } from '../gem/types';

// Eski API provider'ları için
export type AIProviderId = 'openai-compatible' | 'chrome-local';

export interface AIProviderConfig {
  id: AIProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  customHeaders?: Record<string, string>;
  isSessionStorage?: boolean;
  responseMode?: 'markdown' | 'json';
}

export interface ExtensionSettings {
  defaultEngine: SummaryEngine;
  defaultLength: 'short' | 'standard' | 'detailed';
  defaultLanguage: 'tr' | 'en' | 'tr-en';
  playTimestampOnClick: boolean;
  providers: Record<string, AIProviderConfig>;
  // Eski uyumluluk: migration sırasında hâlâ okunabilir
  defaultProviderId?: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultEngine: 'gemini-gem',
  defaultLength: 'standard',
  defaultLanguage: 'tr-en',
  playTimestampOnClick: true,
  providers: {
    'openai-compatible': {
      id: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      timeoutMs: 30000,
      temperature: 0.7,
      contextWindowTokens: 130000,
      isSessionStorage: false
    },
    'chrome-local': {
      id: 'chrome-local'
    }
  }
};
