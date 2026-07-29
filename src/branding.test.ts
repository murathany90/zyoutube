import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';
import testManifest from '../manifest.test.json';
import packageJson from '../package.json';
import icon16 from '../public/icons/zyoutube-ai-16.png?url';
import icon32 from '../public/icons/zyoutube-ai-32.png?url';
import icon48 from '../public/icons/zyoutube-ai-48.png?url';
import icon128 from '../public/icons/zyoutube-ai-128.png?url';

describe('ZYouTube AI branding', () => {
  it('uses the product name and icon set in both extension manifests', () => {
    const icons = {
      16: 'icons/zyoutube-ai-16.png',
      32: 'icons/zyoutube-ai-32.png',
      48: 'icons/zyoutube-ai-48.png',
      128: 'icons/zyoutube-ai-128.png',
    };

    expect(manifest.name).toBe('ZYouTube AI');
    expect(manifest.icons).toEqual(icons);
    expect(manifest.action.default_title).toBe('ZYouTube AI');
    expect(manifest.action.default_icon).toEqual(icons);

    expect(testManifest.name).toBe('ZYouTube AI (Test)');
    expect(testManifest.icons).toEqual(icons);
    expect(testManifest.action.default_title).toBe('ZYouTube AI (Test)');
    expect(testManifest.action.default_icon).toEqual(icons);

    expect([icon16, icon32, icon48, icon128]).toHaveLength(4);
  });

  it('uses the product name in package metadata', () => {
    expect(packageJson.name).toBe('zyoutube-ai');
  });
});
