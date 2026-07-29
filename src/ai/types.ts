import { TranscriptSegment } from '../transcript/types';
import { SummaryEngine } from '../gem/types';

export type AIProviderId = 'openai-compatible' | 'chrome-local';

export interface SummaryRequest {
  taskId: string;
  video: {
    videoId: string;
    title: string;
    channelName?: string;
    url: string;
    durationMs?: number | null;
  };
  transcript: {
    languageCode: string;
    sourceType: 'manual' | 'automatic' | 'translated' | 'unknown';
    qualityLevel: 'high' | 'medium' | 'low';
    qualityReasons: string[];
    segments: TranscriptSegment[];
  };
  options: {
    length: 'short' | 'standard' | 'detailed';
    outputLanguage: 'tr' | 'en' | 'tr-en';
    includeKeyIdeas: boolean;
    includeSections: boolean;
    includeActionItems: boolean;
  };
  engine?: SummaryEngine;
}

export interface CorrectionRequest {
  taskId: string;
  video: {
    videoId: string;
    title: string;
  };
  transcript: {
    sourceLanguage: 'tr' | 'en';
    segments: Array<{
      id: string;
      startTimeMs: number;
      endTimeMs: number;
      turkish: string;
      english: string;
    }>;
  };
}

export interface LocalizedText {
  tr?: string;
  en?: string;
}

export interface KeyIdea {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
}

export interface SummarySection {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
}

export interface ImportantTerm {
  term: string;
  explanation: LocalizedText;
  startTimeMs?: number | null;
}

export interface SummaryResult {
  schemaVersion: 1;
  taskId: string;
  videoId: string;
  providerId: AIProviderId | 'gemini-gem';
  model: string;
  outputLanguage: 'tr' | 'en' | 'tr-en';
  summaryLength: 'short' | 'standard' | 'detailed';
  createdAt: string;

  title?: string;
  summary: LocalizedText;
  keyIdeas: KeyIdea[];
  sections: SummarySection[];
  actionItems: LocalizedText[];
  importantTerms: ImportantTerm[];
  warnings: LocalizedText[];

  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  rawResponseStored: boolean;
}

export interface ProviderValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  latencyMs?: number;
  limits?: string;
}

export type PromptType = 'single' | 'chunk' | 'merge';

export interface ProviderExecutionContext {
  signal?: AbortSignal;
  onProgress?: (status: string, progress?: number) => void;
  promptType?: PromptType;
  customContent?: string;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;

  isConfigured(): Promise<boolean>;
  validateConfiguration(): Promise<ProviderValidationResult>;
  testConnection(
    signal?: AbortSignal,
    requestType?: 'summary' | 'correction'
  ): Promise<ConnectionTestResult>;

  summarize(
    request: SummaryRequest,
    context: ProviderExecutionContext
  ): Promise<SummaryResult>;

  cancel?(taskId: string): Promise<void>;
}

export type AIErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PERMISSION_REQUIRED'
  | 'INVALID_API_KEY'
  | 'MODEL_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_CANCELLED'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'CONTENT_BLOCKED'
  | 'TRANSCRIPT_TOO_LONG'
  | 'VIDEO_CHANGED'
  | 'GEM_NOT_CONFIGURED'
  | 'GEM_AUTOMATION_FAILED'
  | 'UNKNOWN_ERROR';

export interface AIError {
  code: AIErrorCode;
  userMessage: string;
  retryable: boolean;
  providerId?: AIProviderId | 'gemini-gem';
  statusCode?: number;
  debugMessage?: string;
}

export type AITaskStatus =
  | 'queued'
  | 'preparing'
  | 'chunking'
  | 'summarizing'
  | 'merging'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface AITask {
  taskId: string;
  tabId: number;
  videoId: string;
  engine: SummaryEngine;
  providerId?: AIProviderId;
  status: AITaskStatus;
  createdAt: number;
  updatedAt: number;
}
