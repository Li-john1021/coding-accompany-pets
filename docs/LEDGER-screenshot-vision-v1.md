# Screenshot / Vision implementation ledger

Plan v1 was authorized for stepwise implementation, clean Luna review/repair, automated tests and computer use by the user's latest instruction on 2026-10-27.

Base and merge-base: `10b6045caa05dc45dbf83b9188bdf0e9187d6510` on main. Work branch: `codex/screenshot-vision-v1` in an isolated sibling worktree. Original checkout had only three untracked research/plan documents authored in this chat; copied without removing originals. Existing unrelated palette worktree untouched. Ignored node_modules junction points at existing project dependencies; ignored Live2D runtime is reused locally for runtime checks, never committed.

The Plan is the authority; the compiled JSON Spec is frozen for this cycle. Each P1–P6 candidate receives focused checks and a fresh read-only Luna audit before further code edits. Failures and repair audits are retained. This ledger and evidence reports track status, not the Spec.

Provider policy is frozen in the Spec. No model calls or credential reads yet. Six synthetic-image live requests maximum, zero automatic retries. No provider call without the fixture/prompt hashes and successful access gate recorded here.

## Progress

- Preparation: worktree created, Plan copied, Spec compiled. Frozen input hashes: Plan `93AD032E4D9715800B9DE713DBF305FDB06C6554DE9A5656568EA684DAFAE67`; Spec `05355AD48521BA5B2F622A6FF0A769BB77EFBB434AFE2A0C32BB9281FFF21BEC`.
- P1 candidate implemented on `codex/screenshot-vision-v1`: default/persisted `screenshotHotkey`, legacy-safe per-LLM `multimodal`, settings checkboxes and independent hotkey recorders, recorder cancellation/close cleanup, and save failure feedback. Focused unit and isolated Electron settings checks pass; details in `docs/evidence/screenshot-vision-p1.txt`. Awaiting fresh independent P1 audit. P2 registration is still required for the screenshot hotkey to trigger an action.
- P1 audit 1 failed on F-001; original audit retained unchanged at `docs/audits/screenshot-vision-p1-1.json`. Repair snapshots the recorder field before scheduling its delayed feedback cleanup. The Electron check now runs that queued callback after capture teardown and passes; repair evidence is in `docs/evidence/screenshot-vision-p1-repair.txt`. Correction: the prior P1 evidence Plan hash line contained a transcription error; verified Plan SHA-256 is `93AD032E4D9715800B9CDE713DBF305FDB06C6554DE9A5656568EA684DAFAE67` (Spec SHA-256 remains `05355AD48521BA5B2F622A6FF0A769BB77EFBB434AFE2A0C32BB9281FFF21BEC`). Fresh independent P1 audit pending.
