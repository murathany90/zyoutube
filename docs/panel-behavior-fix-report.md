# Panel Davranışı Düzeltme Raporu

## Yapılan Değişiklikler

### 1. Video Altındaki Eklenti İkonu ve Buton Kaldırıldı
- `injectButton()` metodu tamamen silindi
- `updateButtonState()` metodu silindi
- `#zyoutube-toggle-button` butonu artık oluşturulmuyor
- `#zyoutube-toggle-styles` stilleri kaldırıldı
- Content script boyutu ~48.75 kB → ~44.64 kB küçüldü

### 2. Varsayılan Olarak Aktif
- `chrome.runtime.onInstalled` olayında `panelEnabled: true` depolanıyor
- Yeni kurulumlarda panel varsayılan olarak açık
- Testlerde `background.evaluate` ile açık olduğu garanti ediliyor

### 3. Panel Otomatik ve Sürekli Açık
- Her `youtube.com/watch?v=...` sayfasında panel otomatik monteleniyor
- Panel `#secondary-inner` / `#secondary` içine ekleniyor
- Sağ sütun bulunana kadar `MutationObserver` (8sn timeout) bekliyor
- Panel kapatma / gizleme butonu yok — kullanıcı kapatamaz

### 4. SPA Navigasyonu
- `YOUTUBE_URL_CHANGED` mesajı geldiğinde:
  - Navigation kaynakları temizleniyor
  - `currentVideoId` güncelleniyor
  - Panel `renderPanel(newVideoId)` ile yeni videoya göre sıfırlanıyor
  - Panel DOM'dan hiç kaldırılmıyor, sadece içerik değişiyor

### 5. Kontrol Yalnızca Popup'tan
- Popup'ta "Eklenti Aktif" toggle'ı `panelEnabled` değişkenini kontrol ediyor
- `chrome.storage.local.set({ panelEnabled })` ile kaydediliyor
- Broadcast: `START_EXTENSION` / `STOP_EXTENSION` mesajları tüm YouTube sekmelerine gönderiliyor

### 6. Anlık Tepki
- Content script `chrome.storage.onChanged` dinliyor:
  - `panelEnabled: false` → `unmountPanel()`
  - `panelEnabled: true` → `init()` ile panel yeniden monteleniyor
- Ayrıca `PANEL_SETTINGS_CHANGED` mesajı da dinleniyor (eski uyumluluk)

### 7. Popup'tan Anında Kaldırma/Ekleme
- Pasif yapılınca `STOP_EXTENSION` mesajı gönderiliyor → `unmountPanel()`
- Aktif yapılınca `START_EXTENSION` mesajı gönderiliyor → `init()`

### 8. YouTube Sayfasında Hiçbir Kontrol Yok
- Buton, ikon, aç/kapat, gizle, küçült gibi hiçbir UI elemanı yok
- Panel yalnızca popup'taki anahtarla kontrol ediliyor

### 9. Tek Panel Garantisi
- `mountPanel()` zaten `document.getElementById('zyoutube-panel-host')` varlığını kontrol ediyor
- Varsa yenisini oluşturmuyor, sadece `renderPanel()` ile güncelliyor
- Bootstrap'ta eski controller varsa `destroy()` çağrılıyor

### 10. Sağ Sütunda Bekleme
- Panel yalnızca `#secondary-inner` veya `#secondary` bulununca monteleniyor
- `#above-the-fold`, `#top-level-buttons-computed` gibi alanlara asla eklenmiyor
- Bootstrap `MutationObserver` yalnızca `#secondary` varlığını kontrol ediyor (buton satırı beklentisi kaldırıldı)

## Depolama Yapısı

```ts
// chrome.storage.local
{
  panelEnabled: true  // boolean, varsayılan: true
}
```

## Test Sonuçları

```
npm run test (tümü): 42 test, 42 passed
  - test:unit:      31/31 passed
  - test:providers:  6/6 passed
  - test:privacy:    1/1 passed
  - test:fixture:    1/1 passed
  - test:extension:  2/2 passed

tests/panel-behavior.spec.ts (yeni): 7/7 passed
  - İlk kurulumda panel otomatik açık
  - Video altında eklenti ikonu yok
  - Popup toggle kapatınca panel kaldırılıyor
  - Toggle açınca panel geri geliyor
  - SPA video geçişinde panel açık kalıyor
  - Çift panel oluşmuyor
  - Panel sağ sütunda, video altında değil
```

## Ek Düzeltme: CAPTION_RESPONSE_HTML (Transkript Yüklenmeme Sorunu)

**Hata:** Gerçek YouTube videolarında transkript yüklenmiyor, hata: `Altyazı alınamadı: CAPTION_RESPONSE_HTML`

**Kök Neden:** `FETCH_CAPTION` mesajı altyazı fetch'ini service worker üzerinden yapıyordu. Service worker'ın YouTube oturum çerezi (cookie) olmadığı için YouTube, timedtext API isteğine HTML hata sayfası döndürüyordu. Content-type kontrolü (`text/html`) bu yanıtı reddediyordu.

**Çözüm:** Altyazı fetch'i content script'e taşındı. Content script'in YouTube çerezlerine erişimi olduğu için YouTube doğru caption verisini döndürüyor.

Değişiklikler:
- `sendRuntimeMessage('FETCH_CAPTION', ...)` → `fetch(safeUrl)` (doğrudan content script'ten)
- `validateCaptionUrl()` metodu eklendi: hostname allowlist (`youtube.com`, `googlevideo.com`), HTTPS zorunluluğu, URL kimlik bilgisi kontrolü
- Content-type `text/html` kontrolü korundu (güvenlik katmanı)
- `AbortController` desteği korundu
- `FETCH_CAPTION` handler'ı `message-router.ts`'de artık ölü kod (kullanılmıyor)

## Değişen Dosyalar

| Dosya | Değişiklik |
|---|---|
| `src/content/index.tsx` | Button kodu silindi, `YouTubePanelManager` yeniden yazıldı, `panelEnabled` kontrollü panel yönetimi |
| `src/background/index.ts` | `onInstalled`'da `panelEnabled: true` varsayılanı eklendi |
| `src/popup/index.tsx` | İki toggle → tek "Eklenti Aktif" toggle; broadcast `START_EXTENSION`/`STOP_EXTENSION` |
| `src/transcript/youtube-provider.ts` | `sendRuntimeMessage` → doğrudan `fetch()` + URL validasyonu |
| `tests/e2e.spec.ts` | Button beklentileri kaldırıldı, panel auto-open, tek panel, ikon yok kontrolleri eklendi |
| `tests/extension.spec.ts` | Button beklentileri kaldırıldı, panel auto-open, tek panel kontrolleri eklendi |
| `tests/privacy/privacy.spec.ts` | Button beklentileri kaldırıldı, otomatik açılan panel kullanılıyor |
| `tests/panel-behavior.spec.ts` | **YENİ** — 7 panel davranış testi |
