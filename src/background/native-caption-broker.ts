export interface NativeCaptionCaptureRequest {
  videoId: string;
  sourceLanguage: string;
  sourceKind?: string | null;
  targetLanguage?: string | null;
}

interface PendingCapture {
  videoId: string;
  sourceLanguage: string;
  targetLanguage?: string | null;
  resolve: (url: string) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const pendingCaptures = new Map<number, PendingCapture>();

function languageMatches(actual: string | null | undefined, expected: string): boolean {
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

async function triggerNativeCaptionRequestInjected(
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

    const a = actual.toLowerCase();
    const e = expected.toLowerCase();

    return (
      a === e ||
      a.startsWith(`${e}-`) ||
      e.startsWith(`${a}-`)
    );
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

    if (typeof playerResponse === "string") {
      playerResponse = JSON.parse(playerResponse);
    }
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

      const sameKind =
        !sourceKind ||
        !candidate?.kind ||
        candidate.kind === sourceKind;

      return sameLanguage && sameKind;
    }) ??
    allTracks.find((candidate) =>
      langMatches(candidate?.languageCode, sourceLanguage)
    );

  if (!sourceTrack) {
    return {
      success: false,
      error: `SOURCE_TRACK_NOT_FOUND:${sourceLanguage}`
    };
  }

  try {
    player.toggleSubtitlesOn?.();

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
