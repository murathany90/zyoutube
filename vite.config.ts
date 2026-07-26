/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

/**
 * @crxjs/vite-plugin'in bilinen bir hatası:
 * Content script'ler YouTube gibi sayfaların bağlamında çalışır.
 * Vite'ın varsayılan preload helper'ı asset yollarını "/" + path şeklinde çözümler.
 * Bu da tarayıcının bunları youtube.com/assets/... olarak yorumlamasına neden olur.
 * 
 * Bu plugin, üretilen kodda "/" + path ifadesini chrome.runtime.getURL(path) ile değiştirir.
 */
function crxPreloadFix(): Plugin {
  return {
    name: 'crx-preload-fix',
    enforce: 'post',
    renderChunk(code, chunk) {
      // preload-helper chunk'ındaki "/" + path → chrome.runtime.getURL(path) değişimi
      if (chunk.fileName.includes('preload-helper')) {
        return code.replace(
          /return\s*["']\/?["']\s*\+\s*(\w+)/g,
          'return (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL($1) : "/" + $1'
        );
      }
      
      // __vite__mapDeps içinde "assets/" ile başlayan yolları chrome.runtime.getURL ile düzelt
      if (code.includes('__vite__mapDeps')) {
        return code.replace(
          /const\s+__vite__mapDeps\s*=\s*\(([^)]*)\)\s*=>/,
          (match, args) => {
            return match; // Keep as-is, fix in preload helper is sufficient
          }
        );
      }
      
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
    crxPreloadFix(),
  ],
  build: {
    rollupOptions: {
      input: {
        history: 'history.html'
      }
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
