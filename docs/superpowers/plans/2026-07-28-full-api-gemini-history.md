# Full API, Gemini, and History Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver durable transcript-only history, provider-faithful API correction/summary, and single-tab recoverable Gemini summaries in the real unpacked extension.

**Architecture:** Keep History video-keyed in `HistoryService`, add a summary session task/terminal relay with UI acknowledgement, and isolate Gemini response detection into pure tested helpers. Reuse the offscreen chat-completion reader for API summary and correction so popup settings and runtime request bodies share one compatibility contract.

**Tech Stack:** TypeScript, React 18, Chrome MV3, Vite, Vitest, Playwright, Chrome storage.

---

### Task 1: Transcript-Only History Upsert

**Files:**
- Modify: `src/settings/history.ts`
- Modify: `src/history/library-service.ts`
- Modify: `src/content/index.tsx`
- Modify: `src/content/TranscriptTab.tsx`
- Test: `src/settings/history.test.ts`
- Test: `src/history/library-service.test.ts`

- [ ] Add failing tests proving transcript-only records are video-keyed and a
  transcript refresh preserves an existing summary.
- [ ] Run `npx vitest run src/settings/history.test.ts src/history/library-service.test.ts`
  and confirm failures are caused by the missing upsert.
- [ ] Add transcript metadata to `SavedSummary` and implement
  `HistoryService.saveTranscript(videoInfo, transcript, metadata)`.
- [ ] Make `saveSummary()` merge with an existing record and preserve its
  non-empty transcript when completion has no transcript.
- [ ] Pass `title` and `url` from `Panel` to `TranscriptTab`.
- [ ] Persist every successful displayed transcript and emit
  `LIBRARY_ENTRY_UPDATED` after storage succeeds.
- [ ] Re-run focused tests to green.

### Task 2: Popup and History Transcript-Only UX

**Files:**
- Modify: `src/popup/index.tsx`
- Modify: `src/history/HistoryPage.tsx`
- Create: `src/history/history-view-model.ts`
- Test: `src/history/history-view-model.test.ts`
- Modify: `src/popup/filter-helpers.test.ts`

- [ ] Add failing tests for a transcript-only card and the summary empty-state
  view model.
- [ ] Run focused tests and verify expected failures.
- [ ] Show `Transkript` and `Özet oluşturulmamış` for transcript-only cards.
- [ ] Keep `Özet Detayı` enabled, retain summary as the initial tab, and render
  `Bu video için özet oluşturulmamış.`.
- [ ] Verify original Turkish/English transcript data is selected from the
  video-keyed History record.
- [ ] Re-run focused tests to green.

### Task 3: Durable Summary Task State

**Files:**
- Create: `src/background/summary-terminal-relay.ts`
- Create: `src/background/summary-terminal-relay.test.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/content/components/SummaryTab.tsx`

- [ ] Add failing tests proving terminal state is persisted before delivery,
  retained until UI acknowledgement, and recoverable after failed delivery.
- [ ] Add a task/video context lock test proving duplicate starts return the
  existing task ID.
- [ ] Run focused tests and confirm failures.
- [ ] Persist `summary_task_<taskId>` for API and Gemini tasks.
- [ ] Add `GET_SUMMARY_TASK_STATE` and `ACK_SUMMARY_TERMINAL`.
- [ ] Relay terminal messages only to the recorded YouTube tab and do not
  remove them before acknowledgement.
- [ ] Make `SummaryTab` replay a terminal result after reload, render it, save
  History, emit `LIBRARY_ENTRY_UPDATED`, then acknowledge.
- [ ] Re-run focused tests to green.

### Task 4: Gemini Single-Tab Idempotency

**Files:**
- Modify: `src/gem/tab-manager.ts`
- Modify: `src/gem/controller.ts`
- Create: `src/gem/tab-manager.test.ts`
- Create: `src/gem/controller.test.ts`

- [ ] Add failing tests proving duplicate task calls share one promise/tab,
  fallback activates the selected tab, and user-owned tabs are never closed.
- [ ] Run focused tests and confirm tab duplication failures.
- [ ] Memoize in-flight `GemController.summarize()` promises by task ID.
- [ ] Reuse matching or existing Gemini tabs for the whole task.
- [ ] Pass the selected tab to fallback and activate it instead of creating a
  second tab.
- [ ] Preserve `isNew` ownership and close only extension-created tabs after a
  successful result when configured.
- [ ] Re-run focused tests to green.

### Task 5: Gemini Response Detection and Result Normalization

**Files:**
- Create: `src/content/gemini/gemini-response-detector.ts`
- Create: `src/content/gemini/gemini-response-detector.test.ts`
- Modify: `src/content/gemini/gemini-content-script.ts`
- Create: `src/ai/gemini-summary-normalizer.ts`
- Create: `src/ai/gemini-summary-normalizer.test.ts`
- Modify: `src/ai/task-manager.ts`

- [ ] Add failing tests for a new generic model turn without the strict model
  selector, unchanged old-response rejection, and stable completion.
- [ ] Add failing tests for Turkish, English, dual-language, and empty Gemini
  markdown normalization.
- [ ] Run focused tests and confirm failures.
- [ ] Extract candidate collection and baseline comparison into the detector.
- [ ] Remove the strict `currentElement` completion dependency while preserving
  streaming and stability gates.
- [ ] Include `taskId` and `videoId` in every Gemini progress message.
- [ ] Normalize markdown into non-empty `SummaryResult` fields according to
  `outputLanguage`.
- [ ] Re-run focused tests to green.

### Task 6: Provider-Faithful API Summary and Connection Tests

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/ai/types.ts`
- Modify: `src/ai/prompt-builder.ts`
- Modify: `src/offscreen/api-worker.ts`
- Modify: `src/ai/providers/openai-compatible-provider.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/popup/index.tsx`
- Modify: `src/ai/prompt-builder.test.ts`
- Modify: `src/offscreen/api-worker.test.ts`
- Modify: `src/ai/providers/openai-compatible-provider.test.ts`

- [ ] Add failing request-body tests for summary token parameter, streaming,
  stream options, and JSON mode.
- [ ] Add failing connection tests proving correction and summary build and
  parse their actual request formats without exposing response text.
- [ ] Run focused tests and confirm failures.
- [ ] Add independent summary compatibility fields and popup controls.
- [ ] Use the shared SSE/JSON/plain-text reader in API summary execution and
  keep `reasoning_content` separate.
- [ ] Make `TEST_CONNECTION` accept `summary` or `correction`, save the draft
  provider first, execute the real format, and return safe parser metadata.
- [ ] Remove HTTP response-body content from provider errors and popup output.
- [ ] Re-run focused tests to green.

### Task 7: Remove Tracked Chrome Profile

**Files:**
- Modify: `.gitignore`
- Delete: `chrome-cdp-test/`

- [ ] Count tracked profile and sensitive-name files without printing content.
- [ ] Add `chrome-cdp-test/` to `.gitignore`.
- [ ] Remove the directory from the branch.
- [ ] Inspect historical commits and sensitive profile indicators without
  printing cookie/token/session contents or rewriting history.
- [ ] Confirm `git ls-files chrome-cdp-test` is empty.

### Task 8: Real Live Test Harnesses

**Files:**
- Modify: `tests/helpers/load-private-env.ts`
- Modify: `tests/live-correction.spec.ts`
- Create: `tests/live-summary.spec.ts`
- Create: `tests/live-gemini.spec.ts`
- Modify: `package.json`

- [ ] Make live tests require real YouTube caption extraction and explicitly
  reject fixture hosts, route interception, fake player data, and synthetic
  timedtext.
- [ ] Add streaming-on and streaming-off real API coverage using the requested
  real videos.
- [ ] Verify correction and summary through parser, panel UI, storage, and
  History without printing secret or response content.
- [ ] Add Gemini Web/Gem one-tab, SummaryTab, terminal recovery, and History
  validation using the signed-in browser session.
- [ ] Add `test:live-summary` and `test:live-gemini` scripts.

### Task 9: Final Verification and Branch Delivery

**Files:**
- Review every changed path against `origin/main`.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:providers`.
- [ ] Run `npm run build:clean`.
- [ ] Run `npm run test:privacy`.
- [ ] Run `npm run test:fixture`.
- [ ] Run `npm run test:extension`.
- [ ] Run `npm run test:live-correction`.
- [ ] Run `npm run test:live-summary`.
- [ ] Run `npm run test:live-gemini`.
- [ ] Run `git diff --check`.
- [ ] Stage only files listed by this plan, commit to
  `codex/full-api-gemini-history-fix`, and push that branch.
- [ ] Do not merge into `main`.
