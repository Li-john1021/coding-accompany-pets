# Pet Actions v5 Implementation Ledger

Current implementation status: the native-generation repair described in the final section is ready for independent review. Earlier failure/pass statements below are retained as historical evidence for their named candidate, not claims about every later revision.

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

Independent review and clean runtime testing remain required, especially input dirtiness and named terminal controls. The current implementation is reviewable; unit success is not a substitute for that runtime release boundary.

## Runtime repair and successful follow-up

The initial foreground failures above describe earlier attempts. With the user allowing desktop tests, subsequent execution reached a genuine native dispatch defect: the generated PowerShell used the unsupported `[ushort[]]` alias, so C# was never invoked. It now uses `[uint16[]]` (and `[uint32[]]` event flags). Generic native status output distinguishes rejected targets, failed injection and exceptions without source text. All identity checks remain intact.

Voice delivery now records `kind: voice` in memory. On a clean, unchanged, affirmatively writable ordinary target, voice Undo restores the initial ASR clipboard and dispatches Ctrl+Z followed by Ctrl+V in a single native input packet. Selection Undo retains its single Ctrl+Z. Terminal/dirty/changed/unknown-writable paths remain clipboard-only. No Undo path invokes ASR/model or sends Enter. Toast positioning sets the intended small bounds when moving across displays.

The final production-script E2E rerun passed after diagnostic script rewrites were removed. Named observed pairs:

- Windows / Electron BrowserWindow textarea: real selection copy, result clipboard, non-focusable toast, clipboard Undo, and real Ctrl+V replacement. This fixture exposes only a UIA Window, not affirmative writable evidence; Undo correctly leaves the processed target unchanged and restores only the source clipboard.
- Windows / existing native Win32 Edit fixture: real selection replacement followed by Ctrl+Z restores the captured selection; voice result paste followed by the single restoration packet leaves the input box equal to the initial synthetic ASR transcript.
- Windows / Electron preview UI with mocked ASR: edited/reprocessed preview finalization, raw-only submission and short-preview bypass each restore the immutable initial ASR to the clipboard with no new model/ASR calls.

All 22 main unit files and Live2D tests passed again after this repair. Frozen Spec SHA-256 remains unchanged. The passing fixture includes test-only activation/physical click restricted to its own source window and bounds; production delivery does not activate or refocus windows. Terminal/macOS/Linux runtime compatibility remains unclaimed.

## Repairs after independent reviews 1 and 2

Both failed audits remain unchanged in `docs/audits/pet-actions-v5-review-1.md` and `docs/audits/pet-actions-v5-review-2.md`. Review 1's capture/old-Undo admission finding was repaired in `c5ef5d7` and review 2 independently marked F-002 closed. Production Undo admission rejects capture/model/recording/submission/pending-preview/delivery busy states before token consumption or clipboard writes; reverse admissions reject busy delivery/Undo. The pending-capture regression uses real capture owner checks and a physical-click-equivalent dirty signal, and confirms zero Undo clipboard writes.

The READY/COMMIT startup repair in `c5ef5d7` was insufficient: a JavaScript grant preceded native dispatch and initial paste completion discarded dirty events. Review 2's F-001 and F-003 are addressed by these new implementation units:

- `53b8036`: Windows native input session and protocol. The helper receives target/key/bounds metadata only. Low-level keyboard/mouse hooks identify its own packets through `dwExtraInfo`; other input increments a monotonic generation. Foreground/focus changes also dirty the generation. A failed hook install, helper exit, cancellation or timeout invalidates the session. Abort kills pending native work rather than merely dropping a response. A stale operation cannot restart a new session and reuse its counter.
- `e675bba`: controller/native integration, pending-paste state, final native checks and actual runtime regressions. Each initial paste records its pre-packet generation and session identity. Before Undo, the same native message thread drains pending hook/window messages without recursively dispatching other sends, rechecks current HWND/PID/thread/focused child, and compares the expected generation immediately before one `SendInput` packet. Full process/class identity checks remain. JavaScript grant/quiet-window logic is removed. The uiohook side-key listener remains unique; native-origin-aware events own Windows dirty tracking.

The delivery closure now retains a pending operation throughout the asynchronous paste, so genuine input before the paste promise settles remains dirty. Native generation remains authoritative even if an event reaches JavaScript late. Own packet events do not increment native generation. Only the current visible toast HWND and its actual hit-tested rectangle are excluded from mouse dirtiness, using Windows screen/DIP conversion. Unknown writable controls retain clipboard-only Undo. Native startup/dispatch failures preserve the original clipboard and use an uncertain-result note when the dispatcher cannot confirm whether a packet was submitted.

Original selected text, ASR and results stay in the existing memory-only delivery closure and system clipboard. The helper never receives or reads text. Temporary helper files contain fixed C# source, are removed after startup or failure/close, and contain no source/result/Undo payload. The marker tags input origin; input event time remains its ordinary default. The helper is stopped when the app exits. An already submitted atomic packet cannot be recalled; this natural native dispatch boundary is distinct from the eliminated cross-process JavaScript grant interval.

### Verification for the native-generation candidate

- All 25 main unit files passed, including pending-native cancellation, startup abort/actual C# compilation and cleanup, stale-session refusal, retained post-paste dirty state, native session/generation forwarding, both admission directions and unchanged source/token/terminal behavior.
- Live2D unit passed. All 64 JavaScript files (including the newly added native E2E) passed syntax checks. Diff checks passed; frozen Spec SHA-256 remains `1A00857FC1AA9E6896C1B865A82C2315A36E7338113652ED2EB704FA3C95D125`.
- `native-input-guard.e2e.test.js` passed against actual Windows/native Win32 Edit. A test-only C# pre-send barrier (absent from the production compilation) pauses after identity work. A precompiled external injector sends an ordinary unmarked digit into that own fixture. After release, the final native pump/generation check rejects Ctrl+Z and preserves `PASTED1`. Switching to the fixture's second Edit during the barrier also rejects an initial paste with no expected generation. These are real Windows input/API tests using an external injected event, not a claim about physical human typing.
- The same native E2E delays the JavaScript response after actual paste injection, delivers external input while the native guard remains active, and confirms subsequent Undo only restores clipboard, sends no generic host Undo and leaves `PASTED1` unchanged. It also proves own packets do not advance the generation, native selection Ctrl+Z works, and the native voice restoration packet leaves the input box equal to initial ASR.
- Bounded serial v4 and v5 Electron E2E reruns both passed. Named pairs remain Windows/Electron BrowserWindow textarea (real copy/paste, unknown-writable clipboard Undo) and Windows/native Win32 Edit (actual selection and voice restoration), plus mocked-ASR preview-final/raw-only/short-preview flows.
- One preceding v5 attempt failed before any model call because the source selection collapsed after its old test-only physical click. That redundant click, originally added while investigating UIA exposure, was removed; native foreground activation/confirmation and all selection, paste and Undo assertions remain. The subsequent v4/v5 runs passed. Earlier v4 logical-focus timeouts and the first explicit foreground failure remain historical; its fixture now activates/confirms its own native foreground and parses diagnostic failures from both output streams.

No prompt changes or provider calls were made in these repair cycles. Native terminal/conhost, macOS and Linux runtime compatibility remains unclaimed. Independent review and final clean testing of the newly frozen candidate remain separate acceptance boundaries.
