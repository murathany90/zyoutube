# YouTube Transkript ve AI Özet Chrome Eklentisi — Geliştirme Promptu

Sen kıdemli bir Chrome Extension, TypeScript ve tarayıcı otomasyonu geliştiricisisin. Aşağıdaki gereksinimlere göre çalışan, güvenli, modüler ve ileride geliştirilebilir bir Chrome eklentisi oluştur.

Projeyi yalnızca prototip görünümünde bırakma. Gerçek YouTube video sayfalarında çalışabilen, Manifest V3 uyumlu, kurulabilir bir Chrome eklentisi üret.

Eksik veya belirsiz küçük ayrıntılarda makul teknik kararlar al ve bunları teslim raporunda açıkla. Temel ürün davranışını değiştirecek bir karar olmadıkça soru sorma.

---

# 1. Projenin amacı

Eklenti, YouTube videolarında erişilebilir olan manuel veya otomatik altyazıyı çıkaracak, temizleyecek, zaman damgalarıyla saklayacak ve seçilen yapay zekâ yöntemiyle özetleyecek.

Eklentinin temel görevleri:

1. YouTube video sayfasından transkript çıkarmak
2. Manuel ve otomatik altyazıyı ayırt etmek
3. Transkript kalitesini değerlendirmek
4. Transkripti Gemini Gem, haricî API veya Chrome yerleşik AI ile özetlemek
5. Özeti doğrudan YouTube video sayfasında göstermek
6. Video hakkında transkript tabanlı soru-cevap yapmak
7. İngilizce öğrenmek için kelime, cümle, flashcard ve test alanı sunmak
8. Özet ve transkriptleri yerel olarak saklamak
9. TXT, Markdown ve SRT dışa aktarmak

İlk aşamada eklenti yalnızca kişisel kullanım içindir. Sunucu, kullanıcı hesabı, ödeme sistemi veya abonelik altyapısı oluşturma.

---

# 2. Değiştirilemez arayüz kararı

## 2.1 Chrome Side Panel kullanma

Bu projede Chrome Side Panel API kullanılmayacak.

Özet, transkript, soru-cevap, ana fikirler ve İngilizce çalışma alanı Chrome’un yan panelinde gösterilmeyecek.

Ana çalışma alanı doğrudan YouTube sayfasının içine yerleştirilecek.

## 2.2 YouTube sayfasındaki özet düğmesi

YouTube video oynatıcısının altındaki aksiyon satırına, mevcut YouTube düğmeleriyle görsel olarak uyumlu bir düğme ekle.

Düğme metni:

* Türkçe arayüzde: `AI Özet`
* İngilizce arayüzde: `AI Summary`

Düğmede sade bir eklenti veya özet ikonu bulunabilir.

Butonun yeri mümkün olduğunca şu alanda olmalıdır:

* Video oynatıcısının altında
* Beğen, paylaş, indir veya benzeri video işlem düğmelerinin bulunduğu satırda
* YouTube’un mevcut düğmelerini bozmadan
* Sayfa düzenini kaydırmadan
* Küçük ekranlarda taşma oluşturmadan

YouTube DOM yapısındaki değişikliklere karşı tek bir kırılgan CSS sınıfına bağımlı olma. Birden fazla yerleşim stratejisi ve güvenli geri dönüş noktası kullan.

## 2.3 YouTube sayfasındaki ana panel

Kullanıcı `AI Özet` düğmesine bastığında, ana eklenti paneli düğmenin hemen altında açılmalı.

Panel:

* Video ana içerik sütununda bulunmalı
* Video oynatıcısının altında yer almalı
* Açıklama veya yorum bölümünden önce konumlandırılmalı
* YouTube’un sağ önerilen videolar sütununu kapatmamalı
* YouTube sayfasının doğal bir parçası gibi görünmeli
* Tekrar butona basıldığında kapanmalı
* Panel açık/kapalı durumu video bazında veya sekme bazında korunabilmeli

Özet panelini Chrome popup içine koyma.

Özet sonuçlarını ayrı sekmede göstermeyi varsayılan davranış yapma.

---

# 3. Chrome eklenti açılır penceresi

Chrome araç çubuğundaki eklenti ikonuna basıldığında açılan küçük popup yalnızca yönetim ve ayar işlemleri için kullanılacak.

Popup içinde video özeti, tam transkript veya uzun AI yanıtı gösterme.

Popup bölümleri:

1. Genel durum
2. Ayarlar
3. AI sağlayıcıları
4. Gemini Gem ayarları
5. API ayarları
6. Chrome Yerel AI durumu
7. Son kullanılan videolar
8. Kayıt ve veri yönetimi
9. Eklenti hakkında

Popup boyutu sade ve kullanışlı olsun. Gerekirse ayarlar için popup içinden ayrı bir options sayfası açılabilir.

## Popup ana ekranı

Şunları göster:

* Eklenti etkin/pasif durumu
* Geçerli sekmede YouTube videosu algılandı mı?
* Kullanılacak varsayılan AI yöntemi
* Seçili özet dili
* Seçili özet uzunluğu
* Son işlenen 3–5 video
* `YouTube panelini aç` düğmesi
* `Ayarlar` düğmesi
* `Geçmiş` düğmesi

`YouTube panelini aç` seçeneği geçerli sekmedeki YouTube sayfasına mesaj göndermeli ve sayfa içindeki paneli açmalıdır.

---

# 4. Teknoloji ve proje yapısı

Aşağıdaki temel teknolojileri kullan:

* Chrome Extensions Manifest V3
* TypeScript
* Modern modüler JavaScript
* HTML ve CSS
* Vite veya uygun bir extension build altyapısı
* IndexedDB
* `chrome.storage.local`
* `chrome.storage.session`
* Manifest V3 service worker
* Content scripts
* Popup
* Gerekiyorsa options sayfası

React kullanımı zorunlu değildir. Projenin boyutuna göre React, Preact veya sade TypeScript seçilebilir. Gereksiz framework yükü oluşturma.

Kod yapısını katmanlara ayır:

```text
src/
  background/
  content/
  popup/
  options/
  providers/
  transcript/
  storage/
  export/
  learning/
  shared/
  styles/
```

Önerilen sorumluluklar:

* `content`: YouTube algılama, düğme ve panel enjeksiyonu
* `background`: görev yönetimi, API çağrıları, sekmeler ve mesajlaşma
* `providers`: Gemini Gem, API ve Chrome Yerel AI sağlayıcıları
* `transcript`: altyazı bulma, ayrıştırma, temizleme ve kalite kontrolü
* `storage`: ayarlar, geçmiş, transkript ve öğrenme verileri
* `export`: TXT, Markdown ve SRT üretimi
* `learning`: kelime, cümle, flashcard ve test işlemleri
* `shared`: türler, mesaj protokolü, hata tipleri ve yardımcı işlevler

---

# 5. YouTube tek sayfa uygulaması desteği

YouTube bir SPA gibi çalıştığı için yalnızca ilk sayfa yüklemesine güvenme.

Şunları algıla:

* Yeni video açılması
* `videoId` değişmesi
* Oynatma listesinde sonraki videoya geçiş
* Tarayıcı geri/ileri işlemleri
* YouTube içi bağlantıyla sayfa değişimi
* Sayfa bileşenlerinin yeniden oluşturulması
* Düğmenin DOM’dan kaldırılması
* Panel açıkken videonun değişmesi

Her yeni videoda:

1. Yeni video kimliğini belirle
2. Eski videoya ait aktif işi kontrol et
3. YouTube düğmesini güvenli biçimde yeniden yerleştir
4. Önceki videonun özetini yeni videoda gösterme
5. Kayıtlı sonuç varsa kullanıcıya bildir
6. Otomatik transkript ayarı açıksa transkripti hazırla
7. Otomatik özet varsayılan olarak kapalı olsun

MutationObserver kullanırken sonsuz döngü veya gereksiz yüksek işlemci kullanımı oluşturma.

---

# 6. YouTube panelinin tasarımı

Panelin üst kısmında sabit bir başlık alanı bulunmalı.

## 6.1 Panel başlığı

Gösterilecek bilgiler:

* Eklenti adı
* Video başlığının kısaltılmış hâli
* Transkript durumu
* Altyazı dili
* Manuel/otomatik etiketi
* Altyazı kalite etiketi
* Yenile
* Paneli küçült
* Paneli kapat
* Ayarları aç

## 6.2 Ana işlem alanı

Panelin üst kısmında şu kontroller yer almalı:

### AI yöntemi

* `Gemini Gem`
* `API`
* `Yerel AI`

Gemini Gem deneysel olarak işaretlenebilir.

### Özet uzunluğu

* `Kısa`
* `Standart`
* `Ayrıntılı`

### Çıktı dili

* `Türkçe`
* `English`
* `Türkçe + English`

### İşlem düğmeleri

* `Özet Oluştur`
* `İptal`
* `Yeniden Oluştur`

İşlem sırasında ilerleme durumu göster:

1. Video algılanıyor
2. Altyazı aranıyor
3. Transkript hazırlanıyor
4. AI yanıtı bekleniyor
5. Sonuç işleniyor
6. Tamamlandı

## 6.3 Panel sekmeleri

Panel içinde şu sekmeleri oluştur:

1. Özet
2. Transkript
3. Ana Fikirler
4. Sor
5. Öğren
6. Dışa Aktar

Dar ekranlarda sekmeler kaydırılabilir veya açılır menüye dönüşebilir.

---

# 7. Transkript alma sistemi

İlk sürümde yalnızca YouTube üzerinde erişilebilir olan altyazıları kullan.

Altyazısız videolardan ses indirme veya ses transkripsiyonu yapma.

## 7.1 Altyazı öncelik sırası

1. Video üreticisinin yüklediği manuel altyazı
2. Videonun orijinal dilindeki otomatik altyazı
3. Kullanıcı tarafından seçilen manuel altyazı
4. Başka dildeki otomatik altyazı
5. Çevrilmiş altyazı

Kullanıcı birden fazla altyazı varsa panelden kaynak seçebilmeli.

## 7.2 Transkript veri modeli

Her transkript segmenti şu alanları içersin:

```text
id
startTimeMs
endTimeMs
text
cleanText
language
sourceType
sequence
```

`sourceType` değerleri:

* `manual`
* `automatic`
* `translated`
* `unknown`

## 7.3 Transkript temizleme

Aşağıdaki sorunları düzelt:

* Yinelenen satırlar
* Kayan otomatik altyazı tekrarları
* HTML entity karakterleri
* Gereksiz boşluklar
* Aynı cümlenin üst üste tekrar edilmesi
* Boş segmentler
* Geçersiz zaman değerleri
* Çok kısa anlamsız parçalar
* `[Music]`, `[Applause]` gibi ses etiketleri

Özgün transkript ile temizlenmiş transkripti gerektiğinde ayrı tut.

## 7.4 Altyazı bulunamadığında

Panelde açık bir hata göster:

`Bu videoda erişilebilir manuel veya otomatik altyazı bulunamadı.`

Kullanıcıya şu seçenekleri sun:

* Tekrar dene
* YouTube transkript panelini aç
* Başka altyazı dili seç
* Sayfayı yenile

Bu durumda AI özet butonlarını devre dışı bırak.

---

# 8. Manuel ve otomatik altyazı ayrımı

Panelde transkript kaynağını görünür biçimde göster.

Etiketler:

* `Manuel altyazı`
* `Otomatik altyazı`
* `Çevrilmiş altyazı`
* `Kaynak bilinmiyor`

Otomatik altyazıda şu uyarıyı göster:

`Otomatik altyazı kullanılıyor. Özel isimler, sayılar ve teknik terimler hatalı olabilir.`

Manuel altyazıya otomatik olarak yüzde 100 doğru etiketi verme.

---

# 9. Altyazı kalite değerlendirmesi

Kesin doğruluk yüzdesi üretme. Açıklanabilir bir kalite seviyesi üret:

* Yüksek
* Orta
* Düşük

Değerlendirmede şunları kullan:

* Manuel veya otomatik kaynak olması
* Segmentlerin zaman sırası
* Büyük zaman boşlukları
* Boş segment oranı
* Aşırı tekrar oranı
* Anlamsız karakter oranı
* Çok kısa transkript
* Video süresine göre kapsama
* Belirsiz ses etiketleri
* Dil uyumsuzluğu

Kalite kartında gerekçeyi göster.

Örnek:

```text
Kalite: Orta
Neden: Otomatik altyazı kullanıldı ve bazı uzun zaman boşlukları tespit edildi.
```

---

# 10. AI sağlayıcı mimarisi

Tüm AI sağlayıcıları ortak bir arayüz üzerinden çalışmalı.

Kavramsal sağlayıcı arayüzü:

```text
isAvailable()
validateSettings()
summarize()
askQuestion()
generateLearningMaterial()
cancel()
```

Sağlayıcılar:

1. Gemini Gem
2. Haricî API
3. Chrome Yerel AI

UI katmanı hangi sağlayıcının kullanıldığını bilmek zorunda kalmamalı. Sağlayıcılar ortak sonuç formatı döndürmeli.

---

# 11. Gemini Gem yöntemi

## 11.1 Ayarlar

Popup veya options sayfasında şu alanlar olsun:

* Gemini Gem URL
* URL’yi test et
* Gem sekmesini arka planda aç
* Mevcut Gemini sekmesini yeniden kullan
* Başarısızsa görünür sekmede aç
* İşlem bitince sekmeyi kapat
* Maksimum gönderilecek transkript uzunluğu
* Uzun transkriptte otomatik API’ye geç
* Gem için ek kullanıcı talimatı

Örnek URL kullanıcı tarafından değiştirilebilir olmalı:

```text
https://gemini.google.com/gem/...
```

URL’yi kod içine sabitleme.

## 11.2 Çalışma akışı

Kullanıcı `Gemini Gem` seçip özet oluşturduğunda:

1. Transkript hazırla
2. Video başlığı, kanal, URL, dil ve transkript kaynağını ekle
3. Çıktı dili ve özet uzunluğu talimatını ekle
4. Ayarlardaki Gem URL’sini aç
5. Önce pasif bir sekmede otomasyonu dene
6. Gemini giriş alanını bul
7. İçeriği yerleştir
8. Mesajı gönder
9. Cevabın tamamlanmasını bekle
10. Sonucu eklentiye geri aktar
11. YouTube sayfasındaki panelde göster
12. Geçmişe kaydet

## 11.3 Geri dönüş davranışı

Arka plan otomasyonu başarısızsa:

1. Gemini sekmesini aktif hâle getir
2. Gem sayfasını aç
3. Transkripti giriş alanına yerleştirmeyi dene
4. Kullanıcıya işlemin Gemini sekmesinde devam ettiğini bildir

Tam otomasyon mümkün değilse:

* Hazırlanan metni panoya kopyala
* Gem sekmesini aç
* Kullanıcıya yapıştırma talimatı göster

Gem modu `Deneysel` etiketi taşımalı.

## 11.4 Güvenlik ve dayanıklılık

* CAPTCHA atlatmaya çalışma
* Google oturum açma ekranını otomatik geçmeye çalışma
* Kullanıcının şifresine erişme
* Google çerezlerini dışarı aktarma
* Aşırı hızlı veya sürekli otomasyon yapma
* Gemini DOM seçicilerini tek bir sınıfa bağlama
* Yanıt tamamlanmadan sonucu alma
* Önceki Gemini yanıtını yeni yanıt sanma

Gemini otomasyonu başarısız olduğunda API yöntemine geçiş öner.

---

# 12. Haricî API yöntemi

## 12.1 Desteklenen yapı

Hazır sağlayıcı profilleri oluştur:

* Gemini API
* DeepSeek
* NVIDIA API
* OpenAI uyumlu özel servis
* Özel REST API

Ücretsiz kota veya modelleri kod içine kesin ve kalıcı bilgi olarak yazma. Kullanıcı API adresini ve model adını değiştirebilmeli.

## 12.2 Ayarlar

* Sağlayıcı adı
* API base URL
* API anahtarı
* Model adı
* Bağlantıyı test et
* İstek zaman aşımı
* Maksimum çıktı uzunluğu
* Temperature
* Sistem talimatı
* Özel header alanları
* Akışlı yanıt kullan
* Varsayılan sağlayıcı yap
* Kalıcı veya oturumluk anahtar saklama

API anahtarını hiçbir zaman:

* YouTube sayfasının DOM’una
* Page context’e
* Log kayıtlarına
* Hata mesajına
* Dışa aktarılan ayar dosyasına

yazma.

API çağrısını content script üzerinden yapma. Service worker veya güvenli extension context üzerinden yap.

## 12.3 API anahtarı saklama

İki seçenek sun:

* Kalıcı olarak bu Chrome profilinde sakla
* Yalnızca Chrome oturumu boyunca sakla

Kalıcı ayarlar `chrome.storage.local`, oturumluk bilgiler `chrome.storage.session` içinde tutulabilir.

Popup içinde API anahtarını maskeli göster.

Şu işlemler olsun:

* Göster/gizle
* Değiştir
* Test et
* Sil

---

# 13. Chrome Yerel AI yöntemi

Chrome yerleşik AI API’lerini doğrudan var kabul etme. Her özellik için çalışma zamanında destek kontrolü yap.

Desteklenebilecek yetenekler:

* Summarizer
* Prompt
* Translator
* Language Detector

Panelde durum göster:

* Destekleniyor
* Desteklenmiyor
* Model indirilmesi gerekiyor
* Model indiriliyor
* Hazır
* Donanım yetersiz
* Tarayıcı sürümü yetersiz

Türkçe doğrudan desteklenmiyorsa isteğe bağlı işlem hattı:

```text
Türkçe transkript
→ İngilizceye yerel çeviri
→ İngilizce özetleme
→ Türkçeye yerel çeviri
```

Bu yöntem deneysel olarak işaretlensin.

Yerel AI desteklenmiyorsa eklenti çökmemeli; Gemini Gem veya API önerilmeli.

---

# 14. AI’ya gönderilecek veri

Özetleme isteğine şu meta verileri ekle:

* Video başlığı
* Kanal adı
* Video URL
* Video ID
* Video süresi
* Transkript dili
* Transkript kaynağı
* Altyazı kalite seviyesi
* İstenen özet uzunluğu
* İstenen çıktı dili
* Zaman damgalı temiz transkript

Modelden yalnızca verilen transkripte dayanmasını iste.

Model talimatları:

* Transkriptte olmayan bilgi üretme
* Bilgi bulunmuyorsa açıkça belirt
* Zaman damgalarını koru
* Özel isimleri gereksiz yere değiştirme
* Tahmin ile videoda söylenen bilgiyi ayır
* Otomatik altyazı hatası olabilecek noktaları kesin gerçek gibi sunma

---

# 15. Ortak AI sonuç şeması

Tüm sağlayıcıların sonucu mümkün olduğunca ortak, yapılandırılmış bir formata dönüştürülsün.

Sonuç şu bölümleri desteklesin:

```text
summary
shortSummary
detailedSummary
keyIdeas[]
sections[]
actionItems[]
importantTerms[]
quotes[]
warnings[]
language
provider
model
createdAt
```

Ana fikir yapısı:

```text
title
description
startTimeMs
endTimeMs
```

Bölüm yapısı:

```text
title
summary
startTimeMs
endTimeMs
```

AI geçerli yapılandırılmış sonuç döndürmezse düz metni güvenli şekilde gösterecek yedek ayrıştırma uygula.

---

# 16. Özet sekmesi

Özet sekmesinde şu bölümler bulunmalı:

1. Genel özet
2. Beş ana fikir
3. Bölüm bazlı özet
4. Eylem maddeleri
5. Önemli kavramlar
6. Altyazı kalite uyarısı
7. Kullanılan AI yöntemi ve model
8. Oluşturulma tarihi

## Kısa özet

* 3–5 cümle
* Videonun amacı
* Temel sonuç
* Çok az teknik ayrıntı

## Standart özet

* Genel özet
* Beş ana fikir
* Bölümler
* Önemli sonuçlar
* Tıklanabilir zaman damgaları

## Ayrıntılı özet

* Geniş kapsamlı açıklama
* Tüm önemli bölümler
* Ana fikirler
* Örnekler
* Kavramlar
* Eylem maddeleri
* Önemli alıntılar
* Belirsiz noktalar
* Zaman damgalı referanslar

---

# 17. Türkçe ve İngilizce görünüm

Arayüz tamamen Türkçe ve İngilizce desteklemeli.

Tüm sabit metinler merkezi bir i18n yapısından gelmeli. UI içine dağınık metin sabitleme.

Arayüz dili:

* Türkçe
* English
* Sistem dili

Özet dili:

* Türkçe
* English
* Türkçe + English

Transkript görünümü:

* Orijinal
* Türkçe çeviri
* İngilizce çeviri
* Orijinal + çeviri

Çift dil seçildiğinde dar panelde içerikleri alt alta göster. Yeterli genişlikte yan yana görünüm kullanılabilir.

---

# 18. Beş ana fikir

Her ana fikir kartında:

* Sıra numarası
* Kısa başlık
* Kısa açıklama
* Zaman damgası
* `Videoda aç` düğmesi

bulunsun.

Zaman damgası tıklandığında:

1. YouTube videosu ilgili saniyeye gelsin
2. Video paneli açık kalsın
3. İlgili transkript satırı vurgulansın
4. Kullanıcı ayarına göre video oynatılsın veya duraklatılmış kalsın

---

# 19. Tam transkript sekmesi

Transkript sekmesinde:

* Tam transkript
* Zaman damgaları
* Arama alanı
* Dil filtresi
* Kaynak bilgisi
* Kalite uyarısı
* Kopyala
* Dışa aktar
* Zaman damgalarını göster/gizle
* Satır aralığı seçimi

bulunsun.

Uzun transkriptlerde performans sorununu önlemek için sanal listeleme veya bölümlü render kullan.

---

# 20. Transkript içinde arama

Arama tamamen yerel çalışmalı ve AI çağrısı yapmamalı.

Destekle:

* Kelime arama
* Tam ifade arama
* Büyük/küçük harf duyarlılığı
* Orijinal transkriptte arama
* Çeviride arama
* Eşleşmeler arasında ileri/geri geçiş

Her sonuçta:

* Eşleşen metin
* Kısa bağlam
* Zaman damgası
* Videoda aç
* Kelime ekle
* Cümle ekle

bulunsun.

---

# 21. Kelime ve cümle ekleme

Kullanıcı transkript metninden kelime veya cümle seçebilsin.

Seçim sonrasında bağlamsal menü aç:

* Kelimelere ekle
* Cümlelere ekle
* Türkçeye çevir
* İngilizceye çevir
* Açıkla
* Flashcard oluştur
* Not ekle
* Videoda aç

## Kelime kaydı

* Kelime
* Temel biçim
* Türkçe anlam
* İngilizce açıklama
* Özgün cümle
* Zaman damgası
* Video ID
* Video başlığı
* Kullanıcı notu
* Etiketler
* Öğrenme durumu
* Eklenme tarihi

## Cümle kaydı

* Özgün cümle
* Türkçe karşılık
* İngilizce açıklama
* Dil bilgisi notu
* Zaman damgası
* Video bilgisi
* Kullanıcı notu
* Etiketler

Kullanıcı Öğren sekmesinden manuel kelime ve cümle de ekleyebilsin.

---

# 22. İngilizce öğrenme alanı

`Öğren` sekmesinde şu alt bölümler olsun:

1. Video kelimeleri
2. Kaydedilen kelimeler
3. Kaydedilen cümleler
4. Flashcard
5. Test

## Video kelimeleri

AI üzerinden şu içerikler oluşturulabilsin:

* Önemli kelimeler
* Deyimler
* Kalıplar
* Teknik terimler
* İleri seviye ifadeler
* Özgün örnek cümle
* Türkçe anlam
* İngilizce açıklama
* Zaman damgası

Kullanıcı hangi kelimelerin kaydedileceğini seçsin.

## Flashcard

Ön yüz:

* İngilizce kelime veya cümle
* İsteğe bağlı boşluk doldurma
* Videoda dinle

Arka yüz:

* Türkçe karşılık
* İngilizce açıklama
* Özgün kullanım
* Zaman damgası
* Kullanıcı notu

Değerlendirmeler:

* Bilmiyorum
* Zor
* Hatırladım
* Kolay

İlk sürümde basit tekrar mantığı yeterlidir.

## Test

Test türleri:

* Çoktan seçmeli
* İngilizce–Türkçe eşleştirme
* Boşluk doldurma
* Doğru/yanlış
* Cümle sıralama
* Video içeriğini anlama
* Kısa cevap

Yanlış cevap sonrasında:

* Doğru cevap
* Açıklama
* Kaynak cümle
* Zaman damgası
* Videoda aç

göster.

---

# 23. Video hakkında soru-cevap

`Sor` sekmesinde kullanıcı video hakkında soru sorabilsin.

Örnek öneri butonları:

* Bu videonun ana sonucu nedir?
* Konuşmacının önerdiği adımlar nelerdir?
* Bu konu hangi dakikada anlatılıyor?
* Teknik terimleri açıkla.
* Beş test sorusu oluştur.
* Videodaki tartışmalı noktalar nelerdir?

Yanıt kuralları:

* Yalnızca transkripte dayan
* Bilgi yoksa bunu belirt
* İlgili zaman damgalarını göster
* Kaynak transkript parçalarını belirt
* Transkript kalitesi düşükse uyarı ekle
* Kullanıcının seçtiği dilde yanıt ver

İlk sürümde basit ilgili bölüm bulma kullanılabilir:

1. Sorudaki önemli kelimeleri çıkar
2. Transkriptte ilgili bölümleri bul
3. İlgili parçaları AI’ya gönder
4. Zaman damgalı yanıt üret

Her soruda bütün transkripti tekrar gönderme.

---

# 24. Dışa aktarma

## TXT

Seçenekler:

* Yalnızca transkript
* Yalnızca özet
* Özet + transkript
* Kelimeler
* Cümleler
* Soru-cevap geçmişi

## Markdown

Dosyada şu alanlar bulunabilsin:

* Video başlığı
* Kanal
* Video URL
* Video tarihi bulunabiliyorsa tarih
* Altyazı dili
* Altyazı kaynağı
* Kalite uyarısı
* Genel özet
* Beş ana fikir
* Bölüm özetleri
* Eylem maddeleri
* Kelimeler
* Tam transkript

Zaman damgalarını tıklanabilir YouTube bağlantısı hâline getir.

## SRT

SRT formatı:

* Sıra numarası
* Başlangıç zamanı
* Bitiş zamanı
* Metin

Seçenekler:

* Orijinal dil
* Türkçe çeviri
* İngilizce çeviri
* Çift dil

Çeviri yapılırken özgün zaman damgalarını koru.

---

# 25. Geçmiş sistemi

Her işlenen video için şu verileri sakla:

* Video ID
* Video URL
* Başlık
* Kanal
* Küçük resim URL’si
* Süre
* İşlem tarihi
* Son erişim tarihi
* Transkript dili
* Altyazı kaynağı
* Kalite seviyesi
* AI yöntemi
* Sağlayıcı
* Model
* Özet uzunluğu
* Özet dili
* Kaydedilen kelime sayısı
* Kaydedilen cümle sayısı
* Favori durumu

Popup veya options sayfasındaki geçmiş bölümünde:

* Arama
* Tarihe göre sıralama
* Kanala göre filtreleme
* AI yöntemine göre filtreleme
* Manuel/otomatik altyazı filtresi
* Favoriler
* YouTube’da aç
* Özeti sayfada aç
* Yeniden özetle
* Dışa aktar
* Sil

işlemleri bulunmalı.

Özeti popup içinde uzun metin olarak gösterme. `Özeti aç` seçeneği ilgili YouTube videosunu açmalı ve sayfa içindeki eklenti panelini göstermeli.

---

# 26. Yerel veri saklama

## `chrome.storage.local`

Burada sakla:

* Genel ayarlar
* Arayüz dili
* Varsayılan sağlayıcı
* Gem URL
* API bağlantı ayarları
* Görünüm tercihleri
* Geçmiş saklama ayarı

## `chrome.storage.session`

Burada saklanabilir:

* Oturumluk API anahtarı
* Aktif işlem durumu
* Geçici sekme ilişkileri
* Geçici Gemini otomasyon bilgileri

## IndexedDB

Burada sakla:

* Uzun transkriptler
* Özetler
* Video geçmişi
* Sorular ve yanıtlar
* Kelimeler
* Cümleler
* Flashcard verileri
* Test sonuçları

IndexedDB için sürümleme ve migration yapısı oluştur.

---

# 27. Önbellek sistemi

Aynı video aynı ayarlarla tekrar işlendiğinde gereksiz API çağrısı yapma.

Önbellek anahtarı aşağıdakileri içersin:

* Video ID
* Transkript içeriğinin hash değeri
* Transkript dili
* Özet uzunluğu
* Çıktı dili
* Sağlayıcı
* Model
* Prompt profili

Kullanıcıya şu seçenekleri sun:

* Kayıtlı sonucu göster
* Yeniden oluştur
* Farklı modelle oluştur
* Önbelleği sil

---

# 28. Eş zamanlı işlem ve video değişimi

Her AI görevi benzersiz bir işlem kimliği taşımalı.

Görevle birlikte sakla:

* Task ID
* Video ID
* Sekme ID
* Başlangıç zamanı
* Sağlayıcı
* Durum
* İptal bilgisi

Kullanıcı özet hazırlanırken başka videoya geçerse:

* Eski sonuç yeni videoda gösterilmemeli
* Sonuç eski videonun geçmişine kaydedilmeli
* Kullanıcıya küçük bir bildirim gösterilmeli
* Yeni video paneli eski görev tarafından değiştirilmemeli

İptal işlemi gerçek anlamda çalışmalı. Mümkün olan API isteklerinde `AbortController` benzeri iptal mekanizması kullan.

---

# 29. Hata yönetimi

Tanımlı hata tipleri oluştur:

* Video bulunamadı
* Altyazı bulunamadı
* Altyazı alınamadı
* Gemini oturumu gerekli
* Gem URL geçersiz
* Gemini alanı bulunamadı
* Gemini yanıtı alınamadı
* API anahtarı geçersiz
* API kotası doldu
* Model bulunamadı
* İstek zaman aşımına uğradı
* Transkript çok uzun
* Yerel AI desteklenmiyor
* Yerel model hazır değil
* Çeviri başarısız
* Video işlem sırasında değişti
* İşlem iptal edildi
* Yerel veri kaydedilemedi
* Dışa aktarma başarısız

Her hata için kullanıcıya uygun seçenek göster:

* Tekrar dene
* Başka yöntem kullan
* Ayarları aç
* Gemini sekmesinde devam et
* Transkripti kopyala
* Hata ayrıntısını göster

API anahtarı veya hassas veri hata ayrıntılarına girmemeli.

---

# 30. Tasarım ve kullanılabilirlik

YouTube sayfasına eklenen panel:

* YouTube açık ve koyu temasıyla uyumlu olmalı
* YouTube font ve boşluk düzenine yakın görünmeli
* Ancak eklenti olduğu anlaşılmalı
* YouTube butonlarının tıklanmasını engellememeli
* Sabit genişlik nedeniyle taşma oluşturmamalı
* Mobil tarayıcı hedeflenmese bile dar pencereye uyum sağlamalı
* Uzun metinlerde kontrollü kaydırma kullanmalı
* Ana panel sayfayı gereksiz yere aşırı uzatmamalı
* Bölümler gerektiğinde açılır/kapanır olmalı

Panel durumları:

* Kapalı
* Küçültülmüş
* Açık
* Yükleniyor
* Hata
* Sonuç hazır

Erişilebilirlik:

* Klavye ile gezinme
* Uygun ARIA etiketleri
* Görünür odak durumu
* Yeterli kontrast
* Sadece renge bağlı durum gösterimi yapmama

---

# 31. Güvenlik

* Gereksiz Chrome izinleri isteme
* Mümkün olan en dar `host_permissions` kullan
* API anahtarını page context’e verme
* YouTube DOM’una gizli veri yazma
* Gemini veya API yanıtlarını HTML olarak doğrudan enjekte etme
* Tüm model çıktılarını güvenli metin veya sanitize edilmiş Markdown olarak render et
* `eval` kullanma
* Uzaktan JavaScript çalıştırma
* Uzaktan indirilen kodu execute etme
* API anahtarını loglama
* Çerez veya kullanıcı hesabı bilgisi toplama
* Kullanıcının Google kimlik bilgilerine erişmeye çalışma

Kişisel kullanım olsa da açık bir gizlilik notu ekle:

* Verilerin nerede saklandığı
* Hangi sağlayıcıya gönderildiği
* Yerel AI kullanıldığında cihazdan çıkmadığı
* Geçmişin nasıl silineceği

---

# 32. Manifest izinleri

İzinleri minimumda tut ve neden gerektiğini README içinde açıkla.

Muhtemel izinler:

* `storage`
* `tabs`
* `scripting`
* `activeTab`
* Gerekliyse `downloads`
* Gerekliyse `clipboardWrite`

Host izinlerini yalnızca gereken alanlarla sınırla:

* YouTube
* Gemini
* Kullanıcının etkinleştirdiği API sağlayıcıları

Özel API URL’leri için kullanıcıdan izin isteme veya uygun optional host permission yaklaşımı değerlendir.

---

# 33. İlk sürüm kapsamı

## Mutlaka tamamlanacak

* Manifest V3
* TypeScript
* YouTube SPA algılama
* Video altındaki `AI Özet` düğmesi
* Düğmenin altında açılan YouTube içi panel
* Popup içinde yalnızca ayarlar ve yönetim
* Manuel/otomatik altyazı ayrımı
* Altyazı kalite uyarısı
* Tam transkript
* Transkript arama
* Tıklanabilir zaman damgaları
* Gemini Gem yöntemi ve görünür sekme yedeği
* En az bir gerçek API sağlayıcısı
* OpenAI uyumlu özel API profili
* API anahtarını yerel veya oturumluk saklama
* Chrome Yerel AI destek kontrolü
* Kısa, standart ve ayrıntılı özet
* Türkçe, İngilizce ve çift dil
* Beş ana fikir
* Video soru-cevap
* Kelime ve cümle ekleme
* Flashcard
* Temel test soruları
* TXT, Markdown ve SRT export
* Video geçmişi
* Yerel kayıtları silme
* Açık/koyu tema uyumu
* İşlem iptali
* Video değişiminde eski sonuç koruması

## İlk sürüme ekleme

* Altyazısız videodan ses transkripsiyonu
* Ses veya video indirme
* Canlı yayın transkripsiyonu
* Shorts desteği
* Oynatma listesi toplu özetleme
* Kanal otomatik takibi
* Kullanıcı hesabı
* Bulut veritabanı
* Ödeme sistemi
* Ticari abonelik
* Mobil uygulama
* Gelişmiş aralıklı tekrar algoritması

---

# 34. Test gereksinimleri

En az aşağıdaki testleri oluştur.

## Birim testleri

* Transkript temizleme
* Tekrar eden altyazı birleştirme
* SRT üretimi
* Markdown üretimi
* Zaman formatlama
* Video URL ve timestamp üretimi
* Altyazı kalite değerlendirmesi
* Önbellek anahtarı
* AI sonuç ayrıştırma
* Çift dil veri yapısı

## Entegrasyon testleri

* Content script ile service worker mesajlaşması
* API sağlayıcı seçimi
* API iptali
* Depolama işlemleri
* Geçmiş kaydı
* Video değişiminde görev izolasyonu
* Popup ayarlarının YouTube paneline aktarılması

## Playwright veya eşdeğer tarayıcı testleri

* YouTube benzeri test sayfasında buton enjeksiyonu
* Butona basınca panelin açılması
* Tekrar basınca kapanması
* Panelin düğmenin altında bulunması
* Popup içinde özet gösterilmemesi
* Transkript sekmesinin çalışması
* Arama sonucundan timestamp tıklanması
* Video değişiminde panelin güncellenmesi
* Eski AI sonucunun yeni videoya yazılmaması
* Açık ve koyu tema
* Dar pencere görünümü

Gerçek YouTube üzerinde otomatik testler kırılgan olabileceği için mümkün olduğunca yerel fixture sayfaları oluştur; ayrıca manuel gerçek YouTube test kontrol listesi hazırla.

---

# 35. Kabul kriterleri

Proje aşağıdaki şartlar sağlanmadan tamamlanmış sayılmayacak:

1. Eklenti unpacked olarak Chrome’a kurulabiliyor.
2. YouTube video sayfasında `AI Özet` düğmesi görünüyor.
3. Düğme YouTube video aksiyon alanında yer alıyor.
4. Düğmeye basıldığında özet paneli YouTube sayfasında düğmenin altında açılıyor.
5. Özet paneli Chrome popup içinde gösterilmiyor.
6. Chrome popup yalnızca ayar, sağlayıcı, geçmiş ve veri yönetimi içeriyor.
7. Video değiştirildiğinde eklenti doğru videoyu algılıyor.
8. Manuel ve otomatik altyazı ayrımı gösteriliyor.
9. Transkript tamamen görüntülenebiliyor.
10. Transkriptte arama yapılabiliyor.
11. Timestamp tıklaması videoyu doğru saniyeye götürüyor.
12. Kısa, standart ve ayrıntılı özet çalışıyor.
13. Türkçe, İngilizce ve çift dil seçenekleri çalışıyor.
14. Beş ana fikir zaman damgalarıyla gösteriliyor.
15. Gemini Gem modu en azından görünür sekme yedeğiyle çalışıyor.
16. En az bir API sağlayıcısı gerçekten çalışıyor.
17. API anahtarı YouTube sayfasına sızmıyor.
18. Yerel AI destek kontrolü hata vermeden çalışıyor.
19. Video hakkında soru-cevap kullanılabiliyor.
20. Kelime ve cümle kaydedilebiliyor.
21. Flashcard ve temel test oluşturulabiliyor.
22. TXT, Markdown ve SRT indirilebiliyor.
23. Geçmiş verileri IndexedDB içinde saklanıyor.
24. Eski video sonucu yeni videoda gösterilmiyor.
25. Panel YouTube açık/koyu temasıyla uyumlu.
26. TypeScript ve build işlemleri hatasız tamamlanıyor.
27. Testler geçiyor.
28. README kurulum ve kullanım adımlarını açıklıyor.

---

# 36. Teslim edilecekler

Teslim sonunda şunları sağla:

1. Çalışan kaynak kod
2. Manifest V3 dosyası
3. Build komutları
4. Development komutları
5. Test komutları
6. Unpacked extension kurulum açıklaması
7. Dosya yapısı açıklaması
8. Kullanılan Chrome izinleri ve gerekçeleri
9. Gemini Gem yönteminin sınırlamaları
10. API anahtarı güvenlik açıklaması
11. Chrome Yerel AI destek açıklaması
12. Bilinen sorunlar
13. Sonraki geliştirme önerileri
14. Manuel test kontrol listesi
15. Örnek ayar ekran görüntüleri veya ekran kayıtları
16. Tamamlanan ve sonraya bırakılan özelliklerin listesi

---

# 37. Çalışma yöntemi

Projeyi aşağıdaki sırayla geliştir:

## Aşama 1

* Proje kurulumu
* Manifest V3
* YouTube video algılama
* `AI Özet` düğmesi
* YouTube içi panel
* Popup ayar ekranı

## Aşama 2

* Transkript çıkarma
* Manuel/otomatik ayrımı
* Temizleme
* Kalite değerlendirmesi
* Transkript arama
* Timestamp navigasyonu

## Aşama 3

* Sağlayıcı arayüzü
* API yöntemi
* Özet sonuç şeması
* Kısa, standart, ayrıntılı özet
* Türkçe/İngilizce

## Aşama 4

* Gemini Gem otomasyonu
* Pasif sekme denemesi
* Görünür sekme yedeği
* Panoya kopyalama yedeği

## Aşama 5

* Chrome Yerel AI algılama
* Yerel özetleme
* Yerel çeviri zinciri
* Desteklenmeyen cihaz davranışı

## Aşama 6

* Soru-cevap
* Kelime ve cümle kaydı
* Flashcard
* Testler

## Aşama 7

* IndexedDB geçmişi
* Önbellek
* TXT, Markdown ve SRT export
* Veri temizleme

## Aşama 8

* Testler
* Performans
* Güvenlik kontrolü
* README
* Son kabul kontrolü

Her aşamadan sonra çalışan durumu koru. Tek seferde büyük ve kontrolsüz bir kod yığını oluşturma.

---

# 38. Nihai davranış özeti

Kullanıcı bir YouTube videosu açtığında video altındaki aksiyon satırında `AI Özet` düğmesini görmelidir.

Düğmeye bastığında, düğmenin altında ve YouTube sayfasının ana içerik alanında eklenti paneli açılmalıdır.

Kullanıcı bu panelden:

* Transkripti almalı
* Özet yöntemini seçmeli
* Özet oluşturmalı
* Tam transkripti okumalı
* Transkriptte arama yapmalı
* Timestamp ile videoya gitmeli
* Video hakkında soru sormalı
* Kelime ve cümle kaydetmeli
* Flashcard çalışmalı
* Test çözmeli
* Dosya dışa aktarmalı

Chrome araç çubuğundaki eklenti ikonuna tıkladığında ise yalnızca:

* Genel ayarlar
* Gemini Gem URL’si
* API sağlayıcısı ve anahtarı
* Yerel AI durumu
* Dil ve varsayılan özet seçenekleri
* Geçmiş
* Saklama ve veri silme

alanlarını görmelidir.

Chrome popup hiçbir zaman ana özet okuma alanı olarak kullanılmamalıdır.
