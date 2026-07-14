---
name: assess-refactor
description: Assess whether a code refactor preserves behavior, reduces meaningful complexity, and improves the cost of likely future changes. Use when reviewing a refactor, comparing an implementation before and after, deciding whether a refactor is worth merging, or producing a concise refactor report for a pull request.
---

# Assess Refactor

Produce an evidence-based report that helps a reviewer decide whether a refactor is worth merging. Treat line counts and automated complexity scores as supporting signals, not proof of simplicity.

## Establish the Comparison

1. Identify the exact before and after revisions, commits, branches, or files.
2. Confirm which changes are part of the refactor.
3. Separate feature work from refactoring. Do not count new capability code as evidence that the existing implementation became simpler.
4. Separate production code, tests, generated code, vendored code, fixtures, snapshots, lockfiles, and formatting-only changes.
5. State any ambiguity in the comparison scope before drawing conclusions.

Do not modify implementation code while assessing it unless the user explicitly asks for fixes.

## Inspect the Refactor

Read the representative implementation before relying on aggregate metrics. Determine:

- What responsibility or workflow was difficult before.
- Which concepts, modules, interfaces, and dependencies changed.
- Which duplication, branches, states, or special cases were removed.
- Which abstractions, indirection, configuration, or runtime behavior were introduced.
- Whether ownership and dependency direction became clearer.
- Whether likely future changes became more localized.

Pay particular attention to complexity hidden by a lower line count, including generic frameworks, reflection, callbacks, event chains, base classes, implicit registration, global state, and configuration-driven control flow.

## Verify Behavior Preservation

Use "No intentional behavior changes" unless equivalence was formally established. Do not accept an unsupported claim that no functionality was lost.

Gather applicable evidence:

- Run existing tests without modifying them.
- Identify tests removed or substantially rewritten and explain why.
- Add or request tests for previously implicit behavior when coverage is insufficient.
- Compare public API signatures, schemas, serialized output, snapshots, or request and response behavior.
- Check compatibility, migration, performance, and resource constraints when relevant.
- List behavior that cannot be verified automatically.
- List every intentional behavior difference, including ordering, error, timing, and fallback changes.

Record exact commands and results. Do not summarize verification only as "CI passes."

## Measure the Structural Delta

Use the same scope, tool, and configuration for before and after measurements. Use `N/A` when a metric is not relevant rather than inventing a value.

Always collect when practical:

- Production lines added and deleted.
- Test lines added and deleted.
- Production files before and after.
- Files added, deleted, additions-only, deletions-only, and modified both ways.
- Public API members before and after.
- Direct internal dependencies before and after.
- Duplicate implementations before and after.
- Explicit special cases before and after.

Collect when relevant:

- Modules, classes, functions, or components.
- Conditional branches, maximum nesting, or cognitive complexity.
- Configuration options and extension points.
- Runtime states or variants.
- Database queries, network calls, or serialization steps.
- Build output, startup time, latency, allocations, or memory use.

Apply these counting rules:

- Keep production and test code separate.
- Exclude generated, vendored, fixture, snapshot, lockfile, and formatting-only changes from code line counts.
- Count public APIs at the external or cross-module boundary affected by the refactor.
- Count a dependency when the assessed unit directly imports, calls, or relies on it.
- Count a special case when a distinct condition, exception, mode, or compatibility path changes normal control flow.
- Explain how duplicate implementations were identified.
- Explain every materially worse metric rather than hiding it in a net score.

Do not calculate a single "simplicity score." Such a score hides tradeoffs and is easy to optimize without improving the design.

## Compare Conceptual Complexity

List the concepts a developer must understand to safely change the affected area before and after. Include relevant:

- Coordinators, registries, adapters, strategies, pipelines, and factories.
- Runtime states and lifecycle phases.
- Configuration layers and fallback rules.
- Cross-module protocols and ownership boundaries.
- Caches, queues, synchronization rules, and consistency models.

Judge whether new concepts replace more complicated rules, dependencies, duplication, or states. Do not assume fewer named types means lower conceptual complexity.

## Test Extensibility with a Scenario

Choose one or two likely future changes grounded in a roadmap, repeated request, existing variation, or clear domain need. Do not choose hypothetical scenarios merely because the new design handles them well.

For each scenario, compare before and after:

- Existing files that must be modified.
- New files that must be added.
- Existing modules that must be understood.
- Central conditionals or registries that must be edited.
- Public API changes required.
- Approximate implementation size.
- Tests required or affected.

Determine:

- Whether the change stays inside the owning module.
- Whether existing implementations remain untouched.
- Whether types or tests guide the developer to every required change.
- Whether the extension point permits invalid or unsupported combinations.
- Whether debugging becomes more indirect.

Prefer a small spike, representative diff, or test implementation when extensibility is the main justification. Otherwise state assumptions behind the estimate.

## Identify Costs

Explicitly list complexity introduced by the refactor:

- New abstractions or indirection.
- Runtime dispatch or allocation overhead.
- Generic types or advanced language features.
- Configuration or registration requirements.
- Harder code navigation, stack traces, or debugging.
- Migration and compatibility layers.
- New invalid states, ordering constraints, or failure modes.

Accept "None" only for a genuinely mechanical simplification and explain why.

## Select a Verdict

Choose exactly one:

- **Clearly simpler**: Meaningful structural or conceptual complexity was removed, with strong behavior-preservation evidence.
- **Tradeoff justified**: Some complexity increased, but a concrete and likely extension, correctness, or operational benefit outweighs it.
- **Mostly neutral**: The structure changed without enough demonstrated benefit to justify migration and regression risk.
- **More complex**: The added concepts, coupling, indirection, or change cost exceed the demonstrated benefit.

Recommend merging a refactor only when the verdict is **Clearly simpler** or **Tradeoff justified**. Never base the verdict primarily on net deleted lines.

Use this review guide:

| Dimension | Favorable evidence | Warning signs |
| --- | --- | --- |
| Behavior | Existing tests remain valid; outputs or APIs are compared | Tests were rewritten to match the new implementation; paths remain unverified |
| Comprehension | Fewer rules, concepts, states, or code paths | Fewer lines hide denser abstractions or implicit control flow |
| Locality | Likely changes affect fewer owning modules | Shared base types or registries change for every extension |
| Coupling | Dependencies are removed or point toward stable boundaries | New cross-package imports, callbacks, events, or global state |
| Duplication | One authoritative implementation replaces true copies | Unrelated behavior is joined to create superficial reuse |
| Flexibility | Concrete likely changes become smaller and safer | Generic machinery supports speculative requirements |
| Operations | Performance and failure behavior stay stable or improve | New caching, concurrency, reflection, or runtime dispatch appears |
| Testability | Tests use smaller, stable boundaries | More mocking or implementation-aware tests are required |

## Write the Report

Keep the completed report short enough to review in a few minutes. Link to detailed evidence rather than embedding large diffs or command logs.

Use this structure:

```markdown
# Refactor Report: <name>

## Verdict

**<Clearly simpler | Tradeoff justified | Mostly neutral | More complex>**

<Two or three sentences explaining what was difficult, what changed, and why the evidence supports the verdict.>

## Scope

- Compared: <before revision> to <after revision>
- Included: <modules and responsibilities>
- Excluded: <feature work, generated code, unrelated changes>
- Intentional behavior changes: <none or list>

## Behavior Preservation

- Existing tests passing unchanged: <evidence>
- Tests added: <evidence>
- Tests removed or rewritten: <list and reasons>
- API or output comparison: <evidence>
- Unverified behavior and coverage gaps: <list>

## Structural Delta

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production lines of code | | | |
| Test lines of code | | | |
| Production files | | | |
| Public API members | | | |
| Direct internal dependencies | | | |
| Duplicate implementations | | | |
| Explicit special cases | | | |

| Change shape | Count |
| --- | ---: |
| Production lines added | |
| Production lines deleted | |
| Files with additions only | |
| Files with deletions only | |
| Files with both | |
| Files added | |
| Files deleted | |

Explain materially worse metrics here.

## Conceptual Delta

| Before | After |
| --- | --- |
| <concept or rule> | <replacement or removal> |

## Extensibility Scenario

**Scenario:** <likely future change>

| Measure | Before | After |
| --- | ---: | ---: |
| Existing files modified | | |
| New files added | | |
| Existing modules to understand | | |
| Central conditionals or registries edited | | |
| Public API changes | | |
| Approximate implementation size | | |
| Tests required or affected | | |

<Explain locality, invalid states, debugging cost, and assumptions.>

## Costs and Tradeoffs

- <complexity introduced>

## Representative Change

- Before: <link or short description>
- After: <link or short description>
- Significance: <why this represents the usual developer workflow>

## Verification

- `<command>`: <result>
- Manual checks: <result>
- Checks not run: <list and reason>

## Recommendation

<Merge, revise, or decline, with the smallest required follow-up.>
```

## Reporting Rules

- Prefer evidence over adjectives such as "cleaner," "maintainable," or "flexible."
- Compare the same scope before and after.
- Report unfavorable evidence as clearly as favorable evidence.
- Measure likely extensions, not maximum theoretical flexibility.
- Treat abstractions, configuration, and indirection as explicit costs.
- Cite representative files and lines for important claims.
- State uncertainty instead of filling gaps with estimates.
