import { describe, it, expect, vi } from 'vitest';

const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn()
    },
    sendMessage: vi.fn()
  }
};
(globalThis as any).chrome = chromeMock;

import { normalizeUnknownError, classifyCorrectionError, createCorrectionError } from './api-worker';

describe('api-worker error logic', () => {
  describe('normalizeUnknownError', () => {
    it('Error objesini dönüştürür', () => {
      const err = new Error('Test error');
      (err as any).code = 'TEST_CODE';
      (err as any).diagnostics = { foo: 'bar' };
      
      const normalized = normalizeUnknownError(err);
      expect(normalized.name).toBe('Error');
      expect(normalized.message).toBe('Test error');
      expect(normalized.code).toBe('TEST_CODE');
      expect(normalized.diagnostics).toEqual({ foo: 'bar' });
      expect(normalized.stack).toBeDefined();
    });

    it('String tipinde hatayı dönüştürür', () => {
      const normalized = normalizeUnknownError('String error message');
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('String error message');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });

    it('Object tipinde hatayı dönüştürür', () => {
      const normalized = normalizeUnknownError({ someKey: 'someValue' });
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('{"someKey":"someValue"}');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });

    it('Boş objede veya bilinmeyen tipte fallback', () => {
      const normalized = normalizeUnknownError(null);
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('null');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });
  });

  describe('classifyCorrectionError', () => {
    it('HTTP hatalarını http_status veya http olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('Fetch failed'));
      err.code = 'HTTP_504';
      
      const classification = classifyCorrectionError(err);
      expect(classification.stage).toBe('http');

      err.code = 'HTTP_NETWORK_ERROR';
      expect(classifyCorrectionError(err).stage).toBe('http');
    });

    it('JSON hatalarını parsing olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('SyntaxError'));
      err.code = 'CORRECTION_JSON_PARSE_FAILED';
      expect(classifyCorrectionError(err).stage).toBe('parsing');
    });

    it('Schema/Validation hatalarını validation olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('Invalid schema'));
      err.code = 'CORRECTION_SCHEMA_INVALID';
      expect(classifyCorrectionError(err).stage).toBe('validation');

      err.code = 'CORRECTION_LANGUAGE_MISSING';
      expect(classifyCorrectionError(err).stage).toBe('validation');
    });

    it('Diğer hataları streaming olarak tanımlar', () => {
      const err = normalizeUnknownError(new Error('Streaming Error'));
      err.code = 'STREAM_READ_FAILED';
      expect(classifyCorrectionError(err).stage).toBe('streaming');
    });
  });

  describe('createCorrectionError', () => {
    it('Diagnostics ile Error nesnesi oluşturur', () => {
      const err = createCorrectionError('CORRECTION_TEST_ERROR', 'Açıklayıcı mesaj', { count: 5 });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Açıklayıcı mesaj');
      expect((err as any).code).toBe('CORRECTION_TEST_ERROR');
      expect((err as any).diagnostics).toEqual({ count: 5 });
    });
  });
});
