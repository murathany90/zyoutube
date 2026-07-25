import { AIProviderId } from '../ai/types';

export interface AIProviderConfig {
  id: AIProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  customHeaders?: Record<string, string>;
  isSessionStorage?: boolean;
}

export interface ExtensionSettings {
  defaultProviderId: AIProviderId;
  defaultLength: 'short' | 'standard' | 'detailed';
  defaultLanguage: 'tr' | 'en' | 'tr-en';
  playTimestampOnClick: boolean;
  providers: Record<string, AIProviderConfig>;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  defaultProviderId: 'gemini-api',
  defaultLength: 'standard',
  defaultLanguage: 'tr-en',
  playTimestampOnClick: true,
  providers: {
    'gemini-api': {
      id: 'gemini-api',
      model: 'gemini-2.5-flash',
      timeoutMs: 30000,
      temperature: 0.7,
      isSessionStorage: false
    },
    'openai-compatible': {
      id: 'openai-compatible',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      timeoutMs: 30000,
      temperature: 0.7,
      isSessionStorage: false
    },
    'chrome-local': {
      id: 'chrome-local'
    }
  }
};
