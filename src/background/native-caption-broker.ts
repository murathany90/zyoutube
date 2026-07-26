export interface NativeCaptionCaptureRequest {
  videoId: string;
  sourceLanguage: string;
  sourceKind?: string | null;
  targetLanguage?: string | null;
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

    // Workaround: Reset track state so YouTube forces a new network request
    // even if it thinks this track is already loaded.
    try {
      player.setOption("captions", "track", {});
      await delay(75);
    } catch (e) {
      // Ignore
    }

    if (targetLanguage) {
      /*
       * First load source track, then apply translationLanguage
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

export async function captureNativeYouTubeCaption(
  tabId: number,
  request: NativeCaptionCaptureRequest
): Promise<{
  success: boolean;
  mode?: string;
  error?: string;
}> {
  // We only trigger track change in MAIN world.
  // The actual URL/body capture is done by the document_start hook.
  
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
    return {
      success: false,
      error:
        triggerResult?.error ??
        "NATIVE_CAPTION_TRIGGER_FAILED"
    };
  }

  return {
    success: true,
    mode: triggerResult.mode
  };
}
