# zYouTube Codex Proje Denetim Raporu

Denetim tarihi: 2026-07-28
Denetim kapsamı: Kaynak kod incelemesi, Git doğrulaması, typecheck, unit/provider/build, Playwright testleri ve güvenlik saklama modeli.
Kural: Bu aşamada kaynak kod değiştirilmedi; yalnızca bu rapor oluşturuldu.

## 1. Yönetici Özeti

Repo doğru görünüyor: `origin` adresi `https://github.com/murathany90/zyoutube.git`, aktif dal `main`, `HEAD`, `origin/main` ve GitHub `main` aynı committe: `87912c977fbbfcbb0743014c06382d3e08b1c594`.

Düzeltme API'si için son değişiklikler önemli parçaları iyileştirmiş: offscreen worker var, streaming SSE için `[DONE]` ve `finish_reason` kontrol ediliyor, normal JSON response yolu var, parser legacy alanları ve `from/to` formatını destekliyor, UI hata durumunda aktif taskId ile eski mesajları ayıklıyor. Ancak canlıda "zaman zaman çalışmıyor" şikayetini açıklayabilecek kritik riskler hala var:

- `CorrectionDB.set()` yazma hatasını yutuyor; UI kaydedildi sanıp başarıya geçebilir.
- Streaming yolda `reasoning_content` hiç toplanmıyor; reasoning-only veya content dışı delta akışları yanlış şekilde boş cevap/stream hatası olabilir.
- HTTP hata gövdesi önizlemesi diagnostics ve console'a taşınabiliyor; hassas response verisi sızma riski var.
- Düzeltme request gövdesi bazı provider'larla uyumsuz olabilecek varsayımlar içeriyor: `max_tokens`, `stream_options`, `response_format` ve streaming aynı anda zorlanıyor.
- Playwright extension/fixture/privacy testleri mevcut `dist` ile düşüyor; panel davranış testi geçiyor ama paket E2E ve privacy guard güvenilir değil.

Canlı API, gerçek YouTube düzeltme ve Gemini Web/Gem testleri bu aşamada çalıştırılmadı; sonraki aşamalar için API anahtarı ve oturum güvenli şekilde kullanıcı tarafından hazırlanmalı.

## 2. İncelenen Commit ve Git Durumu

Çalıştırılan komutlar ve sonuçlar:

| Komut | Sonuç |
| -- | -- |
| `git fetch origin --prune` | Başarılı |
| `git branch --show-current` | `main` |
| `git status --short` | Başlangıçta temiz |
| `git rev-parse HEAD` | `87912c977fbbfcbb0743014c06382d3e08b1c594` |
| `git rev-parse origin/main` | `87912c977fbbfcbb0743014c06382d3e08b1c594` |
| `git ls-remote origin refs/heads/main` | `87912c977fbbfcbb0743014c06382d3e08b1c594 refs/heads/main` |
| `git remote -v` | `origin https://github.com/murathany90/zyoutube.git` |

Son 20 committe görülen ek branchler:

- `backup/phase3-unreviewed` -> `9ea93b1`
- `rescue/correction-uncommitted` -> `590ba44`

`dist/` `.gitignore` içinde. Denetim sırasında `Remove-Item -Recurse -Force dist` ve `npm run build` sonrası çalışma dizini yine temiz kaldı; kaynak ve rapor dışı tracked değişiklik oluşmadı.

## 3. Proje Mimarisi

Ana katmanlar:

1. YouTube content script: `src/content/index.tsx`, `src/content/TranscriptTab.tsx`, `src/content/components/SummaryTab.tsx`.
2. Transcript provider: `src/transcript/youtube-provider.ts`, `src/transcript/parser.ts`, `src/background/native-caption-broker.ts`, `src/background/message-router.ts`.
3. Background router: `src/background/index.ts`, `src/background/message-router.ts`, `src/background/offscreen-manager.ts`.
4. Offscreen API worker: `src/offscreen/api-worker.html`, `src/offscreen/api-worker.ts`.
5. AI provider ve prompt/parser: `src/ai/providers/openai-compatible-provider.ts`, `src/ai/prompt-correction.ts`, `src/ai/correction-parser.ts`, `src/ai/response-parser.ts`.
6. Kalıcı veri: `src/settings/history.ts`, `src/transcript/correction-db.ts`, `src/dictionary/dictionary-db.ts`, `src/history/library-service.ts`.
7. Gemini otomasyonu: `src/gem/controller.ts`, `src/gem/tab-manager.ts`, `src/content/gemini/gemini-content-script.ts`.

## 4. Düzeltme API'si Veri Akışı

1. Kullanıcı `TranscriptTab` içinde düzeltme başlatır.
2. `executeCorrection()` `correction_${Date.now()}` taskId üretir, mevcut segmentleri `{ id, startTimeMs, endTimeMs, turkish, english }` formatına map eder.
3. Content script `START_CORRECTION` mesajını background'a yollar.
4. `message-router.ts` `chrome.storage.session` altında `api_task_<taskId>` yazar, offscreen document oluşturur.
5. Background `API_CORRECTION_START` mesajını offscreen worker'a gönderir.
6. Offscreen worker `API_CORRECTION_ACCEPTED` döner, timeout/heartbeat kurar.
7. `CorrectionPromptBuilder.buildApiRequestBody()` system/user prompt ve request body oluşturur.
8. Worker `POST <baseUrl>/chat/completions` yapar.
9. `stream=true` ise SSE satırları `data:` üzerinden okunur; `[DONE]`, `finish_reason`, `delta.content` izlenir.
10. `stream=false` veya `response.body` yoksa normal JSON `choices[0].message.content` okunur.
11. `CorrectionResponseParser.parse()` JSON/code fence/balanced JSON çıkarır.
12. `enrichCorrectedSentences()` kaynak segment kapsamını, sıra ve tekrarları doğrular; eksik dil için kaynak fallback uygular.
13. Offscreen `API_CORRECTION_COMPLETED` veya `API_CORRECTION_FAILED` gönderir.
14. Background bunu `CORRECTION_COMPLETED` veya `CORRECTION_FAILED` olarak ilgili tab'a iletir.
15. `TranscriptTab` sonucu `CorrectionDB.set()` ile IndexedDB'ye yazar, `LIBRARY_ENTRY_UPDATED` mesajı yollar, UI'ı `both` moda geçirir.

## 5. Düzeltme API'si Kritik Bulguları

| ID | Önem | Dosya/Fonksiyon | Bulgular | Etki | Öneri | Test |
| -- | ---- | --------------- | -------- | ---- | ----- | ---- |
| CORR-001 | Yüksek | `src/transcript/correction-db.ts` / `CorrectionDB.set` | `set()` iç `catch` içinde hatayı sadece `console.warn` yapıp resolve ediyor. `TranscriptTab.tsx:246-278` bu promise'i başarılı kabul edip UI'ı tamamlandı moduna alıyor. | Düzeltme başarılı görünür ama geçmişe kaydolmayabilir; correction-only kayıt görünmeyebilir. | `set()` yazma hatasını reject etmeli; UI `catch` içinde kullanıcıya kayıt hatası göstermeli ve sonucu ekranda korumalı. | IndexedDB `put` hatası fixture'ı; `CORRECTION_COMPLETED` sonrası DB fail UI testi. |
| CORR-002 | Yüksek | `src/offscreen/api-worker.ts` / `processCorrectionSseLine` | Streaming parser sadece `choices[0].delta.content` topluyor. `reasoning_content` sadece non-stream yolda okunuyor. | Reasoning açık provider'larda final content dışındaki akışlar boş cevap veya stream hata olarak sınıflanabilir. | SSE'de `delta.reasoning_content` ayrı sayaçla izlenmeli; final content yoksa açık `CORRECTION_FINAL_CONTENT_MISSING` tanısı üretilmeli. | Streaming reasoning-only fixture; content+reasoning karışık fixture. |
| CORR-003 | Yüksek | `src/offscreen/api-worker.ts` / HTTP error diagnostics | 4xx/5xx response body ilk 500 karakteri `bodyPreview` olarak diagnostics'e taşınıyor ve `TranscriptTab` console.table ile gösterebiliyor. | Provider hata gövdesi transcript parçası, request echo veya hassas bilgi içerirse console/rapor sızıntısı olabilir. | Error body preview sanitize edilmeli veya sadece tip/kod/uzunluk/hash tutulmalı. Header ve key asla loglanmamalı. | 401/500 response içinde secret fixture; console ve diagnostics'te secret yok testi. |
| CORR-004 | Orta | `src/ai/prompt-correction.ts` / `buildApiRequestBody` | Düzeltme için varsayılan olarak `stream=true`, `stream_options`, `response_format=json_object` ve `max_tokens=130000` birlikte gönderiliyor. Bazı OpenAI-compatible provider'lar bu kombinasyonu veya `max_tokens` adını desteklemeyebilir. | "Zaman zaman API çalışmıyor" provider/model özelinde 400/422/500 olarak görülebilir. | Provider capability ayarı eklenmeli: `max_tokens`/`max_completion_tokens`, json mode, stream_options, streaming ayrı ayrı açılıp kapanabilmeli. | Request body snapshot testleri; provider uyumluluk fixture'ları. |
| CORR-005 | Orta | `src/offscreen/api-worker.ts` / timeout classify | Timeout `controller.abort(new Error('Timeout'))` ile tetikleniyor; browser/fetch bunu her zaman `message === 'Timeout'` olarak döndürmeyebilir. `AbortError` olursa iptal gibi sınıflanabilir. | Kullanıcı timeout yerine iptal mesajı görebilir; retryability yanlış olabilir. | Timeout için ayrı flag tutulmalı; abort reason ve elapsedMs birlikte normalize edilmeli. | Fake timer + abort reason testleri; timeout ve manuel cancel ayrımı. |
| CORR-006 | Orta | `src/ai/correction-parser.ts` / `enrichCorrectedSentences` | Hata mesajlarında `sentenceAny.index` kullanılıyor; parse edilen objelerde bu alan genelde yok, bu nedenle `NaN. cümle` üretilebilir. | Diagnostics anlaşılabilirliği bozulur. | Map sırasında `_index` veya `index` sabitlenmeli. | Eksik `tr`/`en` hata mesajında cümle numarası testi. |
| CORR-007 | Orta | `src/background/message-router.ts` / relay | `API_CORRECTION_COMPLETED/FAILED` geldiğinde önce `chrome.storage.session.remove` yapılıyor, sonra tab'a mesaj iletiliyor. Tab teslimi başarısızsa sonuç tekrar alınamıyor. | Service worker/content reload veya tab geçişinde başarılı API sonucu kaybolabilir. | Sonuç veya terminal durum kısa süre session'a yazılmalı; content reconnect `GET_ACTIVE_API_TASK` ile terminal sonucu alabilmeli. | Content reload sırasında completed/failed relay testi. |
| CORR-008 | Düşük | `src/offscreen/api-worker.ts` / stream usage | Streaming `stream_options.include_usage` isteniyor ama usage chunk'ları toplanmıyor. | Token/diagnostics eksik kalır. | Usage chunk'ı `data.usage` üzerinden toplanmalı. | Usage-only final SSE fixture. |

## 6. Diğer Bug Bulguları

| ID | Önem | Dosya/Fonksiyon | Bulgular | Etki | Öneri | Test |
| -- | ---- | --------------- | -------- | ---- | ----- | ---- |
| TEST-001 | Yüksek | `tests/e2e.spec.ts` | Fixture E2E düştü: `MOVIE_PLAYER_API_NOT_AVAILABLE`, transcript button yok, scraper fallback fail; beklenen metin görünmedi. | Production transcript path'i testte güvenilir temsil edilmiyor. | Fixture DOM'u native path'e uygun hale getir veya direct fetch path'i izole eden test kur. | `npm run test:fixture` yeşil olmalı. |
| TEST-002 | Yüksek | `tests/extension.spec.ts` | Popup başlığı ve virtual transcript testleri düştü. | Paket E2E regression gate kırık. | Popup load sebebi ve fixture transcript path'i ayrıştırılmalı. | `npm run test:extension` yeşil olmalı. |
| TEST-003 | Yüksek | `tests/privacy/privacy.spec.ts` | İlk koşuda service worker context kapanması; tekrar koşuda `ZYouTube Ayarları` selector timeout. | Privacy sızıntı testi şu an kanıt üretmiyor. | Extension popup açılışını stabilize et; privacy testi gerçek storage modelini kontrol etmeli. | `npm run test:privacy` yeşil olmalı. |
| TEST-004 | Orta | `src/offscreen/api-worker.test.ts` | Test config'inde `stream:false` kullanılıyor ama production builder `correctionStreaming !== false` okuyor. Non-stream test response.body yokluğu nedeniyle yanlışlıkla non-stream yola düşebilir. | Testler gerçek config sözleşmesini tam kanıtlamıyor. | Testlerde `correctionStreaming:false` kullanılmalı; body var/yok ayrımı açık yapılmalı. | Non-stream normal JSON fixture. |
| HIST-001 | Orta | `src/history/library-service.ts` | `getEntries()` servis hatalarını console'a basıp boş listeyle devam ediyor. Bu UI için toleranslı, ama veri kaybı gibi görünebilir. | Geçmiş ekranında eksik kayıt sessiz kalabilir. | UI'da kısmi veri uyarısı veya diagnostics göster. | HistoryService fail + CorrectionDB success entegrasyon testi. |
| GEM-001 | Orta | `src/content/gemini/gemini-content-script.ts` | Content script `GEMINI_PROGRESS` mesajı taskId olmadan background'a gönderiyor; UI asıl ilerlemeyi `GemController.onStatusChange` üzerinden alıyor. Canlıda karakter sayacı UI'a yansıyor mu kanıtlanmadı. | Gemini bekleme/progress UX'i yanıltıcı olabilir. | Progress mesajlarında taskId/videoId sözleşmesi netleştirilmeli veya gereksiz mesaj kaldırılmalı. | Gemini content script message contract testi. |
| UI-001 | Orta | `src/content/TranscriptTab.tsx` | Hata teknik detayları kullanıcı arayüzünde açılır alan olarak yok; ayrıntılar console'a gidiyor. | Kullanıcı neyi düzelteceğini anlayamayabilir. | UI'da güvenli, redakte edilmiş teknik detay paneli ekle. | 401/429/504 UI snapshot testi. |
| UI-002 | Düşük | `src/history/HistoryPage.tsx` | Birçok inline style ve sabit genişlik var; dar panel/mobil görünüm için sınırlı kanıt var. | Uzun başlık ve transkript arama alanı dar ekranda sıkışabilir. | CSS sınıflarıyla responsive düzen iyileştirilmeli. | 360px ve dark mode visual smoke. |

## 7. Test ve Build Sonuçları

| Komut | Sonuç | Not |
| -- | -- | -- |
| `Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue` | Başarılı | `dist/` ignored |
| `npm ci` | Başarılı | Dev dahil audit: 1 moderate, 1 high |
| `npm run typecheck` | Başarılı | `tsc --noEmit` geçti |
| `npm run test:unit` | Başarılı | 14 dosya, 90 test geçti |
| `npm run test:providers` | Başarılı | 1 dosya, 6 test geçti |
| `npm run build` | Başarılı | Vite build geçti; dynamic/static import chunk uyarısı var |
| `git diff --check` | Başarılı | Whitespace hatası yok |
| `npm run test:privacy` | Başarısız | Service worker/popup selector timeout |
| `npm run test:fixture` | Başarısız | Transcript fixture beklenen metni üretmedi |
| `npm run test:extension` | Başarısız | 2/2 test düştü |
| `npx playwright test tests/panel-behavior.spec.ts` | Başarılı | 7/7 geçti |
| `npm audit --omit=dev --audit-level=moderate` | Başarılı | Production dependency açığı yok |

Build uyarısı: `src/ai/registry.ts` hem dynamic import hem static import edildiği için Vite chunk ayrımı yapamıyor. Bu doğrudan fonksiyonel hata değil, ama offscreen/background chunk izolasyonu incelenmeli.

## 8. Test Kapsamı Eksikleri

| ID | Önem | Dosya/Fonksiyon | Bulgular | Etki | Öneri | Test |
| -- | ---- | --------------- | -------- | ---- | ----- | ---- |
| TEST-005 | Yüksek | Correction end-to-end | Offscreen -> background -> content -> CorrectionDB zinciri gerçek Chrome runtime içinde başarı/DB fail dahil test edilmiyor. | Unit testler helper seviyesinde kalabilir. | Extension-context correction harness kurulmalı. | Mock API server + unpacked extension correction E2E. |
| TEST-006 | Yüksek | Provider behavior | `[DONE]`, `finish_reason`, stream kesilmesi var; ancak provider uyumsuz request body kombinasyonları yok. | 400/422 gibi canlı hatalar kaçabilir. | Provider matrix fixture: OpenAI, DeepSeek, NVIDIA-like. | Body snapshot + fake server tests. |
| TEST-007 | Orta | Parser/prompt contract | Prompt `from/to/tr/en` istiyor; parser legacy alias ve `sourceSegmentIds` de kabul ediyor. Sözleşme geniş ama prompt-parser snapshotı yok. | Gelecek prompt değişikliği parser'ı bozabilir. | Prompt örnek output fixture'ları parser testine bağlanmalı. | Prompt schema regression tests. |
| TEST-008 | Orta | Security | Privacy testi çalışmıyor; API key DOM/console/storage iddiaları güncel kanıtlanmıyor. | Secret saklama sınırı belirsiz kalır. | Testi stabilize et, `chrome.storage.local/session` kapsamını açık ölç. | DOM/console/IndexedDB/local/session privacy tests. |
| TEST-009 | Orta | Gemini Web/Gem | Selector, baseline, completion ve tab close davranışı canlı veya fixture ile kanıtlanmamış. | Eski cevap yeni cevap sanılabilir veya sekme erken kapanabilir. | Gemini DOM fixture ve manuel canlı test planı. | Gem standard + Gem page selector tests. |

## 9. UI/UX Bulguları

| ID | Önem | Dosya/Fonksiyon | Bulgular | Etki | Öneri | Test |
| -- | ---- | --------------- | -------- | ---- | ----- | ---- |
| UI-003 | Orta | `TranscriptTab` correction error | Kullanıcıya kısa hata gösteriliyor; teknik ayrıntı console'da. | Kullanıcı 401/model/timeout ayrımını UI'da göremeyebilir. | Güvenli hata detayı açılır alanı, tekrar dene ve ayarlara git aksiyonu. | Error-state component test. |
| UI-004 | Orta | `TranscriptTab` correction progress | Progress 15 sn heartbeat temelli; uzun API çağrısında gerçek stream karakter sayısı yalnız 10 sn aralıkla gelebilir. | Uzun beklemede donmuş gibi algılanabilir. | Son event zamanı, elapsed ve karakter sayısını UI'da düzenli göster. | Fake stream progress test. |
| UI-005 | Orta | `SummaryTab` | Gemini progress karakter sayacı canlıda doğrulanmadı; timeout sonrası partial response kaydedilmiyor, bu doğru ama kullanıcıya ayrıntı sınırlı. | Gemini bekleme davranışı belirsiz. | Status ayrıntısını tek güvenilir mesaj sözleşmesine indir. | Gemini timeout/progress fixture. |
| UI-006 | Düşük | `WordDictionaryPopup` | Escape, dış tıklama ve X var; focus trap yok. | Klavye erişilebilirliği sınırlı. | Açılışta popup'a focus, kapanışta tetikleyiciye dönüş. | Keyboard a11y test. |
| UI-007 | Düşük | History | Correction-only kayıt auto-tab ile açılabiliyor görünüyor; canlı DB kayıt başarısına bağlı. | CORR-001 olursa kayıt hiç görünmez. | DB fail UI'sı ve reload sonrası doğrulama. | Correction-only history E2E. |

## 10. UI/UX Geliştirme Önerileri

1. Kritik kullanılabilirlik düzeltmeleri: Düzeltme hata kartı; kayıt hatası ayrımı; API ayarlarına git butonu; güvenli teknik detay paneli.
2. Kısa vadeli iyileştirmeler: Stream progress karakter sayacı; provider hata kodu metinleri; iptal/tekrar dene durumlarının disabled state doğrulaması; history dar ekran düzeni.
3. İleri seviye ürün geliştirmeleri: Düzeltme sonrası kalite uyarıları paneli; cümle coverage görselleştirme; provider test bağlantısı için güvenli diagnostics; Gemini Web/Gem selector health check.

## 11. Canlı Test Planı

Canlı test bu aşamada yapılmadı. Onay sonrası plan:

1. Kullanıcı API anahtarını eklenti ayarlarından veya destekleniyorsa güvenli local yöntemle ekler.
2. `npm run build` sonrası `dist/` unpacked extension olarak yüklenir.
3. Altyazılı gerçek YouTube videosu açılır.
4. TR ve EN transcript gelişi doğrulanır.
5. Düzeltme başlatılır; tek POST, stream event sayısı, `[DONE]`, `finish_reason`, response karakter sayısı güvenli diagnostics ile ölçülür.
6. Parser sonucu, cümle sırası, timestamp ve dolgu ses temizliği gözle kontrol edilir.
7. `CorrectionDB` kaydı ve correction-only history görünümü doğrulanır.
8. Hata senaryoları 401, 429, 5xx, timeout, stream kesilmesi ve eksik JSON ile tekrarlanır.

## 12. API Anahtarı Kurulum Seçenekleri

Mevcut kod `.env.local` üzerinden API key okumuyor. Ayarlar UI'ı API anahtarını `chrome.storage.local` içinde saklıyor; `isSessionStorage` açılırsa key `chrome.storage.session` içine ayrılıyor ve local settings içinde `apiKey` undefined bırakılıyor.

Güvenlik sınırları:

- Frontend/Vite bundle içine konan environment değişkenleri gerçek gizlilik sağlamaz; bundle kullanıcı tarafında okunabilir.
- Extension ayarlarına manuel API key girmek, key'i bu Chrome profilinin extension storage alanında tutar. Bu uzak sunucuya otomatik sızdırmaz, ancak cihaz/profil erişimi olan biri görebilir.
- Daha güvenli mimari: local/backend proxy, key'i tarayıcı eklentisi yerine yerel servis veya backend secret store içinde tutar.

`.gitignore` içinde `.env`, `.env.local` veya `.env.*` deseni yok. Şu an env desteği olmadığı için doğrudan risk oluşmuyor; env örneği eklenecekse önce `.gitignore` genişletilmeli.

## 13. Gemini Web ve Gemini Gem Test Planı

Canlı Gemini testi yapılmadı; kullanıcı oturumu gerekir.

Plan:

1. Kullanıcı Gemini hesabında oturum açar; cookie/token istenmez.
2. Standart Gemini Web ve Gem URL ayrı ayrı açılır.
3. Content script ping, tek listener guard (`__ZYOUTUBE_GEMINI_AUTOMATION_LOADED__`), input selector ve send button selector doğrulanır.
4. Prompt öncesi baseline alınır; eski cevap yeni cevap sayılmamalı.
5. Streaming bitmeden completed dönmemeli; response 12 sn stabil kalmalı.
6. Kullanıcının önceden açık sekmesi kapanmamalı; sadece extension'ın açtığı sekme ayara göre kapanmalı.
7. Timeout halinde partial response kaydedilmemeli.
8. Gem selector farkları rapora eklenmeli, geniş selector refactor'u ayrıca onaylanmalı.

## 14. Önerilen Düzeltme Planı

Paket 1: Düzeltme API'si kritik çalışma hataları

- Değişecek dosyalar: `src/transcript/correction-db.ts`, `src/content/TranscriptTab.tsx`, `src/offscreen/api-worker.ts`, `src/ai/prompt-correction.ts`.
- Kabul kriterleri: DB yazma hatası başarı sayılmaz; SSE reasoning diagnostics doğru; provider request gövdesi uyarlanabilir.
- Test planı: Unit + offscreen worker stream fixtures + DB fail UI test + build.
- Risk: Orta; API davranışı kullanıcı ayarlarına bağlı.
- Tahmini karmaşıklık: Orta.

Paket 2: Hata tanılama ve kullanıcı mesajları

- Değişecek dosyalar: `src/offscreen/api-worker.ts`, `src/content/TranscriptTab.tsx`, `src/settings/validation.ts`.
- Kabul kriterleri: Secret/body preview redakte; UI güvenli teknik detay gösterir.
- Test planı: Secret fixture, 401/429/504 UI tests.
- Risk: Düşük-Orta.
- Tahmini karmaşıklık: Orta.

Paket 3: Parser/prompt sözleşmesi

- Değişecek dosyalar: `src/ai/prompt-correction.ts`, `src/ai/correction-parser.ts`, ilgili testler.
- Kabul kriterleri: `from/to/tr/en` ana sözleşmesi ve legacy alias testle korunur; cümle numarası diagnostics doğru.
- Test planı: Parser snapshots, prompt contract fixtures.
- Risk: Düşük.
- Tahmini karmaşıklık: Düşük-Orta.

Paket 4: UI ve loading/error durumları

- Değişecek dosyalar: `src/content/TranscriptTab.tsx`, `src/content/components/SummaryTab.tsx`, CSS.
- Kabul kriterleri: Orijinal transcript hata anında kalır; progress anlaşılır; tekrar dene/iptal tutarlı.
- Test planı: Component/Playwright visual smoke.
- Risk: Orta.
- Tahmini karmaşıklık: Orta.

Paket 5: History ve sözlük geliştirmeleri

- Değişecek dosyalar: `src/history/library-service.ts`, `src/history/HistoryPage.tsx`, `src/content/components/WordDictionaryPopup.tsx`.
- Kabul kriterleri: Correction-only kayıt reload sonrası açılır; sözlük popup klavye erişilebilirliği artar.
- Test planı: History helpers + Playwright detail page.
- Risk: Düşük-Orta.
- Tahmini karmaşıklık: Orta.

Paket 6: Gemini Web/Gem otomasyon testleri

- Değişecek dosyalar: `src/gem/controller.ts`, `src/content/gemini/gemini-content-script.ts`, tests.
- Kabul kriterleri: Baseline, completion, selector ve tab close davranışı fixture/canlı testle kanıtlanır.
- Test planı: Gemini DOM fixture + manuel canlı test raporu.
- Risk: Orta-Yüksek; Gemini DOM değişkendir.
- Tahmini karmaşıklık: Orta-Yüksek.

## 15. Değişmesi Önerilen Dosyalar

- `src/transcript/correction-db.ts`
- `src/content/TranscriptTab.tsx`
- `src/offscreen/api-worker.ts`
- `src/ai/prompt-correction.ts`
- `src/ai/correction-parser.ts`
- `src/settings/validation.ts`
- `tests/e2e.spec.ts`
- `tests/extension.spec.ts`
- `tests/privacy/privacy.spec.ts`
- `src/offscreen/api-worker.test.ts`
- Yeni veya güncel Playwright correction E2E testleri

## 16. Riskler ve Geri Dönüş Planı

Riskler:

- Provider uyumluluk ayarları yanlış varsayılırsa çalışan model bozulabilir.
- Streaming parser değişikliği tamamlanma kriterlerini gevşetirse yarım cevap başarı sayılabilir.
- DB error handling değişikliği daha fazla kullanıcıya hata gösterebilir; bu doğru ama UX etkisi vardır.
- Gemini selector değişiklikleri canlı DOM'a göre sık kırılabilir.

Geri dönüş planı:

1. Her paket ayrı branch/commit olmalı.
2. Her paket sonrası `npm run typecheck`, `npm run test:unit`, ilgili Playwright, `npm run build`, `git diff --check`.
3. Sorun çıkarsa ilgili paket commit'i revert edilir; main'e force-push/amend yapılmaz.

## 17. Kabul Kriterleri

- `npm run typecheck` geçer.
- `npm run test:unit` geçer.
- `npm run test:providers` geçer.
- `npm run build` geçer.
- `npm run test:privacy`, `npm run test:fixture`, `npm run test:extension` stabilize edilir veya açık gerekçeyle yeni güvenilir testle değiştirilir.
- Gerçek YouTube ortamında düzeltme API tek POST ile çalışır.
- `[DONE]` var/finish yok, finish var/`[DONE]` yok, normal JSON response senaryoları kapsanır.
- Hatalı API key/model/5xx/timeout/stream kesilmesi kullanıcıya anlaşılır ve güvenli gösterilir.
- Başarılı düzeltme `CorrectionDB` ve history listesine kaydolur.
- Hata halinde orijinal transcript kaybolmaz.
- API key, Authorization header, secret ve tam response console/DOM/rapora sızmaz.

## 18. Benden Beklenen Onaylar

1. Paket 1'i uygulamaya başlama onayı.
2. API anahtarını güvenli biçimde eklenti ayarlarından veya onaylanmış local/backend yöntemle sizin eklemeniz.
3. Gerçek YouTube canlı düzeltme testi için Chrome/YouTube oturum durumunun hazır olduğuna dair onay.
4. Gemini Web/Gem testi için Gemini oturumunun hazır olduğuna dair onay.
5. Her paketten sonra bir sonraki pakete geçme onayı.

CODEX_PROJECT_AUDIT.md raporunu hazırladım. Belirtilen düzeltme paketlerini uygulamaya başlamamı onaylıyor musunuz?
