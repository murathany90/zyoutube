# YouTube Transkript ve Özet Chrome Eklentisi

## Kavramsal Ürün ve Sistem Tasarımı

**Tarih:** 25 Temmuz 2026
**Kapsam:** Kod yazımı hariç ürün yapısı, ekranlar, iş akışları, transkript erişimi, Gemini Gem otomasyonu, haricî API kullanımı ve Chrome yerleşik AI araştırması.

---

# 1. Ürün vizyonu

Eklenti, YouTube videolarındaki mevcut altyazıyı zaman damgalarıyla birlikte çıkaracak; seçilen yapay zekâ yöntemiyle özetleyecek ve sonuçları hem YouTube sayfası üzerinde hem de Chrome yan panelinde gösterecektir.

Eklentinin üç temel kullanım amacı olacaktır:

1. Uzun videoları izlemeden önce içeriği anlamak
2. Video transkriptini ve özetini daha sonra kullanmak üzere saklamak
3. İngilizce videoları kelime, cümle, flashcard ve test çalışmasına dönüştürmek

İlk aşamada ürün tamamen yerel ve tek kullanıcılı olabilir. Kullanıcı hesabı, ödeme sistemi, uzaktaki bir veritabanı veya merkezi sunucu gerekmeyecektir.

---

# 2. Önerilen temel yaklaşım

Eklenti iki ayrı kullanıcı yüzeyine sahip olmalıdır:

## 2.1 YouTube sayfası içindeki mini panel

YouTube video sayfasında, videonun altındaki işlem düğmelerinin yakınında küçük bir eklenti ikonu bulunur.

İkona basıldığında:

* Chrome yan paneli açılır.
* Geçerli videonun transkript durumu gösterilir.
* Hızlı özetleme seçeneklerine erişilir.

Videonun sağ tarafında, YouTube’un önerilen videolar alanına uyumlu, dar bir özet kartı da gösterilebilir.

Bu kartın üst bölümü:

* **Gemini Özet**
* **API Özet**
* **Yerel AI**
* Özet uzunluğu
* Çıktı dili
* Yeniden oluştur
* Yan panelde aç

seçeneklerini içerir.

Kartın altında oluşturulan kısa özet ve beş ana fikir yer alır. Ayrıntılı transkript, dil çalışma alanı, soru-cevap ve geçmiş gibi bölümler Chrome yan panelinde tutulur.

## 2.2 Chrome yan paneli

Chrome Side Panel API, bir eklentinin web sayfasının yanında kalıcı bir arayüz göstermesini, panelin sekmeler arasında açık kalmasını ve panel içinden Chrome API’lerine erişilmesini desteklemektedir. Panel belirli sitelerde, örneğin yalnızca YouTube’da etkinleştirilebilir.

Yan panel eklentinin asıl çalışma alanı olacaktır.

Önerilen ana menü:

| Bölüm      | Görev                                         |
| ---------- | --------------------------------------------- |
| Video      | Geçerli video bilgisi ve özetleme işlemleri   |
| Özet       | Kısa, standart ve ayrıntılı özetler           |
| Transkript | Tam metin, arama ve zaman damgaları           |
| Öğren      | Kelimeler, cümleler, flashcard ve testler     |
| Sor        | Video hakkında soru-cevap                     |
| Geçmiş     | Daha önce işlenen videolar                    |
| Ayarlar    | Gem, API, dil, saklama ve görünüm seçenekleri |

---

# 3. Genel sistem mimarisi

Kavramsal veri akışı:

```text
YouTube video sayfası
        ↓
Video ve altyazı algılama katmanı
        ↓
Transkript temizleme ve zaman damgası normalizasyonu
        ↓
Yapay zekâ yönlendiricisi
   ├── Gemini Gem otomasyonu
   ├── Haricî API
   └── Chrome Yerel AI
        ↓
Yapılandırılmış sonuç
        ↓
YouTube özet kartı + Chrome yan paneli
        ↓
Yerel geçmiş, kelimeler, flashcard ve dışa aktarma
```

Tek bir özetleme sistemine bağımlı olunmamalıdır. Transkript çıkarma, özetleme sağlayıcısı ve kullanıcı arayüzü birbirinden bağımsız katmanlar olarak düşünülmelidir.

Bu sayede daha sonra:

* Gemini yerine başka model kullanılabilir.
* Yeni bir ücretsiz API eklenebilir.
* Chrome Yerel AI kullanılabilir.
* Gem otomasyonu bozulsa bile API modu çalışmaya devam eder.

---

# 4. Video algılama ve transkript alma

## 4.1 YouTube sayfasının algılanması

YouTube klasik çok sayfalı bir site gibi çalışmaz. Bir videodan başka bir videoya geçildiğinde sayfa tamamen yenilenmeyebilir.

Eklenti aşağıdaki değişiklikleri algılamalıdır:

* Video kimliğinin değişmesi
* Başlığın değişmesi
* Dil veya altyazı kanalının değişmesi
* Shorts ve normal video ayrımı
* Canlı yayın veya geçmiş yayın olması
* Oynatma listesi içinden video değiştirilmesi

Yeni video algılandığında önceki videoya ait özet yeni videoda gösterilmemelidir.

Her işlem şu kimlikle ilişkilendirilmelidir:

* Video ID
* Altyazı dili
* Altyazı kaynağı
* Transkript sürümü veya özeti
* Kullanılan yapay zekâ yöntemi
* Özet uzunluğu ve çıktı dili

## 4.2 Transkript erişimi

YouTube, altyazısı bulunan videolarda kullanıcıya “Transkripti göster” işlevi sunar. Transkript video oynarken geçerli altyazı satırına göre ilerler.

Eklenti için önerilen kaynak sırası:

1. İçerik üreticisi tarafından yüklenen manuel altyazı
2. Videonun orijinal dilindeki otomatik altyazı
3. Başka dildeki manuel altyazı
4. YouTube tarafından çevrilmiş altyazı
5. Kullanıcının seçtiği alternatif altyazı

Resmî YouTube Data API’de `captions.list` yalnızca altyazı kanallarını listeler, gerçek altyazı metnini döndürmez. Gerçek dosyayı indiren `captions.download` işlemi ise kullanıcının videoyu düzenleme yetkisine sahip olmasını gerektirir. Bu nedenle resmî API, herhangi bir herkese açık YouTube videosunun altyazısını indirmek için genel bir çözüm değildir.

İlk sürümde pratik yöntem:

* YouTube sayfasında kullanılabilir altyazı kanallarını algılama
* Manuel ve otomatik altyazıyı ayırt etme
* Metin ile başlangıç/bitiş zamanlarını çıkarma
* Aynı cümlenin tekrar eden parçalarını temizleme
* Zaman damgalarını standart biçime dönüştürme

YouTube arayüzü değişebileceği için transkript erişim katmanı eklentinin geri kalanından bağımsız tutulmalıdır.

## 4.3 İlk sürümde altyazısız videolar

İlk aşamada ses dosyasını indirip konuşmadan metne dönüştürme özelliğinin eklenmemesi daha doğru olacaktır.

Altyazı bulunamadığında:

> Bu videoda erişilebilir manuel veya otomatik altyazı bulunamadı.

uyarısı gösterilebilir.

Daha sonraki sürümde isteğe bağlı ses transkripsiyonu eklenebilir. Bu özellik hem YouTube erişimi hem de ses işleme açısından altyazı çıkarmaktan çok daha karmaşıktır.

---

# 5. Altyazı kaynağı ve kalite değerlendirmesi

Transkript bölümünün üst kısmında kaynak açıkça gösterilmelidir:

* **Manuel altyazı**
* **Otomatik altyazı**
* **Çevrilmiş altyazı**
* **Kaynak belirlenemedi**

## 5.1 Altyazı kalite uyarısı

Eklenti kesin bir doğruluk yüzdesi verdiğini iddia etmemelidir. Bunun yerine açıklanabilir bir kalite göstergesi kullanılabilir.

### Yüksek kalite

* Manuel altyazı
* Video diliyle altyazı dili eşleşiyor
* Zaman damgası kopukluğu az
* Çok az bozuk veya anlamsız satır var

### Orta kalite

* Otomatik altyazı
* Metin genel olarak okunabilir
* Bazı noktalama ve özel isim hataları var

### Düşük kalite

* Çok sayıda anlamsız kelime
* Büyük zaman boşlukları
* Altyazı dili video diliyle uyuşmuyor
* Yüksek oranda müzik veya tanımsız ses etiketi
* Çok kısa veya eksik transkript

Özetin üstünde şu tür bir uyarı gösterilebilir:

> Otomatik altyazı kullanıldı. Özel isimler, sayılar ve teknik terimler hatalı olabilir.

---

# 6. Yapay zekâ katmanı

Eklenti başlangıçta iki ana yöntem sunacaktır. Üçüncü seçenek olarak Chrome Yerel AI eklenmesi önerilmektedir.

---

# 7. Seçenek 1 — Gemini Gem otomasyonu

## 7.1 Amaç

Eklenti ayarlarında kullanıcı tarafından değiştirilebilen bir Gemini Gem adresi tutulur.

Özetleme başlatıldığında eklenti:

1. Transkripti çıkarır.
2. Transkripti seçilen formatta hazırlar.
3. Ayarlardaki Gem adresini açar.
4. Transkripti ve video bilgilerini Gem’e gönderir.
5. Gem yanıtını bekler.
6. Oluşan sonucu YouTube özet kartına ve yan panele taşır.

Gems, Gemini’ye belirli ve tekrarlanabilir talimatlar vermek amacıyla oluşturulan özel yardımcılar olarak çalışır. Gems, Gemini web ve mobil uygulamalarında kullanılmaktadır.

## 7.2 Önemli teknik gerçek

Bir Gem bağlantısı, geliştiriciler için yayımlanmış bir API uç noktası değildir. Gemini API belgeleri; API anahtarı, model çağrısı ve sistem talimatı üzerinden çalışan ayrı bir geliştirici altyapısı tanımlar. Gem bağlantısını programatik şekilde çağıran resmî bir Gem API’si belgelenmemiştir. Bu nedenle Gem yolu, Gemini web arayüzünün otomasyonu olacaktır; resmî bir model entegrasyonu olmayacaktır. Bu sonuç, mevcut resmî Gem ve Gemini API belgelerinden yapılan bir çıkarımdır.

## 7.3 Önerilen çalışma biçimleri

### A. Arka planda pasif sekme

Kullanıcı “Gemini Özet” düğmesine basar.

Eklenti:

* Mevcut veya yeni bir Gemini sekmesini açar.
* Sekmeyi aktif hâle getirmeden Gem adresine gider.
* Kullanıcının mevcut Google oturumunu kullanır.
* Gemini giriş alanına transkripti yerleştirir.
* İsteği gönderir.
* Yanıt tamamlandığında sonucu eklentiye aktarır.

Bu yöntem kullanıcı deneyimi açısından hedeflenen yöntemdir ancak kırılgan olabilir.

### B. Görünür Gemini sekmesi

Arka plan otomasyonu başarısız olursa:

* Gemini sekmesi aktif olarak açılır.
* Gem ve transkript hazır hâle getirilir.
* Kullanıcı gerekirse gönderme işlemini tamamlar.
* Sonuç Gemini sekmesinde kalabilir veya yeniden eklentiye alınabilir.

### C. Yarı otomatik mod

En güvenilir yedek yöntem:

* Transkript panoya kopyalanır.
* Gem sekmesi açılır.
* Kullanıcıya “Gemini’ye yapıştır” mesajı gösterilir.

Bu yöntem tam otomasyon kadar rahat değildir ancak Gemini arayüzü değiştiğinde bile çalışabilir.

## 7.4 Neden gerçek anlamda gizli bir Gem işlemi zor?

Manifest V3 service worker arka planda görevleri koordine eder ancak web sayfalarının DOM’una doğrudan erişemez. Chrome’un Offscreen API’si gizli bir uzantı belgesi açabilir; fakat bu belge Gemini web uygulamasının yerine geçen bir arka plan tarayıcı sekmesi değildir. Dolayısıyla Gemini web arayüzünü kullanmak için normal bir Gemini sekmesi ve bu sekmede çalışan sayfa entegrasyonu gerekir.

## 7.5 Gem modu riskleri

* Gemini hesabından çıkış yapılmış olabilir.
* Gem bağlantısı değişebilir veya erişilemez olabilir.
* Gemini arayüzündeki buton ve metin alanları değişebilir.
* Güvenlik doğrulaması veya CAPTCHA çıkabilir.
* Çok uzun transkript tek mesaj sınırını aşabilir.
* Yanıtın tamamlandığını belirlemek zorlaşabilir.
* Gemini yeni bir sohbet açabilir veya mevcut konuşmayı sürdürebilir.
* Arka plandaki sekme Chrome tarafından uykuya alınabilir.
* Türkçe ve İngilizce çift çıktı çok uzun olabilir.

Bu nedenle Gem modu arayüzde şu etiketle gösterilebilir:

> **Gemini Gem — Deneysel**

## 7.6 Gem modunda uzun transkript

Normal uzunluktaki videolarda tüm transkript tek mesaj olarak gönderilebilir.

Çok uzun videolarda üç seçenek olmalıdır:

1. Transkripti bölümlere ayırarak gönder
2. Yalnızca temizlenmiş transkripti gönder
3. API veya Yerel AI moduna geç

Gem otomasyonunda çok parçalı konuşma, sonucu bir araya getirme sürecini karmaşıklaştıracağı için ilk sürümde belirli bir metin sınırı uygulanması daha güvenlidir.

---

# 8. Seçenek 2 — Haricî API ile özetleme

## 8.1 Sağlayıcıdan bağımsız yapı

Eklenti tek bir API’ye göre tasarlanmamalıdır.

Ayarlar ekranında şu alanlar bulunabilir:

* Sağlayıcı
* API adresi
* API anahtarı
* Model adı
* Bağlantıyı test et
* Maksimum çıktı uzunluğu
* Özel sistem talimatı
* İstek zaman aşımı
* Akışlı yanıt kullan
* Varsayılan sağlayıcı yap

Hazır profiller:

* Gemini API
* DeepSeek
* NVIDIA
* OpenAI uyumlu özel servis
* Özel REST API

Ücretsiz kullanım limitleri zaman içinde değişebileceği için model adı, adres ve sağlayıcı bilgileri eklentiye sabitlenmemelidir. Örneğin Gemini API’de ücretsiz katman yalnızca uygun modeller ve ilgili hız sınırları kapsamında sunulmaktadır.

## 8.2 Gem talimatının API modunda yeniden kullanılması

Gem içinde kullanılan YouTube özet talimatı ayrı bir “Özetleme profili” olarak eklenti ayarlarına eklenmelidir.

Gemini API, model davranışını sistem talimatlarıyla yönlendirmeyi destekler. Bu nedenle Gem’in özetleme mantığı büyük ölçüde normal API çağrısında yeniden oluşturulabilir.

Önerilen profiller:

* Genel YouTube özeti
* Teknik eğitim
* Haber ve röportaj
* İngilizce öğrenme
* Akademik ders
* Podcast
* Adım adım eğitim
* Eleştirel analiz

Bu yapı, Gem otomasyonu bozulduğunda aynı talimatın API üzerinden kullanılmasını sağlar.

## 8.3 API anahtarının yerel saklanması

Kişisel kullanım için API anahtarı Chrome profilinde yerel olarak tutulabilir.

Önerilen güvenlik yaklaşımı:

* Anahtar yalnızca eklenti ayarlarında girilir.
* Ekranda maskeli gösterilir.
* İçerik betiğine veya YouTube sayfasına aktarılmaz.
* Yalnızca güvenilir eklenti bileşeni API isteğinde kullanır.
* “Anahtarı göster”, “Anahtarı değiştir” ve “Anahtarı sil” seçenekleri bulunur.
* Hata kayıtlarına hiçbir zaman anahtar yazılmaz.
* Dışa aktarılan ayar dosyasına varsayılan olarak eklenmez.

`chrome.storage.local` verileri eklenti kaldırıldığında silinir ve varsayılan depolama sınırı 10 MB’tır. Bu alan ayarlar ve küçük miktarda yapılandırma için uygundur.

API anahtarları için kavramsal olarak iki saklama seçeneği sunulabilir:

* **Kalıcı sakla:** Tarayıcı yeniden açıldığında kullanılabilir.
* **Oturum boyunca sakla:** Chrome kapandığında anahtar unutulur.

İkinci seçenek daha güvenlidir fakat her oturumda anahtarın yeniden girilmesini gerektirir.

## 8.4 API modunun avantajları

* Gem arayüzündeki değişikliklerden etkilenmez.
* Yanıt doğrudan eklenti paneline gelir.
* JSON gibi yapılandırılmış çıktı istenebilir.
* Zaman damgaları ve bölümler daha güvenilir ayrıştırılabilir.
* Özet, flashcard ve testler tek istekte üretilebilir.
* Hata, kota ve model durumu daha kolay gösterilebilir.
* Uzun transkriptlerde bölümleme yapılabilir.

İlk sürüm için en güvenilir ana yöntem API modudur. Gem modu isteğe bağlı ve deneysel alternatif olarak tutulmalıdır.

---

# 9. Seçenek 3 — Chrome Yerel AI

## 9.1 Kullanılabilir mi?

Evet. Chrome’un bazı yerleşik AI API’leri Chrome eklentilerinden kullanılabilir.

Chrome belgelerine göre aşağıdaki API’ler Chrome 138’den itibaren eklentiler için kararlı sürümde kullanılabilir:

* Summarizer API
* Prompt API
* Translator API
* Language Detector API

Writer ve Rewriter API’leri ise geliştirici denemesi aşamasındadır.

Bu API’ler için normal bir Gemini API anahtarı gerekmez. Temel model kullanıcının bilgisayarına indirilir ve işlem cihaz üzerinde gerçekleştirilir. İlk model indirmesinden sonra model kullanımı çevrimdışı çalışabilir ve veriler Google’a veya üçüncü tarafa gönderilmez.

Bu nedenle eklentide üçüncü seçenek olarak şu özellik önerilmektedir:

> **Yerel AI — Ücretsiz ve cihaz üzerinde**

“Ücretsiz” burada herhangi bir API çağrısı başına ücret bulunmaması anlamındadır. Bilgisayarın depolama, işlemci ve bellek kaynakları kullanılır.

## 9.2 Donanım gereksinimleri

Prompt ve Summarizer gibi temel model kullanan Chrome AI özellikleri için resmî belgelerde şu koşullar belirtilmektedir:

* Windows 10 veya 11, macOS 13+, Linux ya da desteklenen Chromebook Plus
* Chrome profilinin bulunduğu diskte en az 22 GB boş alan
* 4 GB’tan fazla VRAM bulunan GPU veya
* En az 16 GB RAM ve en az dört işlemci çekirdeği
* İlk model indirmesi için kotasız internet bağlantısı

Chrome Android ve iOS üzerinde bu temel model API’leri henüz desteklenmemektedir.

Ayarlar ekranında bir **Yerel AI uygunluk testi** bulunmalıdır:

* Destekleniyor
* Model indirilmesi gerekiyor
* Model indiriliyor
* Kullanıma hazır
* Donanım yetersiz
* Tarayıcı sürümü desteklenmiyor

## 9.3 Türkçe desteği

Chrome’un temel dil modeli için resmî belgeler Chrome 149 itibarıyla şu giriş ve çıktı dillerini belirtmektedir:

* İngilizce
* İspanyolca
* Japonca
* Almanca
* Fransızca

Türkçe temel modelin doğrudan desteklenen dilleri arasında değildir.

Buna karşılık Chrome Translator API’nin desteklediği diller arasında Türkçe bulunmaktadır.

Bu nedenle Türkçe için şu yerel işlem hattı kurulabilir:

```text
Türkçe transkript
      ↓
Chrome Translator: Türkçe → İngilizce
      ↓
Chrome Summarizer veya Prompt API
      ↓
İngilizce özet
      ↓
Chrome Translator: İngilizce → Türkçe
```

Bu yöntem tamamen cihaz üzerinde ve API anahtarı olmadan çalışabilir.

Ancak iki kez çeviri yapılması:

* Teknik terimleri değiştirebilir.
* Özel isimleri bozabilir.
* Bazı anlam ayrıntılarını kaybettirebilir.
* Doğrudan Türkçe çalışan bulut modelinden daha düşük kalite verebilir.

Bu nedenle Yerel AI modu Türkçe için başlangıçta **deneysel** olarak işaretlenmelidir.

## 9.4 Uzun transkript sınırlaması

Chrome cihaz içi modellerinin bağlam kapasitesi sunucu modellerinden daha küçüktür. Chrome’un kendi rehberi, uzun metinler için metni anlamlı bölümlere ayırmayı, her bölümü özetlemeyi ve bölüm özetlerinden son bir genel özet oluşturmayı önermektedir.

Yerel AI akışı:

1. Transkripti video bölümlerine veya konu geçişlerine göre ayır
2. Her bölümün özetini oluştur
3. Bölüm özetlerini birleştir
4. Genel özeti oluştur
5. Beş ana fikri çıkar
6. Flashcard ve testleri ayrı olarak üret

## 9.5 Chrome’daki Gemini yan paneliyle karıştırılmamalı

Chrome’un kendi Gemini yan paneli açık sekme içeriğini kullanarak sorulara yanıt verebilir.

Ancak Chrome’un yerleşik Gemini kullanıcı arayüzü ile geliştiricilere açık Built-in AI API’leri aynı şey değildir.

Eklenti:

* Chrome’un Gemini yan paneline komut gönderemez.
* Gemini yan panelinin cevabını doğrudan okuyamaz.
* Kullanıcının Gemini in Chrome kullanım hakkını bir eklenti API’si gibi kullanamaz.

Eklentinin ücretsiz yerel entegrasyonu, geliştirici belgelerinde açıklanan Prompt, Summarizer, Translator ve Language Detector API’leri üzerinden yapılmalıdır. Bu ayrım, mevcut ürün ve geliştirici belgelerinden yapılan bir değerlendirmedir.

---

# 10. Önerilen yapay zekâ öncelik sırası

Kişisel kullanım için önerilen sıralama:

## Birinci tercih: API modu

En güvenilir ve kontrol edilebilir yöntemdir.

Özellikle:

* Türkçe özet
* Çift dil
* Beş ana fikir
* Flashcard
* Test soruları
* Video soru-cevap
* Yapılandırılmış zaman damgaları

için kullanılmalıdır.

## İkinci tercih: Chrome Yerel AI

API kotası bittiğinde veya transkriptin bilgisayardan çıkması istenmediğinde kullanılabilir.

En uygun kullanım alanları:

* İngilizce videolar
* Kısa ve orta uzunlukta transkript
* Kısa özet
* Çeviri
* Kelime ve cümle çalışması

## Üçüncü tercih: Gemini Gem

Kullanıcının mevcut Gem talimatını aynen kullanmak istediği durumlarda değerlidir. Ancak web arayüzü otomasyonu nedeniyle ana motor değil, alternatif motor olarak düşünülmelidir.

---

# 11. Özetleme seçenekleri

Her özetleme işlemi öncesinde iki ayrı seçim yapılmalıdır.

## 11.1 Özet uzunluğu

### Kısa

* 3–5 cümle
* Videonun amacı
* En önemli sonuç
* Tahmini okuma süresi: 30 saniye

### Standart

* Kısa genel özet
* Beş ana fikir
* Bölüm bazlı özet
* Önemli zaman damgaları
* Sonuç veya eylem maddeleri

### Ayrıntılı

* Geniş genel özet
* Tüm ana bölümler
* Ana fikirler
* Önemli örnekler
* Kavramlar ve tanımlar
* Eylem maddeleri
* Önemli alıntılar
* Tartışmalı veya belirsiz noktalar
* Zaman damgalı referanslar

## 11.2 Çıktı dili

* Türkçe
* İngilizce
* Türkçe + İngilizce

“Her iki dil” seçildiğinde ekran iki şekilde gösterilebilir:

### Yan yana

| Türkçe      | English         |
| ----------- | --------------- |
| Türkçe özet | English summary |

### Alt alta

* Türkçe özet
* İngilizce özet

Dar Chrome yan panelinde alt alta görünüm varsayılan olmalıdır.

## 11.3 Transkript dili

Transkript için de ayrı seçim bulunmalıdır:

* Orijinal transkript
* Türkçe çeviri
* İngilizce çeviri
* Orijinal + çeviri

Böylece İngilizce öğrenme alanında İngilizce özgün cümle korunurken Türkçe karşılığı da gösterilebilir.

---

# 12. Beş ana fikir

Her özet sonucunda ayrı bir **Beş Ana Fikir** bölümü oluşturulmalıdır.

Her madde:

* Kısa başlık
* Bir veya iki cümlelik açıklama
* İlgili başlangıç zamanı
* “Videoda aç” düğmesi

içermelidir.

Örnek yapı:

> **1. Şebeke frekansı anlık dengeyi gösterir**
> Üretim ve tüketim arasındaki dengesizlik frekansın değişmesine yol açar.
> `04:18 — Videoda aç`

Ana fikirler yalnızca özet metninden değil, kaynak transkript ve zaman damgalarından üretilmelidir.

---

# 13. Tam transkript ekranı

Transkript sekmesinin üst bölümü:

* Transkript dili
* Manuel/otomatik etiketi
* Kalite uyarısı
* Toplam süre
* Tahmini kelime sayısı
* Arama alanı
* Çeviriyi göster
* Zaman damgalarını göster/gizle
* Dışa aktar

## 13.1 Transkript içinde arama

Arama özelliği yapay zekâ gerektirmeden yerel olarak çalışmalıdır.

Arama sonucu:

* Bulunan ifade
* Öncesindeki ve sonrasındaki kısa bağlam
* Zaman damgası
* Videoda aç
* Kelime olarak ekle
* Cümle olarak ekle

seçeneklerini göstermelidir.

Arama için desteklenebilecek seçenekler:

* Tam ifade
* Büyük/küçük harf duyarlılığı
* Yalnızca özgün dilde ara
* Yalnızca çeviride ara
* Tüm eşleşmeleri işaretle

## 13.2 Tıklanabilir zaman damgaları

Her transkript satırının başındaki zaman bilgisi tıklanabilir olmalıdır.

Tıklanınca:

* Video ilgili saniyeye gider.
* Gerekirse oynatma başlar.
* İlgili transkript satırı vurgulanır.
* Panel kullanıcı tarafından kapatılmadıkça açık kalır.

---

# 14. Kelime ve cümle ekleme özellikleri

Kullanıcı transkriptteki herhangi bir kelimeyi veya cümleyi seçebilmelidir.

Seçim sonrasında küçük bir işlem menüsü:

* Kelimelere ekle
* Cümlelere ekle
* Türkçeye çevir
* İngilizceye çevir
* Açıkla
* Flashcard oluştur
* Videoda aç
* Not ekle

gösterebilir.

## 14.1 Kelime kaydı

Bir kelime kaydı şu alanları içerebilir:

* Kelime
* Temel biçim
* Türkçe anlam
* İngilizce açıklama
* Videodaki özgün cümle
* Zaman damgası
* Kullanıcının notu
* Etiketler
* Öğrenme durumu
* Eklenme tarihi
* Kaynak video

## 14.2 Cümle kaydı

Bir cümle kaydı:

* Özgün cümle
* Türkçe çeviri
* İngilizce açıklama
* Kullanılan önemli yapı
* Zaman damgası
* Video başlığı
* Kullanıcı notu
* Etiket

alanlarını içerebilir.

## 14.3 Manuel ekleme

Kullanıcı yalnızca transkriptten seçim yapmak zorunda olmamalıdır.

Öğren bölümünde:

* Yeni kelime ekle
* Yeni cümle ekle
* Panodan yapıştır
* Seçili video ile ilişkilendir
* Genel çalışma listesine ekle

seçenekleri bulunmalıdır.

---

# 15. İngilizce öğrenme çalışma alanı

Yan panelde ayrı bir **Öğren** sekmesi bulunmalıdır.

Önerilen alt bölümler:

* Kelimeler
* Cümleler
* Flashcard
* Test
* Video kelimeleri
* Tekrar listesi

## 15.1 Otomatik çalışma materyali

Bir İngilizce video için eklenti şu materyalleri oluşturabilir:

* Videodaki önemli 10–20 kelime
* Deyimler ve kalıplar
* Teknik terimler
* Önemli cümle yapıları
* Türkçe anlamlar
* Özgün kullanım cümleleri
* Zaman damgaları
* Kısa dil bilgisi açıklamaları

Kullanıcı tüm önerileri otomatik kaydetmek yerine önce seçebilmelidir.

## 15.2 Flashcard

Kartın ön yüzü:

* İngilizce kelime veya cümle
* İsteğe bağlı boşluk doldurma
* “Videoda dinle” düğmesi

Kartın arka yüzü:

* Türkçe karşılık
* İngilizce açıklama
* Özgün cümle
* Kısa kullanım notu
* Video ve zaman damgası

Değerlendirme düğmeleri:

* Bilmiyorum
* Zor
* Hatırladım
* Kolay

İlk sürümde basit tekrar listesi yeterlidir. Daha sonra aralıklı tekrar sistemi eklenebilir.

## 15.3 Test soruları

Desteklenebilecek test tipleri:

* Çoktan seçmeli kelime anlamı
* İngilizce–Türkçe eşleştirme
* Boşluk doldurma
* Doğru/yanlış
* Cümle sıralama
* Videonun içeriğini anlama soruları
* Beş ana fikir testi
* Kısa cevap
* “Bu ifade videoda ne anlama geliyor?” sorusu

Sorular yalnızca videodaki bilgilere dayanmalıdır.

Her yanlış cevapta:

* Doğru cevap
* Kısa açıklama
* İlgili transkript cümlesi
* Zaman damgası

gösterilmelidir.

---

# 16. Video hakkında soru-cevap

**Sor** sekmesinde kullanıcı videoyla ilgili serbest soru sorabilir.

Örnekler:

* Videonun ana sonucu nedir?
* Konuşmacı bu kavramı nasıl tanımlıyor?
* Şu konu hangi dakikada anlatılıyor?
* Bu videoda Türkiye’den bahsediliyor mu?
* Konuşmacının önerdiği adımlar nelerdir?
* Videodaki teknik terimleri açıkla.
* Bu videoya göre beş test sorusu oluştur.

## 16.1 Yanıt kuralları

Yapay zekâya şu davranış uygulanmalıdır:

* Yalnızca transkriptteki bilgiye dayan.
* Bilgi yoksa açıkça belirt.
* Mümkünse ilgili zaman damgasını göster.
* Tahmin ile videoda söyleneni ayır.
* Transkript kalitesi düşükse uyarı ver.
* Yanıt dilini kullanıcı ayarına göre belirle.

Örnek:

> Transkriptte bu soruya doğrudan cevap veren bir ifade bulunamadı. En yakın bölüm 18:20–19:05 arasındadır.

## 16.2 Soru-cevap maliyet yönetimi

Her soruda bütün transkripti yeniden göndermek yerine:

1. Soru içindeki ana kavramlar belirlenir.
2. Transkriptin ilgili bölümleri bulunur.
3. Yalnızca ilgili parçalar modele gönderilir.
4. Sonuç zaman damgalarıyla birlikte sunulur.

Kişisel ilk sürümde basit metin araması ve bölüm seçimi yeterli olabilir. Daha sonra anlamsal arama eklenebilir.

---

# 17. Dışa aktarma

## 17.1 TXT

Seçenekler:

* Yalnızca transkript
* Yalnızca özet
* Özet + transkript
* Kelimeler ve cümleler
* Soru-cevap geçmişi

TXT dosyası mümkün olduğunca sade tutulmalıdır.

## 17.2 Markdown

Markdown çıktısı şunları içerebilir:

* Video başlığı
* Kanal
* Video adresi
* Tarih
* Altyazı kaynağı ve dili
* Genel özet
* Beş ana fikir
* Zaman damgalı bölümler
* Eylem maddeleri
* Kelime listesi
* Tam transkript

Zaman damgaları YouTube bağlantısı olarak oluşturulabilir.

## 17.3 SRT

SRT çıktısında:

* Sıra numarası
* Başlangıç zamanı
* Bitiş zamanı
* Altyazı metni

bulunmalıdır.

SRT seçenekleri:

* Orijinal dil
* Türkçe çeviri
* İngilizce çeviri
* İki satırlı çift dil

Çevrilmiş SRT’de özgün zaman damgaları korunmalıdır.

---

# 18. Geçmiş ve yerel veri yapısı

## 18.1 Geçmiş kaydı

Her işlenen video için:

* Video ID
* Başlık
* Kanal
* Küçük resim
* Video adresi
* Süre
* İşlem tarihi
* Transkript dili
* Manuel/otomatik bilgisi
* Kullanılan AI yöntemi
* Kullanılan model
* Oluşturulan özet türleri
* Kaydedilen kelime sayısı
* Kaydedilen cümle sayısı
* Son görüntüleme tarihi

saklanabilir.

## 18.2 Geçmiş ekranı

Arama ve filtreler:

* Video başlığı
* Kanal
* Tarih
* Dil
* Gemini/API/Yerel AI
* Manuel/otomatik altyazı
* Kelime eklenen videolar
* Favoriler

Her kayıtta:

* YouTube’da aç
* Özeti aç
* Transkripti aç
* Yeniden özetle
* Dışa aktar
* Sil

işlemleri bulunmalıdır.

## 18.3 Saklama teknolojisi

Önerilen ayrım:

### Chrome Storage

* Genel ayarlar
* Gem adresi
* Seçilen model
* Arayüz dili
* Varsayılan özet seçenekleri
* API bağlantı ayarları

### IndexedDB

* Uzun transkriptler
* Özetler
* Video geçmişi
* Kelimeler
* Cümleler
* Flashcard verileri
* Test sonuçları
* Soru-cevap geçmişi

Chrome Storage’ın varsayılan yerel sınırı 10 MB olduğu için uzun video transkriptlerini yalnızca burada saklamak uygun değildir.

## 18.4 Saklama politikası

Ayar seçenekleri:

* Tüm videoları sakla
* Son 10 videoyu sakla
* Son 30 videoyu sakla
* Yalnızca favorileri sakla
* Transkripti saklama, yalnızca özeti sakla
* Belirli gün sonra otomatik sil
* Tüm geçmişi temizle
* Tüm verileri yedekle
* Yedekten geri yükle

---

# 19. Ayarlar ekranı

## 19.1 Genel

* Arayüz dili: Türkçe / English
* Tema: Sistem / Açık / Koyu
* Panel görünümü: YouTube kartı / yalnızca yan panel / ikisi
* Yan panel otomatik açılsın
* Son kullanılan bölüm hatırlansın
* Video değiştiğinde otomatik transkript çıkar
* Video değiştiğinde otomatik özetleme başlatma

Otomatik özetleme varsayılan olarak kapalı olmalıdır. Böylece gereksiz API kullanımı önlenir.

## 19.2 Özet

* Varsayılan yöntem
* Varsayılan uzunluk
* Varsayılan çıktı dili
* Beş ana fikir üret
* Bölüm özeti üret
* Zaman damgası ekle
* Eylem maddesi üret
* Önemli kelimeleri üret
* Flashcard önerileri üret
* Test soruları üret

## 19.3 Gemini Gem

* Gem adresi
* Adresi test et
* Pasif sekmede çalıştır
* Başarısızsa görünür sekme aç
* Gemini sekmesini işlem sonunda kapat
* Mevcut Gemini sekmesini yeniden kullan
* Gönderilecek talimatın ön izlemesi
* Maksimum metin uzunluğu
* Çok uzun videoda API’ye geç

## 19.4 API

* Sağlayıcı
* API adresi
* API anahtarı
* Model
* Bağlantıyı test et
* Özel sistem talimatı
* Akışlı yanıt
* Zaman aşımı
* Maksimum cevap uzunluğu
* Anahtarı oturumluk veya kalıcı sakla

## 19.5 Yerel AI

* Chrome AI desteğini kontrol et
* Model durumu
* Model indirme durumu
* Yerel özetleme kullan
* Yerel çeviri kullan
* Türkçe için İngilizce üzerinden çeviri
* Yetersizse otomatik API’ye geç
* Yalnızca çevrimdışıyken yerel AI kullan

## 19.6 Veri

* Geçmiş saklama süresi
* Transkriptleri sakla
* Soru-cevap geçmişini sakla
* Öğrenme verilerini sakla
* Tüm verileri dışa aktar
* Tüm verileri sil
* API anahtarlarını sil

---

# 20. Hata ve durum yönetimi

Özetleme sırasında kullanıcıya açık durum bilgisi gösterilmelidir.

Önerilen durumlar:

1. Video algılandı
2. Altyazı aranıyor
3. Altyazı bulundu
4. Transkript hazırlanıyor
5. Gemini/API/Yerel AI bekleniyor
6. Yanıt alınıyor
7. Sonuç düzenleniyor
8. Tamamlandı

Hata türleri ayrı gösterilmelidir:

* Altyazı bulunamadı
* Gemini hesabına giriş gerekli
* Gem adresi açılamadı
* Gemini arayüzü algılanamadı
* API anahtarı geçersiz
* API kotası doldu
* Model bulunamadı
* Transkript model sınırını aşıyor
* Chrome Yerel AI desteklenmiyor
* Yerel model indirilemedi
* İnternet bağlantısı yok
* Video işlem sırasında değişti
* İşlem iptal edildi

Her hata için uygun işlem düğmesi bulunmalıdır:

* Tekrar dene
* Başka yöntem kullan
* Ayarları aç
* Gemini sekmesinde devam et
* Transkripti kopyala

---

# 21. Sonuçların yanlış videoya yazılmasını önleme

Bu konu özellikle önemlidir.

Örnek durum:

1. Kullanıcı A videosunda özetlemeyi başlatır.
2. Özet hazırlanırken B videosuna geçer.
3. A videosunun yanıtı tamamlanır.
4. Sonuç yanlışlıkla B videosunun paneline yazılır.

Bunu önlemek için her görev:

* Video ID
* Transkript kimliği
* Başlangıç zamanı
* Sekme kimliği
* İşlem kimliği

ile izlenmelidir.

Yanıt geldiğinde geçerli video değişmişse:

* Sonuç A videosunun geçmişine kaydedilir.
* B videosunda gösterilmez.
* “Önceki videonun özeti tamamlandı” bildirimi gösterilir.

---

# 22. Önbellek ve tekrar kullanım

Aynı video aynı ayarlarla tekrar özetlendiğinde gereksiz API isteği gönderilmemelidir.

Önbellek anahtarı:

```text
Video ID
+ transkript dili
+ transkript içeriği
+ özet uzunluğu
+ çıktı dili
+ sağlayıcı
+ model
+ özetleme profili
```

Kullanıcıya:

* Kayıtlı sonucu göster
* Yeniden oluştur
* Farklı modelle oluştur

seçenekleri sunulabilir.

---

# 23. Zorunlu özelliklerin kapsam karşılığı

| İstenen özellik                 | Kavramsal karşılığı                                  |
| ------------------------------- | ---------------------------------------------------- |
| YouTube sayfasında özet düğmesi | Video altındaki eklenti ikonu ve sağ özet kartı      |
| Chrome yan paneli               | Video, Özet, Transkript, Öğren, Sor, Geçmiş, Ayarlar |
| Türkçe ve İngilizce arayüz      | Tüm arayüz metinlerinde TR/EN dil paketi             |
| Tam transkript                  | Zaman damgalı, aranabilir transkript ekranı          |
| Kısa, standart, ayrıntılı özet  | Üç ayrı özet uzunluğu                                |
| Türkçe, İngilizce veya çift dil | Özet ve transkript için ayrı dil ayarları            |
| Kelime ve cümle ekleme          | Transkript seçim menüsü ve manuel ekleme             |
| Flashcard ve test               | Öğren sekmesinde çalışma alanı                       |
| Beş ana fikir                   | Her özetin ayrı temel bölümü                         |
| Tıklanabilir timestamps         | Videonun ilgili saniyesine geçiş                     |
| Transkript arama                | Yerel tam metin araması                              |
| Video soru-cevap                | Transkript temelli ve kaynak zamanlı yanıt           |
| TXT, Markdown, SRT              | Ayrı dışa aktarma seçenekleri                        |
| Son videolar                    | Yerel geçmiş ve filtreleme                           |
| Manuel/otomatik altyazı         | Kaynak etiketi                                       |
| Altyazı kalite uyarısı          | Yüksek, orta, düşük ve açıklama                      |
| Gemini Gem                      | Ayarlanabilir URL ve sekme otomasyonu                |
| Ücretsiz API                    | Değiştirilebilir sağlayıcı/model altyapısı           |
| Chrome native AI                | Yerel AI üçüncü yöntemi                              |

---

# 24. Önerilen ilk sürüm

İlk sürüm mümkün olduğunca kontrollü tutulmalıdır.

## İlk sürüme alınmalı

* Normal YouTube video sayfaları
* Mevcut manuel veya otomatik altyazıyı çıkarma
* Manuel/otomatik altyazı ayrımı
* Altyazı kalite uyarısı
* YouTube sayfasında özet düğmesi
* Chrome yan paneli
* Gem URL ayarı
* Gemini Gem sekme otomasyonu ve görünür sekme yedeği
* Gemini API veya bir OpenAI uyumlu API
* API anahtarını yerel saklama
* Kısa, standart ve ayrıntılı özet
* Türkçe, İngilizce ve çift dil
* Beş ana fikir
* Tam transkript
* Transkript arama
* Tıklanabilir zaman damgaları
* Kelime ve cümle kaydetme
* Basit flashcard
* Basit test soruları
* Video soru-cevap
* TXT, Markdown ve SRT dışa aktarma
* Son kullanılan videolar
* Yerel veri silme

## Sonraki sürüme bırakılmalı

* Altyazısız videodan ses transkripsiyonu
* Shorts
* Canlı yayın
* Oynatma listesi toplu işleme
* Kanal otomatik takibi
* Gelişmiş aralıklı tekrar
* Anlamsal transkript araması
* Bulut senkronizasyonu
* Mobil destek
* Kullanıcı hesabı
* Ticari abonelik
* Otomatik haber veya kanal bülteni

---

# 25. Son ürün önerisi

Eklentinin kullanıcıya sunduğu üç buton şu şekilde olmalıdır:

### Gemini Gem

Mevcut özel Gem talimatını kullanır. Arka planda pasif sekmede çalışmayı dener; başarısız olursa Gemini sekmesini açar.

### API

En güvenilir yöntem. Seçilen API ve model üzerinden doğrudan eklentide sonuç oluşturur.

### Yerel AI

Desteklenen bilgisayarlarda API anahtarı olmadan ve veri cihazdan çıkmadan çalışır. İngilizce için doğrudan, Türkçe için çeviri zinciri üzerinden kullanılabilir.

Önerilen varsayılan düzen:

```text
[Gemini Gem] [API] [Yerel AI]

Özet: [Kısa] [Standart] [Ayrıntılı]
Dil:  [Türkçe] [English] [İkisi]
```

Teknik güvenilirlik açısından **API modu varsayılan**, Gem modu deneysel alternatif, Chrome Yerel AI ise gizlilik ve kota yedeği olmalıdır.

Bu mimari ilk aşamada kişisel ve sunucusuz çalışabilir. İleride ticari ürüne dönüştürülmek istenirse transkript, kullanıcı arayüzü ve özetleme sağlayıcısı katmanları değiştirilmeden; yalnızca hesap, sunucu, kota ve ödeme katmanları eklenebilir.
