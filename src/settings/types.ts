import { SummaryEngine } from '../gem/types';

// Eski API provider'ları için
export type AIProviderId = 'openai-compatible' | 'chrome-local';

export interface CorrectedBilingualSentence {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  sourceSegmentIds: string[];

  originalTurkish: string;
  originalEnglish: string;

  correctedTurkish: string;
  correctedEnglish: string;

  sourceLanguage: "tr" | "en";
  confidence?: number;
  warnings?: string[];
}


export interface AIProviderConfig {
  id: AIProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  correctionTimeoutMs?: number;
  correctionFirstByteTimeoutMs?: number;
  correctionStreamIdleTimeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  contextWindowTokens?: number;
  customHeaders?: Record<string, string>;
  isSessionStorage?: boolean;
  responseMode?: 'markdown' | 'json';
  enableReasoning?: boolean;
  summaryJsonMode?: boolean;
  summaryStreaming?: boolean;
  summaryStreamOptions?: boolean;
  summaryCompatibilityVersion?: number;
  summaryTokenParam?: 'max_tokens' | 'max_completion_tokens';
  summaryFirstByteTimeoutMs?: number;
  summaryStreamIdleTimeoutMs?: number;
  correctionJsonMode?: boolean;
  correctionMaxTokens?: number;
  correctionStreaming?: boolean;
  correctionStreamOptions?: boolean;
  correctionTokenParam?: 'max_tokens' | 'max_completion_tokens';
  correctionEnableReasoning?: boolean;
  correctionCompatibilityVersion?: number;
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
      timeoutMs: 180000,
      correctionTimeoutMs: 600000,
      correctionFirstByteTimeoutMs: 60000,
      correctionStreamIdleTimeoutMs: 45000,
      temperature: 0.1,
      maxTokens: 4000,
      contextWindowTokens: 130000,
      isSessionStorage: false,
      responseMode: 'markdown',
      enableReasoning: false,
      summaryJsonMode: false,
      summaryStreaming: true,
      summaryStreamOptions: true,
      summaryCompatibilityVersion: 1,
      summaryTokenParam: 'max_tokens',
      summaryFirstByteTimeoutMs: 60000,
      summaryStreamIdleTimeoutMs: 45000,
      correctionJsonMode: false,
      correctionMaxTokens: 16384,
      correctionStreaming: true,
      correctionStreamOptions: true,
      correctionTokenParam: 'max_tokens',
      correctionEnableReasoning: false,
      correctionCompatibilityVersion: 3
    },
    'chrome-local': {
      id: 'chrome-local'
    }
  }
};
