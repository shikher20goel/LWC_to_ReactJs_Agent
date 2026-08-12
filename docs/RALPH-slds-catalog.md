# Ralph loop — SLDS catalog expansion

## Why this task, and not the component migration

`research/02` Part 11 puts Ralph at **step 8**, after evals and a golden
corpus, and warns that "Ralph over unverifiable work is a token bonfire."
That still holds for component migration, which is blocked on org source.

SLDS catalog expansion is a different shape of problem, and it is the one
Ralph is actually good at:

| Ralph needs | This task |
|---|---|
| Well-defined success criteria | `npm run styles` exits 0 — zero unmapped classes |
| Testable output | `npx jest styles` — every mapping asserted |
| Repetitive, bounded units of work | one SLDS class family per iteration |
| State on disk, not in conversation | `catalog/slds.xml` + the generated report |
| Failure is visible, not silent | unmapped classes fail the build |

The verification is mechanical, so a wrong mapping cannot pass unnoticed. That
is the whole precondition for looping.

## The loop

```
/ralph-loop "Read docs/RALPH-slds-catalog.md and do ONE iteration of the task
it describes. Output <promise>SLDS CATALOG COMPLETE</promise> only when
`npm run styles` exits 0 across every corpus AND `npx jest` passes."
--completion-promise "SLDS CATALOG COMPLETE" --max-iterations 25
```

## One iteration

1. Run `node codemod/styles-report.js <corpus> ` and read the **Unmapped** list.
2. Pick the **single highest-count** unmapped class.
3. Research its real CSS. Do not guess:
   - `research/11-slds-architecture.md` first — the verified scale lives there
   - then the SLDS source or lightningdesignsystem.com
   - if you cannot verify it, add it to `<unverified>` in the catalog with a
     note and move on. **Do not invent a value.**
4. Add ONE `<class>` entry to `catalog/slds.xml`.
5. Add a test to `codemod/styles.test.js` asserting the mapping, and a second
   test if the class has a trap (an `!important`, an asymmetry, a density
   interaction).
6. Run `npx jest styles`. If red, fix before continuing.
7. Commit with the class name in the message.

## Hard rules for this loop

These exist because each has a failure mode that still passes the build:

1. **Never invent a CSS value.** A plausible wrong value is worse than an
   unmapped class, because unmapped is reported and wrong is not.
2. **Never widen `component-owned` to silence an unmapped class.** That
   converts a visible gap into an invisible one. It is the single easiest way
   to make this loop produce a green build and a broken UI.
3. **Never mark a `slds-var-*` class as static-equivalent.** It is
   density-aware; a fixed value breaks Compact and nothing in dev shows it.
4. **Never edit a test to make a mapping pass** (CLAUDE.md rule 2). If the
   test is wrong, the mapping is probably wrong too.
5. **One class per iteration.** Batching hides which change broke what.

## Stop conditions

- `npm run styles` exits 0 on every corpus → emit the promise.
- Same class fails to verify twice → add to `<unverified>`, move on.
- Three consecutive iterations with no new mapping → stop and report; the
  remaining classes probably need a human decision, not another iteration.

## Scope

Catalog data only. Do **not** let this loop modify `codemod/styles.js`,
the oracle, or the component codemod — if a class genuinely cannot be
expressed by the catalog format, stop and say so rather than reshaping the
converter to fit one class.
