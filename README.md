# ZYouTube - AI Destekli Akıllı YouTube Özet Eklentisi (Manifest V3)

ZYouTube, React, Vite, TypeScript ve TailwindCSS kullanılarak geliştirilmiş, doğrudan YouTube video sayfası içerisine enjekte edilen gelişmiş bir yapay zeka destekli video özetleme ve transkript eklentisidir.

## 🚀 Proje Vizyonu ve Amacı

Modern dünyada bilgi tüketimi inanılmaz bir hıza ulaştı. YouTube üzerinde her gün milyonlarca saatlik eğitim, podcast ve teknoloji videoları yayınlanıyor. ZYouTube, uzun videoları izlemek için zamanı olmayan, sadece kritik bilgilere erişmek isteyen veya video içinde geçen spesifik bir bilgi parçasını (örneğin 1 saatlik bir yayındaki 2 dakikalık bir kod parçasını) arayan kullanıcılar için geliştirilmiştir.

ZYouTube, **Chrome Extension Manifest V3** altyapısını kullanarak, YouTube'un karmaşık ve sürekli değişen DOM yapısına entegre olur. Videonun altyazılarını (transcript) saniyeler içinde çeker, bu veriyi parçalara böler ve Gemini API'sine göndererek kullanıcının anlayabileceği akıcı bir özet çıkartır.

---

## 🛠️ Temel Özellikler

1. **Doğrudan Arayüz Entegrasyonu:** Chrome Side Panel yerine doğrudan YouTube oynatıcısının yanındaki ikincil sütuna (`#secondary`) "AI Özet" paneli enjekte edilir. Bu sayede videoyu izlerken özet ve transkript sekmelerine kesintisiz erişebilirsiniz.
2. **Akıllı Parçalama (Chunking):** Çok uzun videoların transkriptleri, yapay zekanın token sınırlarını aşmamak için akıllıca birleştirilir veya filtrelenir.
3. **Güvenli AI Sağlayıcıları:**
   - **Gemini Gem Web Otomasyonu:** Gemini API kullanmak yerine, tarayıcınızda açık olan Google/Gemini oturumunu kullanır ve belirlediğiniz Gemini Gem URL'si üzerinden web otomasyonu ile özet çıkarır.
   - **OpenAI Uyumlu API:** Kendi API anahtarınızı (DeepSeek, LMStudio vb.) kullanarak özet alabilirsiniz.
   - **Chrome Yerel AI:** Destekleyen tarayıcılarda `window.ai` üzerinden tamamen yerel özetleme yapar.
4. **Gelişmiş Transkript Yakalama:** İzole edilmiş Content Script sınırlarını aşarak YouTube oynatıcısının verisine `executeScript({ world: 'MAIN' })` üzerinden doğrudan erişir. Otomatik oluşturulmuş ve elle eklenmiş altyazıları kusursuz ayrıştırır.
5. **Karanlık / Aydınlık Mod Desteği:** YouTube'un mevcut temasıyla senkronize çalışır, göz yormaz.
6. **Güvenli Ayarlar Yönetimi:** Kullanıcının API anahtarı `chrome.storage.local` üzerinde güvenle şifrelenerek tutulur. İstekler Background Service Worker üzerinden atılır. API key gibi hassas bilgiler DOM'a sızdırılmaz.

---

## 🏗️ Mimari ve Teknolojik Altyapı

Proje, modern web teknolojilerinin gücünden faydalanarak modüler ve sürdürülebilir bir yapıda tasarlanmıştır:

- **React 18 & TypeScript:** Eklentinin UI (Kullanıcı Arayüzü) katmanı tamamen React ile yazılmıştır. TypeScript sayesinde tip güvenliği sağlanarak çalışma zamanı hataları en aza indirilmiştir.
- **Vite & CRXJS:** Derleme aracı olarak Vite, Chrome eklentisi entegrasyonu için CRXJS (Vite Plugin) kullanılmıştır. Hızlı derleme (HMR) ve Manifest V3 uyumluluğu sorunsuz sağlanmıştır.
- **Shadow DOM:** Eklentinin stillerinin (CSS) YouTube'un varsayılan stilleriyle çakışmaması (CSS Bleeding) için Shadow DOM teknolojisi kullanılmıştır.

### Modül Hiyerarşisi

*   **`src/content/index.tsx`**: YouTube DOM'una enjekte edilen ana betiktir. `MutationObserver` kullanarak sayfa değişikliklerini dinler, "AI Özet" butonunu YouTube'un araç çubuğuna ekler ve tıklanıldığında React panelini `#secondary` (sağ panel) konteynerine monte eder.
*   **`src/transcript/youtube-provider.ts`**: YouTube'un gizli `ytInitialPlayerResponse` objesini çözümleyerek videonun içindeki altyazı dosyalarının (caption tracks) URL'lerini çıkarır. İçerik betiği üzerinden doğrudan `fetch` atarak altyazı verisini alır.
*   **`src/transcript/parser.ts`**: İndirilen ham transkript verisini (JSON3 veya XML formatında olabilir) parse ederek saniye saniye segmentlere böler.
*   **`src/ai/`**: Yapay Zeka sağlayıcıları, JSON Response Parser, Prompt Builder ve Görev Yöneticisi (Task Manager).
*   **`src/settings/`**: Konfigürasyon ve doğrulama işlemleri (Validation rules, Session vs. Local Storage kararları).
*   **`src/background/index.ts`**: Service Worker arka plan betiğidir. Global sekme değişimlerini ve güvenli mesajlaşmaları yönetir.

---

## 🔄 Son Gelişmeler ve Teknik Çözümler

Eklentinin geliştirilmesi sürecinde, özellikle YouTube'un dinamik (SPA - Single Page Application) yapısından kaynaklı çeşitli zorluklar yaşanmış ve aşılmıştır:

### 1. Dinamik Import ve Manifest V3 Sorunları
Başlangıçta `content_script` içinde `await import('./parser')` gibi dinamik import modülleri kullanılıyordu. Vite bu kodları derlerken ayrı dosyalara (chunk) bölüyor ve Chrome Manifest V3 güvenlik politikaları gereği (`web_accessible_resources`) bu dosyaların dışarıdan yüklenmesini engelliyordu.
**Çözüm:** Dinamik import'lar statik import'lara çevrilerek kodun tek bir bundle içinde derlenmesi sağlandı.

### 2. Altyazı (Transcript) Fetch Problemi (Boş Dönen Yanıtlar)
Altyazı verisini çekmek için istek `background` servisine yönlendiriliyordu. Ancak YouTube'un yaş kısıtlamalı, premium veya telif haklı bazı videolarında, çerezler (cookies) arka plan servisinden iletilemediği için sunucu HTTP 200 dönmesine rağmen gövdeyi boş (length: 0) yolluyordu. Bu da XML parse hatalarına neden oluyordu.
**Çözüm:** Fetch işlemi `youtube-provider.ts` içerisine alınarak doğrudan içerik betiği (`content script`) üzerinden, yani doğrudan `youtube.com` context'inden yapıldı. Bu sayede kullanıcının mevcut YouTube çerezleri istekle beraber gönderilmiş oldu.

### 3. YouTube UI ve Buton Kaybolma (Overflow) Sorunu
YouTube, video altı butonlarını `#top-level-buttons-computed` adlı alanda tutar. "AI Özet" butonu bu listeye en son eleman olarak (`appendChild`) ekleniyordu. Ancak "NotebookLM", "Paylaş", "Soru" gibi çok fazla butona sahip kullanıcılarda veya dar ekranlarda, YouTube'un kendi Responsive tasarımı, taşan (overflow) butonları otomatik olarak kestiği veya gizlediği için buton görünmez oluyordu.
Ayrıca YouTube, ikon boyutlarında sabitlik (24x24px) aradığı için, SVG ikonuna dışarıdan esnek boyut verildiğinde devasa siyah bir kare oluşuyordu.
**Çözüm:** 
- Buton listenin sonuna değil, her zaman görünür kalması için en başına (`insertBefore`) eklendi. (Gerekirse bu durum diğer elementleri analiz ederek güncellenebilir).
- Buton ikonuna SVG içinden sabit `24px` değerleri verilerek YouTube UI standartlarına (yt-spec-button-shape-next) tam uyum sağlandı.

### 4. Başka Eklentilerle Çakışma ve Yanıltıcı Loglar
Kullanıcı testleri sırasında konsolda `[Auto Youtube Shorts Scroller] Object` ve `content.ts.44ce3ab9.js` şeklinde hatalar gözlemlendi. Bu durum ZYouTube'un hata verdiği yanılgısını yarattı.
**Analiz:** Bu hataların tamamen kullanıcının tarayıcısındaki başka bir eklentiden kaynaklandığı ve ZYouTube projesinde hiçbir zaman `content.ts` isimli bir dosyanın veya Shorts modülünün bulunmadığı tespit edildi.

---

## 🛠️ Kurulum ve Geliştirme

Projeyi yerel bilgisayarınızda çalıştırmak için aşağıdaki adımları izleyin:

### Gereksinimler
- Node.js (v18+)
- npm veya yarn

### Adımlar
1. Projeyi klonlayın:
   ```bash
   git clone https://github.com/murathany90/zyoutube.git
   cd zyoutube
   ```

2. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

3. Derleme işlemini başlatın:
   ```bash
   npm run build
   ```
   *(Sürekli geliştirme yapacaksanız `npm run dev` komutunu kullanarak Vite'ın HMR (Hot Module Replacement) özelliğinden faydalanabilirsiniz).*

4. Chrome'da Geliştirici Modunu Açın:
   - Chrome'da `chrome://extensions/` adresine gidin.
   - Sağ üstteki **"Geliştirici modu" (Developer mode)** anahtarını açın.
   - **"Paketlenmemiş öğe yükle" (Load unpacked)** butonuna tıklayın.
   - Proje klasöründeki `dist` dizinini seçin.

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

---

## 📅 Gelecek Planları (Roadmap)

- [ ] **Kelime Bazlı Timestamp (Vurgulama):** Özette geçen kelimelere tıklayarak videoda o saniyeye gitme özelliği.
- [ ] **Semantic Soru-Cevap (RAG):** Videoda geçen konularla ilgili spesifik soruları doğrudan "Sor" sekmesinden yapay zekaya sorabilme.
- [ ] **Çoklu Dil Desteği:** Yabancı dildeki videoları otomatik çevirerek Türkçe (veya istenilen dilde) özet çıkarma.
- [ ] **Kısayol Tuşları:** Gelişmiş kullanıcılar için klavye kısayollarıyla paneli açıp kapatma.

---

## 🤝 Katkıda Bulunma (Contributing)

Bu proje açık kaynaklıdır ve her türlü katkıya (Pull Request) açıktır. Eğer bir hata (bug) bulduysanız veya yeni bir özellik eklemek istiyorsanız lütfen bir **Issue** açarak tartışmaya katılın.

Özellikle YouTube'un DOM yapısı sık sık değiştiğinden, buton enjeksiyonu veya panel sabitleme gibi konularda oluşabilecek UI kırılmalarına karşı PR'lar memnuniyetle karşılanacaktır.

---

## 📝 Lisans

Bu proje kişisel kullanım/geliştirme amaçlıdır.
