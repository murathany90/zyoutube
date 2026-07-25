import { AIError, AIErrorCode, AIProviderId } from './types';

export class AIProviderError extends Error implements AIError {
  code: AIErrorCode;
  userMessage: string;
  retryable: boolean;
  providerId?: AIProviderId;
  statusCode?: number;
  debugMessage?: string;

  constructor(params: {
    code: AIErrorCode;
    userMessage: string;
    retryable: boolean;
    providerId?: AIProviderId;
    statusCode?: number;
    debugMessage?: string;
  }) {
    super(params.userMessage);
    this.name = 'AIProviderError';
    this.code = params.code;
    this.userMessage = params.userMessage;
    this.retryable = params.retryable;
    this.providerId = params.providerId;
    this.statusCode = params.statusCode;
    this.debugMessage = params.debugMessage;
  }
}
