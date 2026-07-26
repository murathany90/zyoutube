# ZYouTube - AI Destekli Akıllı YouTube Özet ve Transkript Eklentisi (Manifest V3)

ZYouTube, React, Vite, TypeScript ve TailwindCSS kullanılarak geliştirilmiş, doğrudan YouTube video sayfası içerisine enjekte edilen gelişmiş bir yapay zeka destekli video özetleme ve interaktif transkript eklentisidir. Uzun eğitim videoları, podcast'ler veya teknoloji incelemeleri gibi içeriklerde zaman kazanmak ve aranan bilgiye anında ulaşmak için tasarlanmıştır.

## 🚀 Proje Vizyonu ve Amacı

Modern dünyada bilgi tüketimi inanılmaz bir hıza ulaştı. YouTube üzerinde her gün milyonlarca saatlik eğitim, podcast ve teknoloji videoları yayınlanıyor. ZYouTube, uzun videoları izlemek için zamanı olmayan, sadece kritik bilgilere erişmek isteyen veya video içinde geçen spesifik bir bilgi parçasını (örneğin 1 saatlik bir yayındaki 2 dakikalık bir kod parçasını) arayan kullanıcılar için geliştirilmiştir.

ZYouTube, **Chrome Extension Manifest V3** altyapısını kullanarak, YouTube'un karmaşık ve sürekli değişen DOM yapısına entegre olur. Videonun altyazılarını (transcript) saniyeler içinde çeker, bu veriyi parçalara böler ve seçili yapay zeka API'sine göndererek kullanıcının anlayabileceği akıcı bir özet çıkartır. Ayrıca videoyla senkronize akan, kullanıcı dostu bir transkript okuyucu sunar.

---

## 🛠️ Temel Özellikler

### 1. Dinamik ve Native Arayüz Entegrasyonu
ZYouTube, ayrı bir sayfa veya hantal bir yan panel açmak yerine doğrudan YouTube oynatıcısının altındaki araç çubuğuna ("Beğen", "Paylaş" gibi) şık bir **"AI Özet"** butonu ekler. Tıklandığında, sayfanın sağ tarafındaki ikincil sütuna (`#secondary`) entegre bir panel açılır. Bu panel videonun orijinal akışını bozmaz, YouTube'un Karanlık / Aydınlık temalarına kusursuz uyum sağlar.

### 2. Gelişmiş Transkript (Altyazı) Yakalama Motoru
YouTube'un altyazı sistemleri zaman zaman bot korumaları (Botguard / PoToken) veya yaş kısıtlamaları ile korunmaktadır. Ayrıca çapraz dil çevirileri özel şifreleme istekleri gerektirir. ZYouTube, tüm bu zorlukları sıfır hatayla aşmak için katmanlı (fallback) bir mimari kullanır:
- **Faz 1 (Native Response Body Capture V2):** Eğer altyazı Botguard (PoToken) ile korunuyorsa veya kullanıcı **başka bir dile çeviri** istemişse, eklenti ekstra bir ağ isteği (fetch) yapmak yerine doğrudan YouTube oynatıcısının arka planda yaptığı ağı dinler (MAIN World Hook). Orijinal yanıt döner dönmez veriyi kopyalar ve alır. Bu sayede YouTube'un "Çok Fazla İstek (HTTP 429)" veya "Rate Limit" kısıtlamalarına asla takılmaz; çevrilmiş altyazılar ilk denemede sorunsuz elde edilir.
- **Faz 2 (Content Script API Fetch):** Eğer video korunmasız (şifresiz) ise ve orijinal dildeki altyazı isteniyorsa, eklenti hızlıca doğrudan API üzerinden standart bir `fetch` atarak veriyi milisaniyeler içinde çeker.
- **Faz 3 (Yerel DOM Okuma - Scraper Fallback):** Tüm ağ (API) denemeleri başarısız olursa (örneğin YouTube API yapısını aniden değiştirirse), eklenti pes etmez. YouTube'un kendi native altyazı panelini (sayfa üzerindeki DOM) bulur, arka planda programatik olarak tıklar, içerisindeki metinleri okur (scrape) ve paneli gizlice geri kapatır. Bu sayede hiçbir ağ engeline takılmadan güncel altyazıyı ekrandan çekmiş olur. Eğer çeviri istendiği halde Scraper'a düşülmüşse (ve ekranda çeviri yoksa), kullanıcıya şeffaf bir uyarı (TRANSLATION_UNAVAILABLE) sunulur.

### 3. İnteraktif Transkript Arayüzü (Auto-Sync)
Eklenti, videonun süresiyle eş zamanlı olarak akan (Auto-Sync) bir transkript sekmesi sunar:
- **Zaman Damgaları (Timestamps):** Her cümlenin yanındaki zaman damgasına tıklayarak videoyu o saniyeye sardırabilirsiniz.
- **Otomatik Kaydırma:** Video oynatıldıkça, okunan cümle vurgulanır (highlight) ve panel otomatik olarak aşağı kayar.
- **Okunabilirlik Modları:** Açık veya koyu arkaplanlarda okunabilirliği artırmak için punto büyütme/küçültme ve zaman damgalarını gizleme opsiyonları bulunur.
- **Gelişmiş Arama:** Transkriptin içinde saniyeler içinde metin araması yapılabilir ve bulunan kelime videoda anında bulunabilir.

### 4. Akıllı Özetleme ve Yapay Zeka Modelleri

ZYouTube, esnek bir yapay zeka entegrasyonu sunar. Kullanıcıların ihtiyaçlarına göre tamamen ücretsiz web otomasyonu veya profesyonel API kullanımı gibi seçenekler barındırır. Bu özellikler, eklenti arayüzündeki ⚙️ (Ayarlar) sekmesinden kolayca yapılandırılabilir.

#### a) Gemini Web Otomasyonu (Ücretsiz ve Pratik)
- **Nasıl Çalışır?:** Google'ın Gemini web arayüzünü (gemini.google.com) adeta bir API gibi kullanır. Siz "Özetle" tuşuna bastığınızda, arka planda gizli ve izole bir sekme açılır, çıkarılan transkript bu sekmeye bir prompt (komut) ile gönderilir.
- **Hızlı ve Akıllı Takip Sistemi:** Bekleme süreleri minimize edilmiştir. Eklenti veriyi Gemini'ye gönderdikten sonra sadece 4 saniye uyur, ardından her 3 saniyede bir yanıtın tamamlanıp tamamlanmadığını kontrol eder. Yanıt bittiği an, saliseler içinde veriyi alarak arka plandaki Gemini sekmesini **otomatik olarak kapatır** ve özeti ekrana yansıtır.
- **Tıklanabilir Zaman Damgaları:** Çıkarılan özet metni içerisindeki zaman damgaları (Örn: `[15:19]`) otomatik olarak tıklanabilir mavi bağlantılara dönüştürülür. Bunlara tıklandığında video tam o saniyeye atlar. (Bu özellik "Geçmiş" sayfasında da desteklenmektedir.)
- **Avantajları:** Resmi API kotası veya kredi kartı/ücretlendirme derdi yoktur. Tarayıcınızdaki aktif Google hesabınızı kullanır.
- **Parametreler (Ayarlar):**
  - **Kayıtlı Gemini Adresi (Zorunlu):** Tarayıcınızda halihazırda oturum açtığınız, kullanıma hazır bir Gemini sohbetinin linkini (Örn: `https://gemini.google.com/app/1234abcd`) buraya yapıştırmanız gerekir. Eklenti sürekli yeni URL'ler yaratmak yerine sizin tanımladığınız bu sabit odayı kullanır. Bu sayede Google'ın spam ve bot korumalarına (Captcha) takılmadan, doğal bir kullanıcıymış gibi güvenli şekilde özet çıkarır.

#### b) OpenAI Uyumlu API Desteği (DeepSeek, LMStudio, Ollama vb.)
- **Nasıl Çalışır?:** Bilgisayarında açık kaynaklı yerel (Local) modeller çalıştıranlar veya DeepSeek gibi maliyet-etkin dış API sağlayıcılarını tercih eden ileri düzey kullanıcılar içindir. Standart OpenAI REST API mimarisine uyan tüm uç noktaları (endpoint) destekler.
- **Parametreler (Ayarlar):**
  - **Base URL:** İstek atılacak API'nin kök adresi. Dış API'ler için örneğin `https://api.deepseek.com/v1`, yerel (LMStudio/Ollama) kullanımlar için `http://localhost:1234/v1` formatındadır.
  - **Model ID:** Kullanılacak modelin kayıtlı tam adı (Örn: `deepseek-chat`, `mistral-7b`).
  - **API Key:** Dış sağlayıcılar için gereken kimlik doğrulama anahtarı. *(Güvenlik: Bu anahtar kesinlikle dışarı sızmaz, sadece tarayıcınızın güvenli yerel hafızasında `chrome.storage.local` tutulur.)*

#### c) Akıllı Parçalama (Chunking) Teknolojisi
- Saatlerce süren videoların transkriptleri yapay zekanın "Bağlam Sınırı" (Context Limit) kapasitesini aşabilir. 
- ZYouTube, bu gibi durumlarda metni tek parça göndermek yerine, kelime sayısını analiz ederek anlam bütünlüğünü bozmayacak mantıksal bloklara (chunk) böler ve işler. Yapay zeka yorulmadan en doğru özeti sunar.

---

## 🏗️ Mimari ve Teknolojik Altyapı

Proje, modern web teknolojilerinin gücünden faydalanarak modüler ve sürdürülebilir bir yapıda tasarlanmıştır:

- **React 18 & TypeScript:** UI katmanı tamamen React ile yazılmıştır. TypeScript sayesinde tip güvenliği sağlanarak çalışma zamanı hataları en aza indirilmiştir.
- **Vite & CRXJS:** Derleme aracı olarak Vite, Chrome eklentisi entegrasyonu için CRXJS kullanılmıştır. Hızlı derleme (HMR) ve tam Manifest V3 uyumluluğu sağlanmıştır.
- **Shadow DOM:** Eklentinin stillerinin (CSS / Tailwind) YouTube'un varsayılan stilleriyle çakışmaması (CSS Bleeding) için React bileşenleri tamamen Shadow DOM içine render edilir.
- **Zustand:** Komponentler arası state yönetimi hafif ve hızlı olan Zustand ile sağlanmaktadır.

### Modül Hiyerarşisi (Klasör Yapısı)

*   **`src/content/`**: YouTube sayfasına enjekte edilen içerik betikleridir.
    *   `index.tsx`: `MutationObserver` ile sayfa değişimlerini izler, YouTube araç çubuğuna "AI Özet" butonunu ekler ve `#secondary` içine React panelini gömer.
    *   `TranscriptTab.tsx`: İnteraktif transkript okuyucunun arayüzü ve video senkronizasyon (auto-scroll) mantığı.
*   **`src/transcript/`**: Transkript verilerini indiren, temizleyen ve parse eden çekirdek modüldür.
    *   `youtube-provider.ts`: Katmanlı fetch (API, DOM Scrape, Background) işlemlerini yürütür.
    *   `parser.ts`: Farklı YouTube formatlarını (JSON3, XML) saniye saniye ayrıştırıp ortak bir modele çevirir.
*   **`src/ai/`**: Yapay Zeka orkestratörü. Web Otomasyonu ve API isteklerini aynı arayüz üzerinden yönetir.
*   **`src/settings/`**: Kullanıcı tercihleri, seçili yapay zeka modelleri ve güvenlik validasyonlarını içerir.
*   **`src/background/message-router.ts`**: Manifest V3'ün kısıtlamalarını aşmak için arka plan Service Worker'ında çalışan mesaj yönlendiricisi. `MAIN` world (ana sayfa bağlamı) ile izole edilmiş `ISOLATED` world arasında köprü kurar.

---

## 🔄 Teknik Çözümler ve Aşılan Zorluklar

Eklentinin geliştirilmesi sürecinde, YouTube'un SPA (Single Page Application) yapısından kaynaklı çeşitli zorluklar yaşanmış ve sofistike çözümler üretilmiştir:

### 1. Botguard (PoToken) Koruması ve HTTP 429 Aşımı (Native Body Capture V2)
YouTube yakın zamanda `exp=xpe` parametresi ile API isteklerine Botguard (PoToken) koruması getirdi. Ayrıca, eklentilerin yakaladığı URL'leri kendi başlarına ikinci kez (`fetch`) çağırması, YouTube sunucuları tarafından "kopya istek" olarak algılanıp **HTTP 429 (Too Many Requests)** hatası ile reddediliyordu.
**Çözüm (Native Response Body Capture V2):** ZYouTube, videonun orijinal ağ isteklerini bozmamak ve 429 hatasına takılmamak için **sayfa yüklenmeden hemen önce (document_start)** çalışan bir `MAIN World` kancası (hook) kullanır. `window.fetch` ve `XMLHttpRequest` fonksiyonları araya girilerek (intercept) dinlenir. Orijinal YouTube oynatıcısı altyazı (`/api/timedtext`) isteğini yaptığında, eklenti bu ağ yanıtının gövdesini (body) klonlayıp gizlice alır (`response.clone().text()`). 
Bu sayede eklenti kendi başına ekstra hiçbir ağ isteği yapmaz, PoToken veya Rate Limit engellerine takılmaz ve **İngilizce çeviri** dâhil tüm şifreli altyazıları ilk istekte kusursuz bir biçimde ekrana yansıtır.

### 2. URL Parametrelerinin (Signature) Korunması
YouTube'un altyazı URL'leri özel imzalar (`signature`, `ei`) barındırır. Bu URL'leri JavaScript'in `new URL()` objesiyle değiştirmek veya yeniden formatlamak imzaların bozulmasına neden oluyordu.
**Çözüm:** Yeni mimaride eklenti, URL manipülasyonu yapıp yeni istek göndermek yerine, doğrudan YouTube'un kendi çağırdığı URL'leri klonlayarak okur. Eklenti içi mesajlaşmada (ISOLATED ile MAIN world arası) oluşabilecek token sızıntılarını önlemek için, loglama ve hata ayıklama aşamasında hassas URL parametreleri (pot, signature) özel olarak maskelenir.

### 3. YouTube UI'a Sorunsuz Buton Ekleme
YouTube butonu son eleman (`appendChild`) olarak eklendiğinde, dar ekranlarda (veya çok butonlu videolarda) taşma (overflow) yaşanıyor ve buton görünmez oluyordu.
**Çözüm:** Buton her zaman araç çubuğunun en başına (`insertBefore`) eklendi. Ayrıca ikon SVG'leri `24x24px` şeklinde sabitlenerek YouTube'un Material Design yönergelerine (yt-spec-button-shape-next) tam entegre edildi.

### 4. YouTube SPA (Single Page Application) Navigasyon Uyumu
Kullanıcılar YouTube üzerinde sayfayı yenilemeden bir videodan diğerine geçtiğinde, geleneksel sayfa yükleme etkinlikleri (onload vb.) tetiklenmediği için eklentiler genellikle eski videoda takılı kalır.
**Çözüm:** ZYouTube, arka planda (URL dinlemeye ek olarak) doğrudan YouTube'un kendi iç olaylarından olan `yt-navigate-finish` event'ini dinler. Bu sayede kullanıcı sayfayı hiç yenilemeden 10 farklı video da değiştirse, eklenti anında fark edip transkript motorunu o video için sıfırdan ve hatasız şekilde tekrar çalıştırır.

---

## 🛠️ Kurulum ve Geliştirme (Lokal Ortam)

Projeyi bilgisayarınızda çalıştırmak ve koda katkı sağlamak için aşağıdaki adımları izleyin:

### Gereksinimler
- Node.js (v18+ önerilir)
- npm veya pnpm

### Kurulum Adımları
1. Projeyi bilgisayarınıza klonlayın:
   ```bash
   git clone https://github.com/murathany90/zyoutube.git
   cd zyoutube
   ```

2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

3. Geliştirme modunu başlatın (HMR destekli anında derleme):
   ```bash
   npm run dev
   ```
   *(Eğer canlı kullanım için tekil bir build almak isterseniz `npm run build` komutunu çalıştırabilirsiniz.)*

4. Chrome'a Eklentiyi Yükleyin:
   - Tarayıcınızda `chrome://extensions/` adresini açın.
   - Sağ üstteki **"Geliştirici Modu" (Developer mode)** seçeneğini aktifleştirin.
   - Sol üstten **"Paketlenmemiş öğe yükle" (Load unpacked)** butonuna tıklayın.
   - Projenizin ana dizinindeki `dist` klasörünü seçin.
   - Eklenti kurulduğunda YouTube'u açıp bir videoya girin, sağ altta "AI Özet" panelini göreceksiniz.

---

## 🧪 Test Süreçleri

Projenin stabilitesini korumak için Playwright ve Vitest altyapısı mevcuttur:

1. **Birim Testler (Unit)**: Parser, Cleaner gibi algoritmaları izole olarak test eder.
2. **E2E Testleri (Playwright)**: Chromium tarayıcısını ayağa kaldırarak eklentinin DOM'a doğru yerleşip yerleşmediğini, altyazıların (manuel ve otomatik) çekilip çekilemediğini uçtan uca simüle eder.

Tüm testleri çalıştırmak için:
```bash
npm run test
```

---

## 📅 Gelecek Planları (Roadmap)

Eklenti gelişimine açık ve modüler bir mimariyle kodlanmıştır. Gelecek planları şunlardır:
- [ ] **Semantic Soru-Cevap (RAG):** Videoda geçen konularla ilgili spesifik soruları doğrudan "Sor" sekmesinden yapay zekaya sorabilme (Video içi interaktif asistan).
- [ ] **Özelleştirilebilir Promptlar:** Kullanıcıların "Sadece kodları özetle", "Tarife odaklan" gibi ön tanımlı şablonlar oluşturabilmesi.
- [ ] **Klavye Kısayolları:** İleri düzey kullanıcılar için paneli açma, transkriptte arama yapma ve okuma hızını kısayollarla kontrol etme.
- [ ] **Gelişmiş Dışa Aktarma:** Transkripti ve özeti Notion, Obsidian gibi uygulamalara tek tıkla aktarma (Markdown Export).

---

## 🤝 Katkıda Bulunma (Contributing)

Bu proje tamamen açık kaynaklıdır ve her türlü katkıya (Pull Request) açıktır. Eğer bir hata (bug) bulduysanız veya yeni bir özellik eklemek istiyorsanız lütfen GitHub üzerinden bir **Issue** açarak detayları paylaşın.

Özellikle YouTube'un DOM yapısı sık sık güncellendiğinden, buton enjeksiyonu veya panel sabitleme gibi UI ile ilgili kırılmalara karşı düzeltme (fix) gönderen PR'lar büyük bir memnuniyetle incelenip birleştirilecektir. 

Lütfen yeni bir özellik eklediğinizde, `tests/` klasörü altına o özelliğin çalışmasını garanti eden bir birim testi eklemeyi unutmayın.

---

## 📝 Lisans

Bu proje eğitim ve kişisel kullanım/geliştirme amaçlıdır. Açık kaynak standartlarına (MIT) uygun olarak paylaşılmıştır. Dilediğiniz gibi fork'layabilir ve kendi projelerinizde kullanabilirsiniz.
