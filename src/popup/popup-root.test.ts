import { describe, expect, it } from 'vitest';
import { getPopupRoot } from './popup-root';

describe('getPopupRoot', () => {
  it('HTML ile paylasilan root elementini dondurur', () => {
    const root = {} as HTMLElement;
    const documentLike = {
      getElementById: (id: string) => id === 'root' ? root : null
    };

    expect(getPopupRoot(documentLike)).toBe(root);
  });

  it('yalniz eski app-root varsa acik hata verir', () => {
    const documentLike = {
      getElementById: (id: string) => id === 'app-root' ? {} as HTMLElement : null
    };

    expect(() => getPopupRoot(documentLike)).toThrow(
      'Popup root element #root bulunamadı.'
    );
  });
});
