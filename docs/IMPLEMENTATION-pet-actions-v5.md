# Pet Actions v5 Implementation Ledger

Implementation base: `48ccd24e895ca6bb4c729965d0c95fe377e9b166`, branch `codex/palette-input-sources`. The worktree was clean before implementation. The approved Plan and frozen Spec were read; the Spec SHA-256 remains `1A00857FC1AA9E6896C1B865A82C2315A36E7338113652ED2EB704FA3C95D125`. Historical v3/v4 reports and all frozen specifications remain unchanged.

## Implementation units

- `9c677a2`: canonical `insertMode` checkbox for both workflows; bounded integer `undoToastSeconds`; faithful independent prompts with three short examples per mode and JSON source data; exact legacy default migration with custom prompt retention.
- `6cfabee`: shared result delivery, host-specific guarded keys, latest-only expiring memory undo, clipboard-first publication, and deferred voice pipeline delivery.
- `2fdad6f`: main/renderer integration, non-focusable 280 × 76 toast, immutable initial ASR for normal/raw/preview-short/preview-final flows, input listener singleton, explicit writable evidence for ordinary undo, voice epoch/concurrency guards, and synthetic tests.

Delivery never activates or refocuses a host. Windows native key dispatch rechecks HWND, PID, thread, focus child, classes and process before sending one chord. There is no Enter chord. Terminal delivery uses Shift+Insert; terminal Undo only copies the original source and provides a terminal-specific message. Ordinary Undo requires successful own paste dispatch, affirmative native Edit/UIA writable evidence, a running input guard, unchanged target identity, and no subsequent dirty signal. Unknown/editability-unavailable targets fall back to original clipboard. Writable classification is only requested by delivery/undo snapshots and does not gate capture or model processing.

Input listeners register once per process and remain shared with optional side-key recording. Keyboard/external mouse signals dirty the current pasted operation; toast clicks are excluded with Windows screen-to-DIP conversion. A bounded serial target check also observes target changes during the toast lifetime. No legacy automatic selection trigger is reintroduced.

Only the delivery closure holds the original source and target. Renderers receive an opaque token, duration, delivery boolean and generic note. Expiry, replacement, dismissal and successful consumption discard the token. Undo has no model/ASR dependency. No source/result/undo payload is added to application persistence or logs.

## Verification on 2026-10-07

- All 22 `app/main/*.unit.test.js` files passed, including new config migration/roundtrip/duration, JSON prompt source, clipboard/paste on/off, source preservation, token expiry/replacement/duplicate rejection, dirty/changed/unknown-writable fallbacks, terminal no-undo/no-Enter, deferred voice pipeline, production IPC preview/ASR and concurrency, and unique input listener tests.
- `app/renderer/pet-live2d.unit.test.js` passed.
- All 52 then-tracked JavaScript files passed `node --check`. New integration test/UI files also passed syntax checks during execution; final handoff rechecks tracked files after commit.
- `git diff --check` passed. Frozen Spec hash was rechecked.
- An early v4 real Electron clipboard-only regression run passed before final writable classification changes. Subsequent current-tree v4/v5 runtime runs were blocked by actual Windows foreground changes to Edge despite Electron reporting its own logical focus. Diagnostics verified that capture correctly rejected wrong/changed targets with zero model calls. These later runs are failures, not passing runtime acceptance evidence.
- `app/main/pet-actions-v5.e2e.test.js` retains real production capture/IPC/native paste/Undo assertions and synthetic ASR/model mocks. It includes test-only activation and native foreground confirmation for its own fixture window; it never weakens production target checks. The final attempted run observed an Electron source target changing to Edge during capture and failed. Repeated foreground attempts were stopped to avoid competing with user activity. The independent clean test phase must rerun this suite while the test window can retain foreground.

Named runtime scope attempted: Windows, Electron BrowserWindow editable textarea (v5); Windows, Electron BrowserWindow read-only textarea with clipboard-only delivery (v4). Current v5 native paste/undo runtime acceptance remains unproven. No current Windows Terminal/conhost native runtime success is claimed; terminal routing is covered by synthetic tests. macOS/Linux chords are design targets only and are not runtime supported by the native dispatcher.

## Prompt evaluation boundary

This implementation agent made zero provider calls, did not access user provider configuration, and used synthetic fixtures. Prompt quality was not live evaluated by this implementation agent; unit tests verify prompt/source boundaries, not model quality. The parent task's separate bounded evaluation artifacts are independently owned and excluded from these implementation commits. This ledger makes no universal quality or optimality claim.

## Remaining release checks

Independent review and clean runtime testing remain required, especially actual editable-host replacement/Undo, focus preservation, input dirtiness and named terminal controls. The current implementation is reviewable; unit success is not a substitute for that runtime release boundary.
