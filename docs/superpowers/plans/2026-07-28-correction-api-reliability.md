# Correction API Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transcript correction reliable across OpenAI-compatible providers and prove the complete `.env -> API -> parser -> UI -> CorrectionDB -> History` path without exposing the API key.

**Architecture:** Keep API secrets outside the extension bundle. The live Playwright harness reads `.env`, seeds the existing Chrome storage settings boundary, and drives the real unpacked extension. Production changes stay within the request builder, offscreen worker, correction parser, DB/UI error path, background terminal relay, and build/test scripts.

**Tech Stack:** TypeScript, React 18, Chrome MV3, Vite, Vitest, Playwright, IndexedDB.

---

### Task 1: Baseline And Main Comparison

**Files:**
- Inspect: `package.json`
- Inspect: `index.html`
- Inspect: `src/popup/index.tsx`
- Inspect: `src/background/message-router.ts`

- [x] Fetch `origin/main` and record ahead/behind state.
- [x] Confirm `.env` required values are set without printing values.
- [x] Remove `dist` safely and run `npm run build`.
- [ ] Run a real API request with safe metadata-only diagnostics and record the failing boundary.

### Task 2: Provider And Parser Regression Coverage

**Files:**
- Modify: `src/ai/prompt-correction.test.ts`
- Modify: `src/offscreen/api-worker.test.ts`
- Modify: `src/ai/correction-parser.test.ts`
- Modify: `src/ai/prompt-correction.ts`
- Modify: `src/offscreen/api-worker.ts`
- Modify: `src/ai/correction-parser.ts`
- Modify: `src/settings/types.ts`

- [ ] Run focused tests and confirm regression failures for any missing behavior.
- [ ] Support `max_tokens` and `max_completion_tokens`.
- [ ] Make streaming, `stream_options`, and JSON mode independently configurable.
- [ ] Track SSE `content` and `reasoning_content` separately; reject reasoning-only output.
- [ ] Keep HTTP error body content out of diagnostics while retaining status, provider error code, request ID, content type, and body length.
- [ ] Prevent fallback warning labels from producing `NaN. cümle`.
- [ ] Run focused tests to green.

### Task 3: Durable Delivery And Persistence Errors

**Files:**
- Create: `src/background/correction-terminal-relay.test.ts`
- Create: `src/background/correction-terminal-relay.ts`
- Modify: `src/background/message-router.ts`
- Modify: `src/transcript/correction-db.ts`
- Modify: `src/content/TranscriptTab.tsx`

- [ ] Write a failing relay test proving terminal state remains until tab delivery succeeds.
- [ ] Store terminal correction result/error in session, deliver it, then remove the session record only on success.
- [ ] Preserve terminal state when content delivery fails so `GET_ACTIVE_API_TASK` can recover it.
- [ ] Re-throw `CorrectionDB` write failures.
- [ ] Keep corrected output visible and show `Düzeltme tamamlandı fakat kaydedilemedi`.
- [ ] Run focused tests to green.

### Task 4: Clean Extension Test Gate

**Files:**
- Create: `scripts/clean-dist.mjs`
- Modify: `package.json`

- [ ] Add a repository-bounded `dist` cleanup script.
- [ ] Make `test:extension` run a clean production build before Playwright.
- [ ] Prove a deliberately stale `dist` marker cannot survive `npm run test:extension`.

### Task 5: Real API End-To-End Test

**Files:**
- Create: `tests/live-correction.spec.ts`
- Create: `tests/helpers/load-private-env.ts`
- Modify: `package.json`

- [ ] Read `.env` without logging values and require URL, key, and model.
- [ ] Seed `ai_summary_settings` through Chrome storage and verify the runtime key with a one-way equality check only.
- [ ] Load a small YouTube fixture, start correction from the real UI, and wait for the API response.
- [ ] Verify corrected UI output, `CorrectionDB`, and History/library visibility.
- [ ] Assert console/output logs do not contain the API key.
- [ ] Run the live test and record provider status, parser result count, DB record, and History result without response text.

### Task 6: Final Verification

**Files:**
- Review all changed files against `origin/main`.

- [ ] Run `npm run typecheck`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:providers`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:privacy`.
- [ ] Run `npm run test:fixture`.
- [ ] Run `npm run test:extension`.
- [ ] Run `git diff --check`.
- [ ] Report changed files, root causes, main comparison, and real API chain result without pushing.
