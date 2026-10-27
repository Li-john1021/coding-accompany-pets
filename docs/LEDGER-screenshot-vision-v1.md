# Screenshot / Vision implementation ledger

Plan v1 was authorized for stepwise implementation, clean Luna review/repair, automated tests and computer use by the user's latest instruction on 2026-10-27.

Base and merge-base: `10b6045caa05dc45dbf83b9188bdf0e9187d6510` on main. Work branch: `codex/screenshot-vision-v1` in an isolated sibling worktree. Original checkout had only three untracked research/plan documents authored in this chat; copied without removing originals. Existing unrelated palette worktree untouched. Ignored node_modules junction points at existing project dependencies; ignored Live2D runtime is reused locally for runtime checks, never committed.

The Plan is the authority; the compiled JSON Spec is frozen for this cycle. Each P1–P6 candidate receives focused checks and a fresh read-only Luna audit before further code edits. Failures and repair audits are retained. This ledger and evidence reports track status, not the Spec.

Provider policy is frozen in the Spec. No model calls or credential reads yet. Six synthetic-image live requests maximum, zero automatic retries. No provider call without the fixture/prompt hashes and successful access gate recorded here.

## Progress

- Preparation: worktree created, Plan copied, Spec compiled. Frozen input hashes: Plan `93AD032E4D9715800B9DE713DBF305FDB06C6554DE9A5656568EA684DAFAE67`; Spec `05355AD48521BA5B2F622A6FF0A769BB77EFBB434AFE2A0C32BB9281FFF21BEC`.
- P1 candidate implemented on `codex/screenshot-vision-v1`: default/persisted `screenshotHotkey`, legacy-safe per-LLM `multimodal`, settings checkboxes and independent hotkey recorders, recorder cancellation/close cleanup, and save failure feedback. Focused unit and isolated Electron settings checks pass; details in `docs/evidence/screenshot-vision-p1.txt`. P1 audit 2 passed. P2 registration is still required for the screenshot hotkey to trigger an action.
- P1 audit 1 failed on F-001; original audit retained unchanged at `docs/audits/screenshot-vision-p1-1.json`. Repair snapshots the recorder field before scheduling its delayed feedback cleanup. The Electron check now runs that queued callback after capture teardown and passes; repair evidence is in `docs/evidence/screenshot-vision-p1-repair.txt`. Correction: the prior P1 evidence Plan hash line contained a transcription error; verified Plan SHA-256 is `93AD032E4D9715800B9CDE713DBF305FDB06C6554DE9A5656568EA684DAFAE67` (Spec SHA-256 remains `05355AD48521BA5B2F622A6FF0A769BB77EFBB434AFE2A0C32BB9281FFF21BEC`). P1 audit 2 passed.

- VB-P1: clean Luna audit 2 PASS for candidate 5acb293; audit SHA256 5D4AA5F843799F1ACA7220B919F4F6C6992457FB10A453CFE77819C66E732EF2. Prior failure 1 retained; delayed-recorder callback repair verified. No provider calls. Next P2.
- P2 implemented on base `73fa033bc3303bda493ca185b5ea3dc9d417f030`: extracted an adapter-driven transactional dual-hotkey manager, preserved the existing voice callback, added a screenshot-only not-ready callback, and routed save/recorder-close/shutdown through owned registrations. Registration failures leave the config and persistence untouched; settings saves that change hotkeys while capture is suspended are rejected. Focused evidence and checks are in `docs/evidence/screenshot-vision-p2.txt`. P2 candidate awaits fresh Luna audit before P3. No provider calls or credential reads.

- VB-P2: clean Luna audit PASS for 86d7100; audit SHA256 E1559B3D839EC0734877033CC6702577807CEC6DF4FC1EF036FD6C396EE72BDA. Focused dual-hotkey, settings, voice and renderer checks pass. No provider calls. Next P3.

- P3 implementation and parent reconciliation: screenshot controller/selector/geometry and identity-safe Windows native fallback completed. Parent runtime observed correct magenta crop and mixed-DPI/gap pixel composition; independent Luna behavioral tests pass. Parent also repaired legacy F8/F12 modifier-free accelerator regression (R01) and early-abort side effects. Details: evidence/screenshot-vision-p3*.txt. P3 plus R01 repair await fresh audit. No provider calls.

- VB-P3 audit 1 FAIL retained: requested stronger cross-monitor interaction evidence. Parent Computer Use exposed work-area clipping and fixed fullscreen behavior, and normalized Windows selection to physical pixel coordinates. Real dual-monitor marker capture plus cross-window production IPC now passes; native Computer Use drag passes on the primary screen. Tool rejects cross-window destination coordinates, recorded explicitly under S01 in p3-supplement. No unsupported input bypass, no model calls.

- VB-P3/R01 audit 2 PASS for 896c305; audit SHA256 31B47BB6333CBA6E5B01DAA70206B973EBBD3C1DF65D098E4401F77178CFC5D3. Physical dual-monitor source/cross-selector pixel proof and native primary drag verified; cross-window OS drag limitation explicitly retained under A05/S01. Next P4. Provider calls still zero.

- P4 candidate: added a single-call PNG vision transcription method with strict final-content extraction, timeout/abort support, dedicated extraction prompt, and explicit synthetic-token image validation. Existing text ping and ASR paths remain unchanged. Focused model, thinking, config and Electron settings tests pass; details in `docs/evidence/screenshot-vision-p4.txt`. No provider/network calls or real key/profile reads. Candidate awaits fresh independent Luna audit.

- P4 parent reconciliation: existing llm settings validation now dispatches to vision probe when multimodal is checked; new behavioral IPC route test passes alongside model vision/thinking and production settings tests. No provider calls. Candidate awaits clean P4 audit.

- VB-P4 audit PASS for 57d33cb; audit SHA256 3DA32E14831EDF956836E7517EFB626E3654882DB35DDE2F581AE64D4B8DF9AC. Vision, IPC routing, thinking and settings checks pass. Parent prepared synthetic fixture gate (6 live requests maximum) and inspected only active-provider metadata after data gate: model mimo-v2.6-flash, configured credential present but not decoded/used, legacy multimodal false. Provider requests remain zero. Next P5.

- P5 implemented by Luna then parent-finished after stream errors; all35 unit files and production localhost Electron integration pass. Parent fixed snapshot ownership, observer/capture recovery and test-fixture wait/show issues. New evidence p5*.txt. Live round1=6 calls retained, manual quality review found ignored noThinking and appearance noise; source Plan/user repair authorization supports frozen Spec-v2 access-only revision (originalSpec remains immutable), max8 total6+2 no retries/counter reset. Targeted round2=2 HTTP200 calls confirms fixes (code3.676s, instruction1.727s). User profile unchanged; only synthetic images sent. P5/repair awaits clean audit; P6 runtime/package pending.
