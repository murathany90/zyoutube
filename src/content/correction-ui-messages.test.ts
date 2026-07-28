import { describe, expect, it } from 'vitest';
import { CORRECTION_SAVE_FAILED_MESSAGE } from './correction-ui-messages';

describe('correction UI messages', () => {
  it('kayit hatasini tamamlanan sonucu kaybetmeden aciklar', () => {
    expect(CORRECTION_SAVE_FAILED_MESSAGE).toContain(
      'Düzeltme tamamlandı fakat kaydedilemedi'
    );
  });
});
