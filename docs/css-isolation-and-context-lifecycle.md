# CSS Izolasyonu ve Context Lifecycle Raporu

## 1. CSS Çakışmaları ve Nedenleri
Önceki versiyonda, eklenti `src/index.css` dosyası içerisinde global Tailwind CSS `@tailwind base;` (Preflight) tanımlarına sahipti. Content betiği doğrudan bu dosyayı içeri aktardığı için, YouTube DOM yapısındaki tüm öğeler (svg, button, h1) Tailwind tarafından global olarak sıfırlanıyor, bu nedenle YouTube'un kendi UI bileşenleri görünmez veya kullanılamaz hale geliyordu.

**Çözüm:**
CSS üç parçaya bölündü ve tamamen izole edildi:
1. `src/styles/popup.css`: Sadece Popup HTML içerisinden çağrılır. İçerisinde Tailwind Base kurallarını tam barındırır.
2. `src/styles/content-panel.css`: Shadow DOM içindir. Preflight barındırmaz, kendi sınıfları ile Shadow DOM içerisini şekillendirir. Vite kullanılarak `?inline` olarak string halinde dahil edilir ve yalnızca Shadow Root içine eklenir.

## 2. Extension Context Invalidated (Bağlam İptali)
Geliştirme esnasında eklenti arka plan servisi güncellenirse, açık olan tarayıcı sekmelerindeki content betiklerinin arka plan scriptleriyle iletişimi aniden kopar ve tüm API çağrıları "Extension context invalidated" hatası fırlatır.
Eski yapı bu hatayı "Transkript Bulunamadı" şeklinde maskeliyor ve aralıklarla arka plandan defalarca talep etmeye devam ediyordu.

**Çözüm:**
- `PING_BACKGROUND`: Content betiği başlatıldığında öncelikle background servisine bir ping mesajı atar.
- Hata Yönetimi: Eğer API veya mesaj gönderimi `invalidated` veya bağlantı koptu şeklinde hata döndürürse, tüm timeout, interval, MutationObserver işlemleri anında temizlenir (destroy edilir). 
- UI Gösterimi: YouTube sayfasındaki panel içerisinde kullanıcıya "Eklenti Güncellendi. Devam etmek için sayfayı yenileyin." ekranı sunulur. Eski kalıntı log spam işlemleri durdurulur.

## 3. Mutation Observer Spamının Durdurulması
Önceki yapı tüm sayfa mutasyonlarını dinleyip `injectButton`'u tetikliyordu. 
**Çözüm:**
Observer yalnızca `ytd-watch-flexy`, `#secondary` ve `top-level-buttons-computed` üzerindeki değişiklikleri dinleyecek şekilde kısıtlandı. Çağrılar arasına 250ms'lik bir Debounce (gecikme/bekletme) eklendi, böylece yüzlerce defa çağrılmasının önüne geçildi.

## 4. Eski Sürüm Betik Temizliği
Eklenti güncellendiğinde ve sayfa yenilenmediğinde yeni içerik betiği ile eski içerik betiği çakışabilirdi.
`data-zyoutube-owner="extension"` ve `data-zyoutube-build="[build-id]"` verileriyle artık yeni betik başlatıldığında eski betiğe ait bırakılan her türlü dom objesini çöpe atar ve kendini baştan yapılandırır.
