import { TranscriptSegment } from '../transcript/types';

export type AIProviderId = 'gemini-api' | 'openai-compatible' | 'chrome-local' | 'gemini-gem';

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
  providerId: AIProviderId;
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
}

export interface ProviderExecutionContext {
  signal?: AbortSignal;
  onProgress?: (status: string, progress?: number) => void;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly displayName: string;

  isConfigured(): Promise<boolean>;
  validateConfiguration(): Promise<ProviderValidationResult>;
  testConnection(signal?: AbortSignal): Promise<ConnectionTestResult>;

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
  | 'UNKNOWN_ERROR';

export interface AIError {
  code: AIErrorCode;
  userMessage: string;
  retryable: boolean;
  providerId?: AIProviderId;
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
  providerId: AIProviderId;
  status: AITaskStatus;
  createdAt: number;
  updatedAt: number;
}
