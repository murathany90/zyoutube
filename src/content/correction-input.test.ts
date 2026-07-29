import { describe, expect, it } from 'vitest';
import { prepareCorrectionInput } from './correction-input';

const segment = {
  id: 'seg-1',
  startTimeMs: 0,
  endTimeMs: 1000,
  cleanText: 'Merhaba'
};

describe('prepareCorrectionInput', () => {
  it('Türkçe-only transkripti İngilizce alanı boşken kullanılabilir tutar', () => {
    const input = prepareCorrectionInput([segment], 'tr');

    expect(input.sourceCharacterCount).toBeGreaterThan(0);
    expect(input.englishCharacterCount).toBe(0);
    expect(input.mappedSegments[0]).toMatchObject({
      turkish: 'Merhaba',
      english: ''
    });
  });

  it('İngilizce-only transkripti Türkçe alanı boşken kullanılabilir tutar', () => {
    const input = prepareCorrectionInput([
      { ...segment, cleanText: 'Hello' }
    ], 'en');

    expect(input.sourceCharacterCount).toBeGreaterThan(0);
    expect(input.turkishCharacterCount).toBe(0);
    expect(input.mappedSegments[0]).toMatchObject({
      turkish: '',
      english: 'Hello'
    });
  });
});
