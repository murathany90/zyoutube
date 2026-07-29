# ZYouTube AI

ZYouTube AI, YouTube video sayfalarına doğrudan yerleşen bir Chrome Manifest V3
eklentisidir. Gerçek video altyazısını yakalar, etkileşimli transkript olarak
gösterir, OpenAI uyumlu API veya Gemini Gem ile özet üretir, transkripti yapay
zeka ile düzeltir ve sonuçları yerel geçmişte saklar.

Eklenti React, TypeScript, Vite ve CRXJS ile geliştirilmiştir. Kullanıcı verileri
ve API ayarları tarayıcı içinde tutulur; `.env` yalnız yerel canlı test
otomasyonu tarafından okunur.

## Özellikler

- YouTube video sayfasına gömülü özet ve transkript paneli
- Gerçek YouTube altyazısının ağ yanıtından veya güvenli fallback zincirinden alınması
- Zaman damgalı, aranabilir ve videoyla eş zamanlı transkript görünümü
- Türkçe ve İngilizce yan yana transkript desteği
- OpenAI uyumlu API ile transkript düzeltme
- OpenAI uyumlu API ile video özeti
- Kayıtlı Gemini Gem üzerinden tarayıcı tabanlı özet üretme
- Uzun transkriptler için sıralı ve kontrollü parçalara ayırma
- Düzeltme sonuçlarını CorrectionDB içinde saklama
- Transkript, düzeltme ve özet kayıtlarını History ekranında gösterme
- Transcript-only videoları popup listesinde ve detay ekranında görüntüleme
- Açık ve koyu YouTube temalarıyla uyumlu Shadow DOM arayüzü
- API anahtarı, prompt ve response body içermeyen güvenli hata telemetrisi

## Kullanıcı Akışları

### Transkript

1. Kullanıcı altyazısı bulunan bir YouTube videosunu açar.
2. `caption-network-hook.ts`, sayfanın kendi `/api/timedtext` yanıtlarını
   `document_start` aşamasından itibaren gözlemler.
3. `youtube-provider.ts` yakalanan altyazıyı ayrıştırır ve temizler.
4. Transkript panelde zaman damgalarıyla gösterilir.
5. Video kaydı, özet üretilmemiş olsa bile History içinde görünür.

Altyazı yakalama sırası:

1. Sayfanın kendi native caption response body verisi
2. Uygun videolarda doğrudan caption isteği
3. YouTube transkript panelinin DOM üzerinden okunması

Bu sıra, korumalı caption URL'lerini yeniden üretme ve gereksiz yinelenen ağ
istekleri oluşturma riskini azaltır.

### API ile düzeltme

1. Görünen transkript normalize edilir.
2. Uzun girişler segment ve karakter sınırlarına göre parçalara ayrılır.
3. Parçalar sınırlı eş zamanlılıkla OpenAI uyumlu provider'a gönderilir.
4. SSE veya normal HTTP yanıtı güvenli response reader tarafından işlenir.
5. Correction parser cümleleri zaman aralıklarıyla eşleştirir.
6. Sonuç `TranscriptTab` içinde gösterilir.
7. CorrectionDB kaydı oluşturulur ve History görünümü güncellenir.

CorrectionDB kaydı başarısız olursa düzeltilmiş sonuç ekranda tutulur ve
`Düzeltme tamamlandı fakat kaydedilemedi` uyarısı gösterilir.

### API ile özet

Transkript OpenAI uyumlu provider'a gönderilir. Streaming veya non-streaming
yanıt parse edildikten sonra sonuç özet kartına ve History kaydına aktarılır.
Background sonucu content script'e teslim edilmeden geçici session kaydı
silinmez.

### Gemini Gem ile özet

Eklenti, ayarlarda kayıtlı Gemini Gem adresini kullanır. Aynı Gem için mevcut
sekme tekrar kullanılır; aynı görev için yinelenen sekme açılmaz. Tamamlanan
yanıt normalize edilerek YouTube üzerindeki özet kartına ve History kaydına
aktarılır.

Gemini akışı için ilgili Chrome profilinde Google hesabının oturum açmış olması
gerekir.

## Provider Uyumluluğu

OpenAI uyumlu provider ayarlarında aşağıdaki seçenekler desteklenir:

- `max_tokens` veya `max_completion_tokens`
- Streaming açık veya kapalı
- `stream_options` açık veya kapalı
- JSON mode açık veya kapalı
- Normal JSON, SSE veya düz metin HTTP 200 yanıtları

Streaming parser şu biçimleri destekler:

- `data: {...}`
- `data:{...}`
- Birden fazla chunk'a bölünmüş SSE satırları
- Satır sonu olmadan kapanan son buffer
- `[DONE]`
- `finish_reason`
- `delta.content`
- `message.content`
- `reasoning_content`

`reasoning_content` yalnız tanılama metriği olarak ayrı izlenir ve final cevap
olarak kullanılmaz. Provider tam `message.content` snapshot'larını tekrar
gönderirse önceki snapshot değiştirilir; içerik üst üste eklenerek yapay biçimde
büyütülmez.

İstek yaşam döngüsünde kullanıcı iptali ile timeout ayrıdır:

- Kullanıcı iptali: `CORRECTION_CANCELLED`
- İlk byte, stream idle veya toplam süre timeout'u: `CORRECTION_TIMEOUT`

Loglar yalnız HTTP status, güvenli hata kodu, content-type, ilk byte süresi,
chunk sayısı, alınan karakter/byte sayısı ve son SSE event zamanı gibi metadata
içerir. API anahtarı, prompt ve response body loglanmaz.

## Kurulum

Gereksinimler:

- Node.js 18 veya üzeri
- npm
- Chrome veya Chromium tabanlı bir tarayıcı

Bağımlılıkları kurun:

```bash
npm install
```

Temiz production build alın:

```bash
npm run build:clean
```

Chrome'a yüklemek için:

1. `chrome://extensions/` sayfasını açın.
2. Geliştirici modunu etkinleştirin.
3. `Paketlenmemiş öğe yükle` seçeneğine tıklayın.
4. Proje içindeki `dist` klasörünü seçin.
5. YouTube video sayfasını yenileyin.

## Eklenti Ayarları

Popup içindeki `ZYouTube AI Ayarları` ekranından provider yapılandırılır:

- API base URL
- API anahtarı
- Model ID
- Token parametresi
- Maksimum token
- Streaming
- Stream options
- JSON mode
- Gemini Gem URL

API anahtarı Git deposuna veya build çıktısına yazılmaz. Ayarlar
`chrome.storage.local` içinde saklanır ve yalnız yapılandırılan provider isteği
için kullanılır.

## Yerel `.env`

`.env` dosyası çalışma zamanı extension ayarı değildir. Yalnız gerçek API,
YouTube ve Gemini kabul testlerinin yerel girdilerini sağlar. Dosya `.gitignore`
kapsamındadır.

Örnek:

```env
ZYOUTUBE_API_BASE_URL=https://provider.example/v1
ZYOUTUBE_API_KEY=yerel-gizli-deger
ZYOUTUBE_API_MODEL=model-id

ZYOUTUBE_CORRECTION_MAX_TOKENS=16384
ZYOUTUBE_CORRECTION_TOKEN_PARAM=max_tokens
ZYOUTUBE_CORRECTION_STREAMING=true
ZYOUTUBE_CORRECTION_STREAM_OPTIONS=true
ZYOUTUBE_CORRECTION_JSON_MODE=false

ZYOUTUBE_SUMMARY_MAX_TOKENS=4000
ZYOUTUBE_SUMMARY_TOKEN_PARAM=max_tokens
ZYOUTUBE_SUMMARY_STREAMING=false
ZYOUTUBE_SUMMARY_STREAM_OPTIONS=false
ZYOUTUBE_SUMMARY_JSON_MODE=true

ZYOUTUBE_LIVE_USER_DATA_DIR=<existing-chrome-user-data-directory>
ZYOUTUBE_GEM_URL=https://gemini.google.com/gem/your-gem-id
```

Gerçek secret, Gemini URL veya Chrome profil yolu README, test çıktısı, commit
ya da issue içine eklenmemelidir.

Canlı testler geçici profil oluşturmaz. `ZYOUTUBE_LIVE_USER_DATA_DIR` ile
belirtilen gerçek profil kilitliyse test durur. Tek Chrome penceresinin birden
fazla `chrome.exe` süreci oluşturması normaldir; süreç sayısı profil sayısı
olarak yorumlanmaz.

## Komutlar

Geliştirme:

```bash
npm run dev
```

İkonları SVG kaynaktan yeniden üretme:

```bash
npm run icons:generate
```

Statik doğrulamalar ve build:

```bash
npm run typecheck
npm run build:clean
```

Birim ve provider testleri:

```bash
npm run test:unit
npm run test:providers
```

Extension testleri:

```bash
npm run test:privacy
npm run test:fixture
npm run test:extension
```

`test:extension`, eski `dist` çıktısının yanlış pozitif üretmesini önlemek için
önce zorunlu olarak temiz build alır.

Gerçek tarayıcı kabul testleri:

```bash
npm run test:live-correction
npm run test:live-summary
npm run test:live-gemini
```

Canlı test zincirleri fixture kullanmadan şu sınırları doğrular:

```text
.env -> unpacked extension -> YouTube -> API/Gemini
     -> parser -> UI -> CorrectionDB -> History
```

## Mimari

Başlıca modüller:

```text
src/
  ai/          Prompt, parser, chunker ve provider sözleşmeleri
  background/  Service worker, mesaj yönlendirme ve terminal sonuç teslimi
  content/     YouTube paneli, transkript, özet ve Gemini content script
  gem/         Gemini görev, sekme ve sonuç yönetimi
  history/     Yerel kitaplık ve detay sayfası
  offscreen/   API fetch, SSE okuma, timeout ve correction chunk yürütme
  popup/       Ayarlar ve yerel video listesi
  settings/    Provider ayarları, doğrulama ve storage erişimi
  transcript/  Caption yakalama, parse, kalite ve CorrectionDB
```

Temel çalışma zamanı veri akışı:

```text
YouTube MAIN world caption hook
  -> isolated content script
  -> transcript parser/cleaner
  -> React panel
  -> background router
  -> offscreen API worker veya Gemini tab manager
  -> response parser
  -> content script terminal delivery
  -> CorrectionDB / History
```

Offscreen document, Manifest V3 service worker yaşam döngüsünden bağımsız
streaming response okumak için kullanılır. Background katmanı görev kimliği ve
sonuç teslimini yönetir; UI katmanı yalnız kullanıcı durumu ve görünümü işler.

## Veri ve Gizlilik

- API anahtarları kaynak koda gömülmez.
- `.env`, `dist`, `test-results` ve Chrome profil verileri commit edilmez.
- Hata loglarında prompt veya provider response body bulunmaz.
- HTTP hata body içeriği kullanıcı konsoluna yazılmaz.
- CorrectionDB ve History verileri kullanıcının yerel tarayıcı profilindedir.
- Canlı testler console ve DOM içinde secret sızıntısı kontrolü yapar.
- Optional provider host izni yalnız kullanıcı yapılandırması gerektiğinde
  kullanılır.

## Sorun Giderme

### Popup beyaz ekran gösteriyor

Önce temiz build alın:

```bash
npm run build:clean
```

Ardından `dist` extension'ını Chrome üzerinden yeniden yükleyin. Popup HTML ve
React aynı `root` mount hedefini kullanır.

### API isteği çok uzun sürüyor

- Streaming seçeneğinin provider tarafından gerçekten desteklendiğini kontrol edin.
- Gerekirse streaming ve `stream_options` seçeneklerini kapatın.
- Provider'ın beklediği token parametresini seçin.
- Console'daki güvenli timeout kodunu kontrol edin.
- Milyonlarca karakter görünüyorsa güncel build'in yüklendiğini doğrulayın.

### Gemini sonucu gelmiyor

- Profilde Gemini oturumunun açık olduğunu kontrol edin.
- Gem URL'nin erişilebilir ve doğru hesaba ait olduğunu doğrulayın.
- Aynı profil başka Chrome süreci tarafından kilitliyse canlı testi başlatmayın.

### Transkript bulunamıyor

- Videoda kullanılabilir altyazı bulunduğunu kontrol edin.
- YouTube sayfasını extension yeniden yüklendikten sonra yenileyin.
- Yaş, bölge veya oturum kısıtlaması bulunan videolarda ilgili profilin erişimini
  doğrulayın.

## Katkı ve Doğrulama

Kod değişikliğini göndermeden önce en az aşağıdaki kapıyı çalıştırın:

```bash
npm run typecheck
npm run test:unit
npm run test:providers
npm run build:clean
git diff --check
```

API, transcript veya tarayıcı otomasyonu değiştiğinde ilgili live test de gerçek
profil ve gerçek video ile çalıştırılmalıdır. Secret içeren dosyaları staging'e
eklemeyin ve `main` dalına force push yapmayın.
