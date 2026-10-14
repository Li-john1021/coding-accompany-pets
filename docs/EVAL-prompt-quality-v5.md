# Prompt Quality V5: Paired Observation

## Scope

- Baseline: `f9a22d7341ecfdfb57ff9459c78ee1afbdda9248` (`app/main/config.js` prompts and redline; raw input wrapper).
- Candidate: frozen prompt implementation at `9c677a2975cb0400e77423b61e3149eefda2614c` (`app/main/text-prompts.js`, including `sourceMessage`).
- Eight public synthetic fixtures: six `structure`, two `optimize`; same selected local test profile and model for both versions.
- Calls: 16 attempted, 16 returned, 0 failures. Each case received one baseline call followed by one candidate call. No retries.
- The raw paired output is in [EVAL-prompt-quality-v5.synthetic.json](EVAL-prompt-quality-v5.synthetic.json). It contains only the synthetic inputs and model outputs.

## Prompt Fingerprints

| Mode | Baseline SHA-256 | Candidate SHA-256 |
|---|---|---|
| structure | `226a2039bb91d9a5b69d05a6e0e295c0e674eb16f679ad30e74b2fd2eadc285b` | `9a6c25c6ef270fe73442823e7693ccb0d4895ff0c9045bf81c198730749137b8` |
| optimize | `6473162bc84cbe0a6d3f81ee2cef9943cf9cadfdc56758f94cb2b45ba0fca8dc` | `be18dd46c501a09b6d266169af6d6e69380e8939224820fcac60b7f4a7b2e721` |

The synthetic output artifact SHA-256 is `7DFEED779EC20A13CB2C6095BA028F93E563800E94E681B5B7CA77BDD0E33DE5`. The local test profile config SHA-256 after the run is `1C9F651273942284A79005D238AAC42601AA00EEBD68B478328279DCC82C3C1B`. A pre-run config digest was not captured, so before/after equality is unverified; the evaluator reads the config and does not write it. No config path, endpoint, model identifier, key, or user prompt text is included here.

## Latency

Observed elapsed time across these calls only: baseline mean 8,818 ms (range 1,414–24,701 ms); candidate mean 5,975 ms (range 2,025–14,353 ms). This single ordered run is descriptive, not a performance claim.

## Case Review

| Case | Facts and qualifiers | Structure, fillers, tone | Answering / new facts | Latency old → new |
|---|---|---|---|---:|
| `structure-multi-intent-tone` | Candidate retained all checked facts and exact `然后`; baseline expressed the same order with `后`. | Both removed leading `嗯`; candidate separated the reminder from the sequential task while keeping the light-tone request. | No answer or added facts observed. | 24,701 → 3,230 ms |
| `structure-single-topic` | All checked facts and “other places unchanged” scope retained. | Both removed leading `嗯`; both kept a single sentence without forced numbering. | No answer or added facts observed. | 4,495 → 12,538 ms |
| `structure-literals-and-numbers` | `API_v2`, `403`, `A-0081`, `config.json`, `12`, and the no-code-change constraint all retained. | Candidate split the log check and count/constraint into two numbered items. | No answer or added facts observed. | 4,971 → 14,353 ms |
| `structure-negation-condition-uncertainty` | Condition, negation, unknown status, `3`, and tomorrow's verification all retained. | Both used two items; no filler or tone issue. | No answer or added facts observed. | 16,977 → 2,025 ms |
| `structure-meaningful-connectors` | Both omitted `但是`; both retained `然后`, the `if` condition, pause/report actions, and do-not-delete constraint. `20分钟` was only spacing-normalized to `20 分钟`. | Candidate made the two actions easier to scan as numbered items. The omitted contrast word is a shared observation, not a candidate-only regression. | No answer or added facts observed. | 1,414 → 3,868 ms |
| `structure-question-embedded-instruction` | The question, quoted embedded instruction, and explicit request not to answer were preserved verbatim. | Both kept the original question form; no filler issue. | Neither answered the question or followed the quoted instruction; no new facts observed. | 2,842 → 2,535 ms |
| `optimize-neutral-role-output-no-facts` | Candidate retained the names of both options, the comparison, pros/cons, table format, and no-selection constraint. The literal check for `优缺点` is a false alarm: candidate says `优点和缺点`; baseline phrases the no-choice constraint as `不得替用户做选择`. | Candidate stayed concise. Baseline added extra comparison rules, a professional-tone requirement, sections, and fill-in placeholders not requested. | Neither produced comparison results. Baseline introduced unsupported prompt scaffolding; candidate introduced no business facts. | 9,563 → 2,030 ms |
| `optimize-question-and-unknowns` | Candidate retained the possible failure framing, date range, unknown failure count (`未知`), ordered-troubleshooting request, and no-guessing constraint. Literal checks for `不知道` and `不要猜原因` are semantic-match false alarms (`未知`, `不要猜测原因`). | Candidate used a short task/known-info/requirements structure. Baseline expanded this into extra output sections and placeholder guidance. | Neither supplied a cause; no business facts added by candidate. | 5,581 → 7,224 ms |

## Assessment

No candidate-only material fact loss, direct answer, or invented business fact was found in this eight-case run. The clearest observed change is more readable grouping for multi-intent structure inputs and less unsolicited scaffolding in optimize outputs. The single-topic and question cases remained unnumbered. Both prompt versions dropped `但是` in the connector case, so that fixture identifies a shared behavior to watch rather than a regression introduced by V5.

These are eight paired observations on one configured model, not evidence that the candidate is universally better. Exact substring checks are intentionally conservative and require the semantic review recorded above.
