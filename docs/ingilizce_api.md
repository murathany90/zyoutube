## Sonuç

**En sağlam çözüm, transcript panelinin dil menüsünü otomatikleştirmek veya PoToken üretmeye çalışmak değil; YouTube oynatıcısına hedef altyazıyı seçtirip oynatıcının kendi oluşturduğu gerçek `/api/timedtext` isteğini yakalamaktır.**

Bu isteği YouTube’un kendi player krum bilgisi, `tlang`, deney parametreleri ve varsa subtitle PoToken doğru biçimde yer alır. Eklenti URL’ye hiçbir parametre eklemez; yakalanan URL’yi aynen kullanır.

Önerdiğim sıra:

1. Gerçek İngilizce track varsa native player üzerinden onu yükle.
2. İngilizce track yoksa source track + `translationLanguage: en` ile player’a çeviri isteği yaptır.
3. Player’ın çıkardığı `/api/timedtext` URL’sini `chrome.webRequest` ile yakala.
4. URL’yi **hiç değiştirmeden** MAIN world içinde fetch et.
5. Bu da başarısızsa orijinal transkripti alıp kendi AI katmanınızda İngilizceye çevir.
6. Transcript paneli DOM scraper’ını yalnızca orijinal metin fallback’i olarak kullan.

---

## A) `baseUrl + &tlang=en` yöntemini kurtarmak mümkün mü?

Kısmen, fakat PoToken uygulanmış URL’lerde güvenilir değil.

`tlang` parametresinin kendisi geçersiz değildir. Güncel `youtube-transcript-api` de çeviri URL’sini hâlâ `baseUrl + "&tlang=..."` şeklinde oluşturuyor. Ancak aynı kütüphane URL’de `exp=xpe` varsa isteği yapmadan doğrudan `PoTokenRequired` hatası veriyor. Yani sorun çoğunlukla URL sıralamasından veya XML/JSON3 formatından değil, subtitle isteğine getirilen PoToken zorunluluğundan kaynaklanıyor. ([GitHub][1]) yt-dlp dokümantasyonu da `web` istemcisinde altyazılar için ayrı bir **Subs PoToken** uygulanabildiğini, tokenların oturuma veya video kimliğine bağlanabildiğini ve video başına yeniden üretilmesinin gerekebildiğini belirtiyor. Manuel token çıkarımı artık tavsiye edilmiyor. ([GitHub][2])sıyla:

* `fmt=json3`, `srv3`, XML veya VTT kullanmak token sorununu çözmez.
* `credentials: "include"` cookie gönderir ama PoToken üretmez.
* `Referer`, `Accept-Language` veya `User-Agent` değiştirmek kalıcı çözüm değildir.
* `429` her zaman “imza bozuldu” demek değildir; güncel transcript kütüphanesi 429’u IP/rate-limit engeli olarak sınıflandırıyor. ([GitHub][1])ard/PoToken algoritmasını eklenti içinde tersine mühendislikle üretmek bakım maliyeti yüksek ve sürekli kırılacak bir yaklaşımdır.

Resmî YouTube Data API’de `tlang` destekleniyor, fakat `captions.download` çağrısı yalnızca videoyu düzenleme yetkisi bulunan kullanıcılar için çalışıyor. Bu nedenle herhangi bir herkese açık videonun altyazısını indiren genel Chrome eklentisi için çözüm değildir. ([Google for Developers][3])# Mevcut koddaki temel problem

Güncel `main` dalında `tlang` artık `youtube-provider.ts` → background → injected scraper zincirinden geçiyor. Bu nedenle sorun parametrenin tamamen kaybolması değil. injected kod şu varsayımı yapıyor:

```ts
player.setOption('captions', 'track', {
  languageCode: originalLang,
  translationLanguage: { languageCode: tlang }
});
```

Ardından transcript panelini açıp paneldeki dili okumaya çalışıyor. Player altyazı state’i ile transcript engagement panel state’i aynı şey değildir. Player İngilizce altyazı gösterse bile transcript paneli Türkçe track üzerinde kalabilir. Mevcut kod ayrıca panel dropdown’ını yerelleştirilmiş `"İngilizce"`, `"English"` ve `"eng"` metinleriyle arıyor. arak scraper, dili gerçek bir ISO koduyla doğrulamak yerine panel başlığının metnini `languageCode` alanına yazıyor ve segmentleri kabul ediyor:

```ts
const languageCode =
  langEl?.textContent?.trim() || 'unknown';
```

Bu yüzden kullanıcı İngilizce istemiş olsa bile Türkçe segmentler başarı sayılabiliyor.  Önerilen native subtitle request broker

## 1. Manifest’e `webRequest` ekleyin

Mevcut manifestinizde `scripting` ve YouTube host izni var, fakat `webRequest` yok. n
{
"permissions": [
"storage",
"tabs",
"scripting",
"activeTab",
"clipboardWrite",
"webRequest"
],
"host_permissions": [
"[https://www.youtube.com/](https://www.youtube.com/)*",
"https://*.youtube.com/*"
]
}

````

Manifest V3’te blocking `webRequest` çoğu eklenti için kullanılamaz, ancak istekleri gözlemleyen normal `webRequest` hâlâ kullanılabilir. Burada isteği değiştirmeyeceğiz; yalnızca player’ın ürettiği URL’yi okuyacağız. :contentReference[oaicite:18]{index=18}# 2. Player’ın oluşturduğu `/api/timedtext` URL’sini yakalayın

Aşağıdaki kodu örneğin `src/background/native-caption-broker.ts` dosyasına ekleyebilirsiniz.

```ts
interface NativeCaptionCaptureRequest {
  videoId: string;
  sourceLanguage: string;
  sourceKind?: string;
  targetLanguage?: string;
}

interface PendingCapture {
  videoId: string;
  sourceLanguage: string;
  targetLanguage?: string;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const pendingCaptures = new Map<number, PendingCapture>();

function languageMatches(actual: string | null, expected: string): boolean {
  if (!actual) return false;

  const normalizedActual = actual.toLowerCase();
  const normalizedExpected = expected.toLowerCase();

  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(`${normalizedExpected}-`) ||
    normalizedExpected.startsWith(`${normalizedActual}-`)
  );
}

function clearPendingCapture(tabId: number): void {
  const pending = pendingCaptures.get(tabId);

  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingCaptures.delete(tabId);
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const pending = pendingCaptures.get(details.tabId);
    if (!pending) return;

    let url: URL;

    try {
      url = new URL(details.url);
    } catch {
      return;
    }

    if (!url.pathname.includes("/api/timedtext")) return;

    const responseVideoId = url.searchParams.get("v");

    if (responseVideoId && responseVideoId !== pending.videoId) {
      return;
    }

    const sourceLanguage = url.searchParams.get("lang");
    const targetLanguage = url.searchParams.get("tlang");

    const matches = pending.targetLanguage
      ? languageMatches(targetLanguage, pending.targetLanguage)
      : languageMatches(sourceLanguage, pending.sourceLanguage) &&
        !targetLanguage;

    if (!matches) return;

    clearTimeout(pending.timeoutId);
    pendingCaptures.delete(details.tabId);
    pending.resolve(details.url);
  },
  {
    urls: [
      "https://www.youtube.com/api/timedtext*",
      "https://*.youtube.com/api/timedtext*"
    ]
  }
);

function waitForNativeCaptionUrl(
  tabId: number,
  request: NativeCaptionCaptureRequest,
  timeoutMs = 15_000
): Promise<string> {
  clearPendingCapture(tabId);

  return new Promise<string>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingCaptures.delete(tabId);
      reject(new Error("NATIVE_CAPTION_REQUEST_TIMEOUT"));
    }, timeoutMs);

    pendingCaptures.set(tabId, {
      videoId: request.videoId,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      resolve,
      reject,
      timeoutId
    });
  });
}
````

---

## 3. MAIN world içinde doğru track’i seçin

Content script izole dünyada çalıştığı için `movie_player` nesnesinin gerçek JavaScript API’sine doğrudan güvenemezsiniz. `chrome.scripting.executeScript({ world: "MAIN" })` host sayfanın JavaScript dünyasında çalışır ve bu kullanım Chrome tarafından desteklenir. ([Chrome for Developers][4])async function triggerNativeCaptionRequestInjected(
videoId: string,
sourceLanguage: string,
sourceKind: string | null,
targetLanguage: string | null
): Promise<{
success: boolean;
mode?: "original" | "translated";
error?: string;
}> {
const delay = (ms: number) =>
new Promise<void>((resolve) => setTimeout(resolve, ms));

const langMatches = (actual: unknown, expected: string): boolean => {
if (typeof actual !== "string") return false;

```
const a = actual.toLowerCase();
const e = expected.toLowerCase();

return (
  a === e ||
  a.startsWith(`${e}-`) ||
  e.startsWith(`${a}-`)
);
```

};

const player = document.getElementById("movie_player") as any;

if (!player || typeof player.setOption !== "function") {
return {
success: false,
error: "MOVIE_PLAYER_API_NOT_AVAILABLE"
};
}

let playerResponse: any;

try {
playerResponse = player.getPlayerResponse?.();

```
if (typeof playerResponse === "string") {
  playerResponse = JSON.parse(playerResponse);
}
```

} catch {
return {
success: false,
error: "PLAYER_RESPONSE_UNAVAILABLE"
};
}

if (playerResponse?.videoDetails?.videoId !== videoId) {
return {
success: false,
error: "PLAYER_VIDEO_MISMATCH"
};
}

const renderer =
playerResponse?.captions?.playerCaptionsTracklistRenderer;

const responseTracks: any[] = renderer?.captionTracks ?? [];

let playerTracks: any[] = [];

try {
const value = player.getOption("captions", "tracklist");
playerTracks = Array.isArray(value) ? value : [];
} catch {
playerTracks = [];
}

const allTracks =
playerTracks.length > 0 ? playerTracks : responseTracks;

const sourceTrack =
allTracks.find((candidate) => {
const sameLanguage = langMatches(
candidate?.languageCode,
sourceLanguage
);

```
  const sameKind =
    !sourceKind ||
    !candidate?.kind ||
    candidate.kind === sourceKind;

  return sameLanguage && sameKind;
}) ??
allTracks.find((candidate) =>
  langMatches(candidate?.languageCode, sourceLanguage)
);
```

if (!sourceTrack) {
return {
success: false,
error: `SOURCE_TRACK_NOT_FOUND:${sourceLanguage}`
};
}

try {
player.toggleSubtitlesOn?.();

```
if (targetLanguage) {
  /*
   * Önce source track'i yüklemek, ardından translationLanguage
   * uygulamak yeni bir timedtext isteği oluşmasını daha olası kılar.
   */
  player.setOption("captions", "track", sourceTrack);
  await delay(150);

  let translationLanguages: any[] = [];

  try {
    const value = player.getOption(
      "captions",
      "translationLanguages"
    );

    translationLanguages = Array.isArray(value)
      ? value
      : [];
  } catch {
    translationLanguages =
      renderer?.translationLanguages ?? [];
  }

  const translationLanguage =
    translationLanguages.find((candidate) =>
      langMatches(
        candidate?.languageCode,
        targetLanguage
      )
    ) ?? {
      languageCode: targetLanguage
    };

  player.setOption("captions", "track", {
    ...sourceTrack,
    translationLanguage
  });

  return {
    success: true,
    mode: "translated"
  };
}

player.setOption("captions", "track", sourceTrack);

return {
  success: true,
  mode: "original"
};
```

} catch (error) {
return {
success: false,
error:
error instanceof Error
? error.message
: "PLAYER_TRACK_SELECTION_FAILED"
};
}
}

````

Burada önemli ayrım şudur:

```ts
// Videoda gerçek İngilizce track varsa:
sourceLanguage = "en";
targetLanguage = undefined;

// Videoda yalnızca Türkçe track varsa ve İngilizce çeviri isteniyorsa:
sourceLanguage = "tr";
targetLanguage = "en";
````

Gerçek İngilizce track mevcutken Türkçe track’e `tlang=en` uygulamayın. Önce gerçek track tercih edilmelidir.

---

## 4. Yakalanan URL’yi değiştirmeden MAIN world’de fetch edin

```ts
async function fetchExactCaptionUrlInjected(
  exactUrl: string
): Promise<{
  success: boolean;
  rawText?: string;
  contentType?: string;
  httpStatus?: number;
  error?: string;
}> {
  let url: URL;

  try {
    url = new URL(exactUrl);
  } catch {
    return {
      success: false,
      error: "INVALID_CAPTURED_URL"
    };
  }

  const allowedHost =
    url.hostname === "youtube.com" ||
    url.hostname.endsWith(".youtube.com");

  if (
    !allowedHost ||
    !url.pathname.includes("/api/timedtext")
  ) {
    return {
      success: false,
      error: "CAPTURED_URL_REJECTED"
    };
  }

  try {
    /*
     * URL'ye fmt, tlang, lang veya başka bir parametre EKLEMEYİN.
     */
    const response = await fetch(exactUrl, {
      credentials: "include",
      cache: "no-store"
    });

    const contentType =
      response.headers.get("content-type") ?? "";

    const rawText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        httpStatus: response.status,
        contentType,
        error: `HTTP_${response.status}`
      };
    }

    if (!rawText.trim()) {
      return {
        success: false,
        httpStatus: response.status,
        contentType,
        error: "EMPTY_CAPTION_BODY"
      };
    }

    const trimmed = rawText.trimStart();

    if (
      trimmed.startsWith("<!DOCTYPE") ||
      trimmed.startsWith("<html")
    ) {
      return {
        success: false,
        httpStatus: response.status,
        contentType,
        error: "HTML_RESPONSE"
      };
    }

    return {
      success: true,
      rawText,
      contentType,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "EXACT_CAPTION_FETCH_FAILED"
    };
  }
}
```

---

## 5. Background orchestration

```ts
export async function captureNativeYouTubeCaption(
  tabId: number,
  request: NativeCaptionCaptureRequest
): Promise<{
  success: boolean;
  rawText?: string;
  exactUrl?: string;
  mode?: string;
  error?: string;
}> {
  const urlPromise = waitForNativeCaptionUrl(
    tabId,
    request,
    15_000
  );

  const triggerResults =
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: [0]
      },
      world: "MAIN",
      func: triggerNativeCaptionRequestInjected,
      args: [
        request.videoId,
        request.sourceLanguage,
        request.sourceKind ?? null,
        request.targetLanguage ?? null
      ]
    });

  const triggerResult = triggerResults[0]?.result;

  if (!triggerResult?.success) {
    clearPendingCapture(tabId);

    return {
      success: false,
      error:
        triggerResult?.error ??
        "NATIVE_CAPTION_TRIGGER_FAILED"
    };
  }

  let exactUrl: string;

  try {
    exactUrl = await urlPromise;
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "CAPTION_URL_NOT_CAPTURED"
    };
  }

  const fetchResults =
    await chrome.scripting.executeScript({
      target: {
        tabId,
        frameIds: [0]
      },
      world: "MAIN",
      func: fetchExactCaptionUrlInjected,
      args: [exactUrl]
    });

  const fetchResult = fetchResults[0]?.result;

  if (!fetchResult?.success || !fetchResult.rawText) {
    return {
      success: false,
      exactUrl,
      mode: triggerResult.mode,
      error:
        fetchResult?.error ??
        "EXACT_CAPTION_FETCH_FAILED"
    };
  }

  return {
    success: true,
    rawText: fetchResult.rawText,
    exactUrl,
    mode: triggerResult.mode
  };
}
```

Bunu mevcut `message-router.ts` içine yeni bir mesaj türü olarak ekleyebilirsiniz:

```ts
type CaptureNativeCaptionMessage = {
  type: "CAPTURE_NATIVE_CAPTION";
  requestId: string;
  videoId: string;
  sourceLanguage: string;
  sourceKind?: string;
  targetLanguage?: string;
};
```

Handler:

```ts
if (message.type === "CAPTURE_NATIVE_CAPTION") {
  const tabId = sender.tab?.id;

  if (!tabId) {
    sendResponse({
      success: false,
      error: "NO_TAB"
    });
    return true;
  }

  captureNativeYouTubeCaption(tabId, {
    videoId: message.videoId,
    sourceLanguage: message.sourceLanguage,
    sourceKind: message.sourceKind,
    targetLanguage: message.targetLanguage
  })
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "NATIVE_CAPTURE_FAILED"
      });
    });

  return true;
}
```

---

# `youtube-provider.ts` için önerilen yeni sıra

```ts
const requiresPoToken =
  /(?:[?&])exp=xpe(?:&|$)/.test(track.baseUrl);

const shouldUseNativePlayer =
  Boolean(tlang) || requiresPoToken;

/*
 * 1. Çeviri isteniyorsa veya track PoToken korumalıysa
 *    player-generated request kullan.
 */
if (shouldUseNativePlayer) {
  const nativeResult = await sendRuntimeMessage({
    type: "CAPTURE_NATIVE_CAPTION",
    requestId: crypto.randomUUID(),
    videoId,
    sourceLanguage: track.languageCode,
    sourceKind: track.kind,
    targetLanguage: tlang
  });

  if (nativeResult?.success && nativeResult.rawText) {
    rawText = nativeResult.rawText;
    usedFormat =
      nativeResult.mode === "translated"
        ? "native-player-translation"
        : "native-player-original";
  }
}

/*
 * 2. Sadece korumasız orijinal track için mevcut direct fetch.
 */
if (!rawText && !requiresPoToken && !tlang) {
  rawText = await this.tryFetchCaption(
    track.baseUrl,
    abortController?.signal
  );

  if (rawText) {
    usedFormat = "direct-original";
  }
}

/*
 * 3. Son fallback: transcript panelinden orijinal metin.
 */
if (!rawText) {
  panelSegments =
    await this.scrapeTranscriptPanel(videoId);
}

/*
 * 4. İngilizce çeviri istenmiş ancak YouTube native çevirisi
 *    alınamamışsa kendi AI çeviri katmanınızı çalıştırın.
 */
if (panelSegments && tlang === "en") {
  panelSegments = await translateSegmentsPreservingTiming(
    panelSegments,
    "en"
  );

  usedFormat = "panel-original+extension-translation";
}
```

Bu düzenlemede DOM scraper’a `tlang` gönderilmemesi bilinçlidir. Panel scraper yalnızca görünen orijinal transcript’i almakla sorumlu olur; dil değiştirme sorumluluğu kaldırılır.

---

## B) Transcript paneli DOM üzerinden yüzde 100 yönetilebilir mi?

**Hayır.** YouTube transcript paneli için belgelenmiş ve kalıcı bir `yt.config` dil state’i bulunmuyor. Panel Polymer/ViewModel state’i, player caption state’i ve dropdown popup state’i ayrı ayrı değişebiliyor.

DOM yöntemini sürdürmek zorundaysanız şu iyileştirmeleri yapın:

* Yerelleştirilmiş `"English"` veya `"İngilizce"` metinleriyle seçim yapmayın.
* `setTimeout(600)` yerine `MutationObserver` ile popup’ın gerçekten oluşmasını bekleyin.
* Dil değiştikten sonra eski segment node’larının kaldırılıp yeni node’ların geldiğini gözlemleyin.
* Sonucun dilini panel başlığından değil, seçilen menu endpoint metadata’sından doğrulayın.
* Hedef dil doğrulanmadıysa scraper sonucunu başarı kabul etmeyin.
* Panel dropdown yöntemini son fallback olarak bırakın.

Yine de bu yöntem YouTube DOM güncellemelerinde kırılacaktır.

---

## C) `/youtubei/v1/get_transcript` kullanılmalı mı?

Kullanılabilir, ancak birincil çözüm olarak önermiyorum.

Bu endpoint genellikle sayfadan alınan veya protobuf biçiminde üretilen opaque bir `params` alanı ister. Invidious bu parametreleri video ID, dil ve otomatik altyazı bilgisiyle oluşturuyor. ([GitHub][5])YouTube.js tarafında `/youtubei/v1/get_transcript` çağrılarının 400 döndürdüğüne ilişkin güncel hata kayıtları bulunuyor. Bu nedenle endpoint’in timedtext/player yolundan daha kararlı olduğunu varsayamazsınız. ([GitHub][6]):

* Çeviri seçenekleri her yanıtta aynı endpoint parametreleriyle sunulmuyor.
* Login, deney grubu ve istemci context’i sonucu değiştirebiliyor.
* YouTube’un dahili protobuf şeması değiştiğinde yeniden güncelleme gerekir.
* PoToken/subtitle korumasını zorunlu olarak ortadan kaldırmaz.

`get_transcript` yalnızca **orijinal transcript için ek fallback** olabilir; İngilizce çevirinin ana yolu yapılmamalıdır.

---

## Nihai önerilen mimari

```text
İngilizce isteniyor
        │
        ├─ Gerçek en / en-US / en-GB track var mı?
        │        ├─ Evet → native player request capture
        │        └─ Hayır
        │
        ├─ Source track translatable mı?
        │        ├─ Evet → player setOption + translationLanguage=en
        │        │          → gerçek timedtext URL’sini yakala
        │        └─ Hayır
        │
        ├─ Orijinal transcript panelini scrape et
        │
        └─ Segmentleri zaman kodlarını koruyarak
           eklentinin AI katmanında İngilizceye çevir
```

Bu yaklaşımda:

* PoToken bypass edilmiyor.
* İmzalı URL elle yeniden oluşturulmuyor.
* Transcript panelinin dil dropdown’ına bağımlılık kaldırılıyor.
* Türkçe YouTube arayüzü sonucu etkilemiyor.
* İngilizce orijinal track ile İngilizce makine çevirisi açıkça ayrılıyor.
* Sonuç metadata’sında `native-original`, `youtube-translation` ve `extension-translation` kaynakları gösterilebiliyor.

[1]: https://github.com/jdepoix/youtube-transcript-api/blob/master/youtube_transcript_api/_transcripts.py?utm_source=chatgpt.com "youtube-transcript-api/youtube_transcript_api/_transcripts.py at master · jdepoix/youtube-transcript-api · GitHub"
[2]: https://github.com/yt-dlp/yt-dlp/wiki/Po-Token-Guide "PO Token Guide · yt-dlp/yt-dlp Wiki · GitHub"
[3]: https://developers.google.com/youtube/v3/docs/captions/download?utm_source=chatgpt.com "Captions: download | YouTube Data API"
[4]: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts?authuser=1&utm_source=chatgpt.com "Content scripts  |  Chrome for Developers"
[5]: https://github.com/iv-org/invidious/blob/master/src/invidious/routes/api/v1/videos.cr?utm_source=chatgpt.com "invidious/src/invidious/routes/api/v1/videos.cr at master"
[6]: https://github.com/LuanRT/YouTube.js/issues?utm_source=chatgpt.com "Issues · LuanRT/YouTube.js"
