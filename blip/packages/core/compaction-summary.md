# Compaction summary generation (features 1–3)

The summary helpers consume a `CompactionPlan` and return one candidate. The
context manager owns choosing the retained boundary, deciding when to compact,
checking the complete replacement context, and installing the checkpoint.

## Behavior

- **Failure handling:** a provider error, incomplete response, or invalid summary
  discards the generated candidate. The deterministic fallback includes the
  original previous summary verbatim and every selected message's visible text,
  tool calls, and tool-result text. It does not infer completion or absence of
  blockers. Cancellation propagates without returning a fallback checkpoint.
- **History coverage:** all selected messages are processed chronologically.
  The former 120,000-character transcript limit and 12,000-character message
  limit now control batches and fragments, rather than discarding older messages
  or message suffixes. Tool errors are no longer cut at 2,000 characters.
  Fragment offsets allow split JSON records to be followed across requests.
- **Continuation quality:** each request updates the preceding checkpoint.
  The prompt explicitly preserves unfinished objectives, user corrections,
  permissions and prohibitions, decisions, exact identifiers, verification
  results, blockers, pending questions, and uncertainty. It distinguishes user
  instructions from assistant plans and tool evidence.

The generator accepts only text from a response with `stopReason: 'stop'` and
requires all requested Markdown sections, in order, with nonempty leaf sections.
This catches malformed or incomplete output; it does not prove factual accuracy.
The final checkpoint is returned only after every batch succeeds. If a later
batch fails, fallback starts from the original plan, not an intermediate summary.

## Integration contract

`helpers/compaction-summary.ts` uses the shared `summaryTokens` budget. Before
each batch it subtracts the summary prompt, the current checkpoint, the output
allowance, and a margin from the model window using the existing token estimator.
`maxSummaryInputChars` remains a transcript-only cap. Estimates remain heuristic.
If the previous checkpoint alone leaves no usable input room, generation fails
safely instead of truncating it. That case requires a separate recovery strategy.

`onModelCall` runs around each actual model request, with `finished` in a
`finally` block. `onUsage` receives each returned response, including failed
responses. A multi-batch compaction therefore produces multiple usage events.
The caller must validate the final candidate's size and reduction before saving
it, including file metadata and the retained conversation. A conservative
fallback may be larger than the original context and must be rejected then.

Images and non-text reasoning use explicit markers in this text-only pipeline;
the original transcript retains their payloads. No image contents are inferred.

## Tradeoffs and verification

Large histories require sequential model calls and repeated checkpoint updates,
which increase latency and cost and can accumulate semantic omissions. Small
histories still use one call. Full input coverage removes deterministic omission
before the model; real-model continuation evaluations are needed to measure
semantic retention. No live-model quality claim is implied by the unit tests.

Focused tests cover exact long-text coverage (including Unicode and tool error
suffixes), repeated checkpoints, later-batch failure, incomplete output,
cancellation, missing models, small-window request sizing, and oversized previous
summaries. Existing runtime and embedded-session fixtures return complete
structured summaries and handle variable numbers of summary calls.

For manual verification, continue a long conversation through multiple
compactions containing an early prohibition, a later correction, an unfinished
task, and a failing command. Check that the agent follows the corrected scope,
retains the prohibition, reports the failure accurately, and resumes the
unfinished task. Also interrupt compaction and verify that the last installed
checkpoint and original transcript remain available.
