# Full API, Gemini, and History Reliability Design

## Goal

Make transcript-only history, OpenAI-compatible correction/summary, and Gemini
summary flows durable and verifiable in the real unpacked extension without
logging secrets, prompts, transcripts, or response bodies.

## Scope

This change covers four connected boundaries:

1. A successfully displayed real YouTube transcript becomes a video-keyed
   library record even when no summary or correction exists.
2. API correction and summary requests use the exact provider settings saved by
   the popup, including token parameter, streaming, stream options, and JSON
   mode.
3. Gemini automation owns at most one tab per task, detects a new stable model
   response without requiring a legacy strict selector, and produces a
   normalized `SummaryResult`.
4. Summary terminal results remain in `chrome.storage.session` until the
   YouTube UI has displayed and persisted them.

The existing Chrome MV3, React, `chrome.storage.local`, and
`chrome.storage.session` architecture remains in place. No new backend or
external persistence layer is introduced.

## History Data Model

`HistoryService` remains the canonical video-keyed summary/transcript store.
`SavedSummary.summary` stays optional and transcript metadata is added to the
same record:

- `transcript`
- `transcriptLanguageCode`
- `transcriptTrackLanguage`
- `transcriptSourceType`
- `transcriptDisplayedLanguage`

`saveTranscript()` performs a video-ID upsert. It updates title, URL, date,
transcript, and track metadata while preserving any existing summary.
`saveSummary()` performs the inverse merge: it replaces the summary but keeps a
previous non-empty transcript if the completion path has no transcript.

`TranscriptTab` receives `title` and `url` from `Panel`. After a successful
transcript fetch it persists the displayed result and emits
`LIBRARY_ENTRY_UPDATED`. The popup and `LibraryService` already merge history,
correction, and dictionary records, so transcript-only entries become visible
without a new database.

The History summary tab is always enabled. A transcript-only entry initially
opens the summary tab and shows `Bu video için özet oluşturulmamış.`; the
original transcript tab remains available. Deletion continues to remove the
video-keyed History record together with correction and dictionary records.

## Summary Task Lifecycle

Every API or Gemini summary task gets a `summary_task_<taskId>` session record
containing its task ID, video ID, YouTube tab ID, engine, status, and timestamps.
A synchronous in-memory context lock prevents concurrent duplicate starts for
the same YouTube tab and video. A second start returns the existing task ID
instead of opening another Gemini tab or API request.

Terminal state is written before delivery:

1. Persist `SUMMARY_COMPLETED` or `SUMMARY_FAILED` under the task ID.
2. Deliver it only to the recorded YouTube tab.
3. Keep the terminal state until `SummaryTab` displays the result, saves
   History, emits `LIBRARY_ENTRY_UPDATED`, and sends
   `ACK_SUMMARY_TERMINAL`.

On panel reload, `GET_SUMMARY_TASK_STATE` returns either the active task or the
terminal message. `SummaryTab` reconnects or replays the terminal result.
Failed UI delivery therefore does not lose a completed summary.

## Gemini Automation

`GemController` memoizes in-flight task promises by `taskId`. The controller
keeps the selected `tabId` for the entire attempt. Fallback activates that same
tab; it does not create a second tab when a usable tab already exists.

`GemTabManager` reuses a matching or existing Gemini tab regardless of the
new-chat preference. If a task must create a tab, the returned `isNew` ownership
flag is retained. `maybeCloseTab()` can close only an extension-created tab
after a successful result and only when the setting permits it.

Response detection uses a separate testable detector:

- capture all viable model-turn candidates at baseline;
- require a new candidate or real text change relative to baseline;
- track streaming state and text changes;
- require stable non-streaming text for the completion window;
- accept a valid generic model turn even when the legacy strict selector is
  absent;
- never accept unchanged baseline text.

Every `GEMINI_PROGRESS` message includes `taskId` and `videoId`. Background
relays it through the recorded summary task state to only the originating
YouTube tab.

Gemini markdown is trimmed and normalized into `SummaryResult`. Turkish output
uses `summary.tr`, English output uses `summary.en`, and dual-language output
populates both fields. Empty markdown is rejected.

## API Provider Compatibility

Summary and correction request builders expose independent provider controls:

- `max_tokens` or `max_completion_tokens`
- streaming on/off
- `stream_options` on/off
- JSON mode on/off
- first-byte, stream-idle, and total timeouts

The offscreen worker uses the shared chat-completion reader for streaming SSE,
normal JSON, and plain-text fallback. `reasoning_content` is tracked separately
and is never accepted as the final answer.

The popup connection test selects either `summary` or `correction`. It saves the
draft settings first, builds the same request body used at runtime, performs the
real request, and runs the corresponding parser. Only safe status and parser
metadata are returned to the popup.

## Security

`chrome-cdp-test/` is removed from tracked files and ignored. The audit checks
tracked and historical profile paths by name and scans for sensitive indicators
without printing contents. Git history is not rewritten. If profile/session
artifacts existed in published history, the final report calls out session and
credential rotation as residual remediation.

No API key, prompt, transcript, cookie, token, or response body is written to
console, reports, screenshots, or test output.

## Verification

Unit tests cover transcript-only upsert/merge, History empty state, terminal
recovery, duplicate summary tasks, one-tab Gemini ownership, selector-independent
response completion, output-language normalization, and real request-body
settings.

Live tests use a real unpacked extension and real YouTube captions. They do not
install a fake `movie_player`, intercept routes, or synthesize timedtext.
Streaming-on and streaming-off API runs cover correction and summary. Gemini
validation uses the existing signed-in Gemini Web/Gem session and verifies one
tab, UI delivery, and History persistence.

