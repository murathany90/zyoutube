import { AIProviderConfig } from './types';
import { ProviderValidationResult } from '../ai/types';

export class ConfigValidator {
  static validate(config: AIProviderConfig): ProviderValidationResult {
    const errors: string[] = [];

    if (!config.apiKey && config.id !== 'chrome-local') {
      errors.push('API anahtarı eksik.');
    }

    if (config.baseUrl) {
      try {
        const url = new URL(config.baseUrl);

        if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
          errors.push('Base URL güvenli (https) olmalıdır.');
        }

        if (['file:', 'javascript:', 'data:'].includes(url.protocol)) {
          errors.push('Geçersiz URL şeması.');
        }

        if (url.username || url.password) {
          errors.push('URL içinde kullanıcı adı/şifre bulunamaz.');
        }
      } catch (e) {
        errors.push('Geçersiz Base URL formatı.');
      }
    }

    // Ek header doğrulama
    if (config.customHeaders) {
      const blockedHeaders = ['host', 'content-length', 'origin', 'referer', 'cookie', 'set-cookie'];
      for (const key of Object.keys(config.customHeaders)) {
        if (blockedHeaders.includes(key.toLowerCase())) {
           errors.push(`Header "${key}" değiştirilemez.`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
