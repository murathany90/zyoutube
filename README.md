# YouTube AI Özet ve Transkript Eklentisi (Manifest V3)

Bu proje, React, Vite, TypeScript ve TailwindCSS kullanarak geliştirilmiş, doğrudan YouTube video sayfası içerisine enjekte edilen gelişmiş bir yapay zekâ destekli video özetleme ve transkript eklentisidir.

## Özellikler

- **Doğrudan Arayüz Entegrasyonu**: Chrome Side Panel yerine doğrudan YouTube oynatıcısının altına "AI Özet" paneli enjekte edilir. Bu sayede videoyu izlerken özet ve transkript sekmelerine kesintisiz erişebilirsiniz.
- **Güvenli AI Sağlayıcıları**:
  - Gemini API desteği
  - OpenAI Uyumlu API desteği (DeepSeek, Local LLM'ler vb.)
  - Chrome Yerel AI (window.ai) desteği
- **Gelişmiş Transkript Yakalama**: İzole edilmiş Content Script sınırlarını aşarak YouTube oynatıcısının verisine `executeScript({ world: 'MAIN' })` üzerinden doğrudan erişir. Otomatik oluşturulmuş ve elle eklenmiş altyazıları kusursuz ayrıştırır.
- **Güvenli Ayarlar Yönetimi**: API anahtarları `chrome.storage.local` ve `session` üzerinde tutulur. Sayfaya hiçbir zaman enjekte edilmez. İstekler Background Service Worker üzerinden atılır.
- **Gelişmiş Hata Yönetimi**: Ağ hataları, eksik API anahtarları, model limit aşımı ve Markdown içinde dönen bozuk JSON'ları otomatik ayrıştıran (fallback destekli) bir altyapı.
- **Kapsamlı Test Altyapısı**: Vitest birim testleri ve Playwright destekli uçtan uca (E2E) gerçek paket doğrulama testleri içerir.

## Teknolojiler

- **React 18**
- **TypeScript**
- **Vite**
- **TailwindCSS** (Görsel tutarlılık ve hızlı prototipleme)
- **Manifest V3**
- **Playwright & Vitest**

## Kurulum ve Derleme

Eklentiyi geliştirme ortamında kurmak ve derlemek için aşağıdaki adımları izleyin:

```bash
# Bağımlılıkları yükleyin
npm install

# Geliştirme modunda çalıştırın (Değişiklikleri otomatik derler)
npm run dev

# Veya production için build alın
npm run build
```

Build alındıktan sonra `dist` klasörü oluşacaktır.

## Chrome'a Yükleme

1. Chrome tarayıcınızda `chrome://extensions/` adresine gidin.
2. Sağ üst köşeden **Geliştirici modu**nu (Developer mode) aktif edin.
3. **Paketlenmemiş öğe yükle** (Load unpacked) butonuna tıklayın.
4. Projenin bulunduğu dizindeki `dist` klasörünü seçin.

## Testleri Çalıştırma

Projede üç seviye test bulunmaktadır:

1. **Birim Testler (Unit)**: Algoritmaları (Transcript temizleme, JSON parse etme vb.) test eder.
2. **Fixture (Bileşen) Testleri**: React bileşenlerinin sanal DOM üzerinde oluşturulmasını test eder.
3. **Extension E2E Testi**: `dist` dizinindeki gerçek paketi Chrome'a yükleyerek uçtan uca senaryoları doğrular.

Tüm testleri çalıştırmak için:
```bash
npm run test
```

Veya spesifik olarak:
```bash
npm run test:unit
npm run test:fixture
npm run test:extension
```

## Mimari

- **`src/ai`**: Yapay Zekâ sağlayıcıları, JSON Response Parser, Prompt Builder ve Görev Yöneticisi (Task Manager).
- **`src/background`**: Service Worker işlemleri. Mesaj yakalama, ağ kısıtlamalarını yönetme ve izolasyonlu veriye ulaşma işlemleri.
- **`src/content`**: YouTube DOM yapısına düğmelerin ve React panelinin MutationObserver kullanılarak enjekte edilmesi.
- **`src/popup`**: Yalnızca eklenti ayarlarının, sağlayıcı testlerinin ve API key/token girişinin yapıldığı bağımsız menü arayüzü.
- **`src/settings`**: Konfigürasyon ve doğrulama işlemleri (Validation rules, Session vs. Local Storage kararları).
- **`src/transcript`**: YouTube'un XML formatlı transkript yapısının okunup, temizlenip zaman damgalı objelere (Segment) dönüştürülmesi.

## Lisans

Bu proje kişisel kullanım/geliştirme amaçlıdır.
