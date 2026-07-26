# Panel & Transkript Düzeltme Raporu

Bu rapor, `fix/panel-transcript-runtime` dalında 7 commit ile tamamlanan hata düzeltmelerini belgeler.

## 1. Kapsanan Hatalar

### E1 — Test panel container ID uyuşmazlığı (P0)
| Alan | Değer |
|---|---|
| **Değişiklik** | Tüm testlerde `#zyoutube-panel-container` → `#zyoutube-panel-host` |
| **Dosyalar** | `tests/e2e.spec.ts`, `tests/extension.spec.ts`, `tests/privacy/privacy.spec.ts` |
| **Detay** | Ayrıca Shadow Root varlığı assertion'ı eklendi |

### E2 — SPA geçişinde paylaşılan durum kirliliği (P1)
| Alan | Değer |
|---|---|
| **Değişiklik** | `resetForNavigation(newVideoId)` metodu eklendi; kaynaklar `navIntervals`/`navTimeouts` vs `persistentTimeouts` olarak ikiye ayrıldı |
| **Dosya** | `src/content/index.tsx` |

### E4 — PING_BACKGROUND timeout korumasız (P1)
| Alan | Değer |
|---|---|
| **Değişiklik** | `runtime-messenger.ts` ile 3sn timeout'lu `sendRuntimeMessage`; `pingBackground` artık `sendRuntimeMessage('PING_BACKGROUND', 3000)` kullanır |
| **Dosya** | `src/content/runtime-messenger.ts` (yeni), `src/content/index.tsx` |

### E5 — Çift message listener (P1)
| Alan | Değer |
|---|---|
| **Değişiklik** | `src/background/message-router.ts` (yeni) tüm mesajları yönetir; `ai-message-handler.ts` kaldırıldı; `index.ts` sadece `setupMessageRouter()` çağırır |
| **Dosyalar** | `src/background/message-router.ts` (yeni), `src/background/index.ts`, `src/background/ai-message-handler.ts` (silindi) |

### E3 — Transkript extraction zinciri kırılgan (P1) / E8 (P2) / E10 (P2)
| Alan | Değer |
|---|---|
| **Değişiklik** | `FETCH_CAPTION` mesajı yapılandırıldı (`{ videoId, track, format }`); service worker'da güvenli fetch (hostname validation: `youtube.com`, `googlevideo.com`; content-type rejection; body sniffing; 15s timeout/5MB limit); `youtube-provider.ts` `sendRuntimeMessage` kullanır |
| **Dosyalar** | `src/background/message-router.ts`, `src/transcript/youtube-provider.ts`, `src/transcript/types.ts` |

### E14 — Retry sırasında service worker uyuyabilir (P3)
| Alan | Değer |
|---|---|
| **Değişiklik** | 10×500ms → bounded backoff `[0, 300, 700, 1200, 2000]ms`; `shouldRetry()` ile `EXTENSION_CONTEXT_INVALIDATED`, `BACKGROUND_UNAVAILABLE`, `BACKGROUND_TIMEOUT`, `REQUEST_CANCELLED`'da retry durdurulur |
| **Dosyalar** | `src/transcript/youtube-provider.ts`, `src/transcript/types.ts` |

### E6 — localhost production manifest'te kalmış (P2) / E9 (P2) / E16 (P2)
| Alan | Değer |
|---|---|
| **Değişiklik** | `#ai-summary-btn` → `#zyoutube-toggle-button`; YouTube CSS sınıfları yerine `.zyoutube-toggle-button`/`.zyoutube-toggle-icon`/`.zyoutube-toggle-label` scoped stilleri (`<style id="zyoutube-toggle-styles">` ile); `localhost:3000` production `manifest.json`'dan kaldırıldı; `manifest.test.json` oluşturuldu; tüm testler YouTube URL route interception kullanır |
| **Dosyalar** | `src/content/index.tsx`, `manifest.json`, `manifest.test.json` (yeni), `tests/e2e.spec.ts`, `tests/extension.spec.ts`, `tests/privacy/privacy.spec.ts` |

## 2. Yeni Dosyalar

| Dosya | Amaç |
|---|---|
| `src/content/runtime-messenger.ts` | Merkezi `sendRuntimeMessage()` — timeout, abort, error-dedup |
| `src/background/message-router.ts` | Tek `chrome.runtime.onMessage` router'ı |
| `manifest.test.json` | Test ortamı manifest'i (`localhost:3000` dahil) |

## 3. Silinen Dosyalar

| Dosya | Gerekçe |
|---|---|
| `src/background/ai-message-handler.ts` | Çift listener sorununu gidermek için message-router'a taşındı |

## 4. Test Sonuçları

```
npm run typecheck → PASSED (0 errors)
npm run build     → PASSED (3.51s)
npm run test:unit → 8 files, 31 tests PASSED
```

## 5. Kalan Notlar

- `docs/independent-bug-audit.md` hâlâ `#ai-summary-btn` referansı içerir (cross-reference tablosu, satır 437) — bu historical bir dokümandır, güncellenmesi zorunlu değildir
- E2E testler (`npm run test`) Playwright + Chromium gerektirir, `headless: false` ile çalışır
