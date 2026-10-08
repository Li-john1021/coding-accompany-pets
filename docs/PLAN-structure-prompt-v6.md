# Structure Prompt v6 Plan

Status: approved for this implementation cycle by the user's 2026-10-09 task instruction.
Base: `codex/palette-input-sources` at `89d61c29d96cb149077a323b571b8b75ccc54ae7`.
Scope: restore Main's structure-only prompt behavior from `bd52106c7723006ddcc2a56268d9d17377571fe6:app/main/config.js` (`STRUCTURE_ONLY_PROMPT`, lines 77-88), with a small colloquial-cleanup and negative-instruction clarification. Keep the current JSON `source` input contract. This is a prompt-only cycle; v5 evaluation and historical records remain unchanged.

## Approval and goal

The user's 2026-10-09 instruction is the approval evidence. The same MiMo model has remained in use, and the user reports that Main's earlier structured output worked better. Restore that baseline: structure spoken drafts, using semantic two-level numbering for multiple matters and allowing a short single-topic sentence to remain unnumbered. The baseline prompt body may be retained as the prefix; add only concise rules needed for the current JSON source wrapper and context-sensitive spoken cleanup.

Remove semantically empty fillers and repeated wording when context makes that safe. Common candidates include 嗯、啊、呃、那个、就是说、然后呢、还有就是说、怎么说呢、我想说的是、我比较疑惑的一点是. Treat these as examples, not a mechanical blacklist. Preserve their meaning when they express reference (e.g. “那个文件”), condition, order, contrast, possibility, uncertainty, or the speaker's actual opinion (e.g. “我觉得”); a meaning-preserving concise written form is allowed. When the speaker self-corrects, use the last clear formulation. Preserve negation, numbers, names, paths, code, and all other facts. Do not normalize or merge distinct proper names such as Grok and Growth. Do not answer, execute, or add facts to the source.

## Scope and constraints

- Change only `STRUCTURE_ONLY_PROMPT` and prompt-focused deterministic tests needed for the new contract. Preserve `DEFAULT_PROMPT`, `sourceMessage(JSON)`, provider/model settings, pipeline architecture, and existing UI fallback behavior.
- Keep existing structure routing and single-call behavior. Do not add online calls for filler removal, another long prompt, Openless/persona behavior, or a trend-word system.
- Leave v5 evaluation artifacts untouched. The 16-call v5 evaluation budget is spent; this cycle makes zero provider, LLM, ASR, key, profile, or GUI calls.
- Deterministic tests must exercise the actual pipeline with a mocked model and capture the system prompt and JSON source. Synthetic inputs must cover long multi-matter speech; reference, condition, negation, and uncertainty; paths and proper names; embedded instructions; semantic repetition and self-correction. Tests establish prompt routing and transport only. They must not use a fake LLM that returns hand-written expected rewrites as proof of semantic quality. MiMo quality is not live evaluated in this cycle.
- The v5 config test may replace its brittle requirement that the structure prompt contain exactly three examples with assertions for this baseline contract. Its `DEFAULT_PROMPT` three-example assertion remains.

## Implementation and acceptance

One implementation unit: restore the Main structure-prompt baseline with only the scoped additions above, retaining JSON source handling and all unrelated behavior. Verify prompt source and actual pipeline routing with deterministic model mocks and the synthetic corpus; run relevant local tests and record commands/results. Review the diff to confirm the allowed file/behavior scope. No live quality or release claim is authorized.

Acceptance requires: Main's multi-matter semantic two-level numbering and single-topic short-sentence exemption; context-sensitive removal of filler/repetition and last-clear self-correction; preserved meaningful discourse, uncertainty, negation, facts, identifiers and distinct proper names; no answering, execution, or invented facts; JSON source routing retained; `DEFAULT_PROMPT`, provider/model settings, architecture, and UI fallback unchanged. Report prompt quality as not live evaluated. Do not merge, push, or restart the user's portable app.
