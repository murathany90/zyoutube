# Devir Teslim: ZYouTube P0 Hataları

Lütfen aşağıda açıklanan güncel duruma ve geçmiş test sonuçlarına göre kalan P0 hatalarını analiz et ve çözüm üret.

## 1. Geçmiş ve Mevcut Durum

Kullanıcı "AI Özet" butonu ve Altyazı çekme süreçlerinde çeşitli hatalar yaşadı. Biz bu hataları şu şekilde izole etmeye çalıştık:
* **Background Fetching İptali:** Başlangıçta YouTube altyazıları `background/index.ts` üzerinden çekiliyordu (CORS'u aşmak için). Ancak bu senaryoda yaş veya Premium kısıtlamalı videolarda, Background Worker (Service Worker) kullanıcının YouTube çerezlerini taşımadığı için YouTube sunucusu 200 OK dönse de **boş bir içerik (length: 0)** yolluyordu. Bu boş metni XML olarak parse etmeye çalıştığımızda ise `XML parsing failed` alıyorduk. Bunu çözmek için fetch işlemini `youtube-provider.ts` içerisine yani **Content Script (İçerik Betiği)** katmanına taşıdık ki kullanıcının mevcut YouTube çerezleri istekle beraber gitsin. (Kullanıcının loglarına göre henüz bu değişikliğin meyvesini yiyemedi veya eski buildi kullanıyor).
* **Buton (Icon) UI Sorunları:** YouTube'un `#top-level-buttons-computed` container'ına (veya yeni adıyla ytd-menu-renderer #actions vb.) kendi butonumuzu ekliyoruz. Daha önce `appendChild` kullanarak sona eklediğimizde, YouTube'un "NotebookLM, Soru, Paylaş" gibi sayısız ekstra butonu bulunan responsive (sığdırmalı) yapısı bizim butonumuzu `overflow: hidden` kuralıyla (veya 3 noktaya) atıp gizliyordu. Bunu çözmek için `insertBefore` ile ilk sıraya eklemeyi denedik.
* **Devasa Siyah Kare:** SVG ikonumuz içinde `<svg width="100%" height="100%">` olduğu için YouTube'un kutusunu patlatıp UI'ı bozuyordu, bunu `width: 24px; height: 24px` şeklinde sabitledik. Ancak kullanıcı son testte "icon yok kayboldu" dedi. `insertBefore(btn, actionsRow.firstChild)` kullanımı veya ikon CSS'i şu an butonu görünmez yapmış olabilir.

## 2. Diğer Eklentiler (Kırmızı Bayrak)
Kullanıcının loglarında `[Auto Youtube Shorts Scroller]` ve `content.ts.44ce3ab9.js Failed to fetch` hataları var. Bunlar ZYouTube'a ait **değil**. Başka bir Vite tabanlı eklenti hata fırlatıp konsolu kirletiyor.

## 3. Görevlerin (Odaklanılacak Konular)

**Görev 1: Buton Enjeksiyonunu Sağlama (UI)**
`src/content/index.tsx` içindeki `injectButton()` fonksiyonunu incele.
Kullanıcıda "NotebookLM", "Paylaş", "Soru", "Kaydet" gibi hap (pill) şeklinde butonlar mevcut. Bizim "AI Özet" butonumuz ya yanlış selector (`#top-level-buttons-computed` vs `#actions-inner`) sebebiyle hiç DOM'a eklenmiyor ya da eklense bile SVG yapısı veya CSS sınıfları yüzünden Chrome tarafından render edilemiyor. Orijinal YouTube DOM'unu gözlemleyerek en sağlıklı `querySelector` ve `appendChild/insertBefore` mantığını kur. Gerekirse YouTube'un kullandığı `yt-button-view-model` etiketlerini veya özel classları simüle et.

**Görev 2: Transkript Çekme (Fetch) Başarısını Kesinleştirme**
`src/transcript/youtube-provider.ts` içerisindeki `fetchTranscript` metodunu ele al. Fetch işlemi Content Script üzerinden yapıldığında CORS hatası vermemeli (çünkü URL'ler `youtube.com` veya `googlevideo.com` oluyor ve YouTube Content Script'e CORS izni veriyor). Kullanıcının testlerinde `rawText length: 0` alıyorduk. Yeni yazdığımız `await fetch(fetchUrl)` bloğunun kusursuz çalıştığından emin ol ve eğer YouTube `fetchUrl` yapısını değiştirdiyse veya farklı bir auth parametresi istiyorsa (örneğin `&signature=` gibi), `ytInitialPlayerResponse` içindeki `captionTracks` baseUrl'ini doğru çözdüğümüzü doğrula.

**Görev 3: İzole Panel (Shadow DOM / Iframe Alternatifi)**
Eğer YouTube DOM'u butonumuzu sürekli eziyor veya siliyorsa, panele erişim için `MutationObserver` mekanizmasını daha sağlam hale getir veya butonu video oynatıcısının içine (örneğin alt barda Ses kontrolünün yanına) enjekte etmeyi düşün (böylece daralma ve overflow problemlerinden kurtulunur).

Lütfen kolları sıva, `src/content/index.tsx` ve `src/transcript/youtube-provider.ts` dosyalarını derinlemesine analiz ederek bu stabilite problemini kesin olarak çöz. Başarılar!
