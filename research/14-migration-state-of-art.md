# 14 — State of the Art in Automated / AI-Assisted Code Migration

**Date:** 2026-08-11
**Purpose:** Find techniques an LWC→React migration agent should adopt that our current stack does *not* already cover.
**Scope note:** This document deliberately does **not** restate what we already have (deterministic template-AST codemod, differential boundary-tree oracle with negative controls, LWC-semantics shim, static census with kill criteria, catalog-driven CSS conversion). It is written to find **gaps**.

**Evidence hygiene:** Claims sourced from a page I actually fetched are stated plainly. Claims I only saw in a search-engine snippet are marked **[snippet-only]**. My own reasoning is marked **[inference]**. Where a tool or claim could not be verified, I say so.

---

## 0. Executive framing

Three findings dominate everything else in this survey:

1. **Every serious effort splits the work into deterministic-discovery → LLM-transform → deterministic-validation, and the validation layer is where the engineering actually goes.** Google, Meta, Airbnb and Amazon all converge on this. We already have this shape. Our differential oracle is, on the evidence surveyed, *stronger than what most published efforts used* — Google validated with build+existing tests+human eyeball; Airbnb validated with jest/lint/tsc pass. Neither compared old and new behaviour directly. **We should stop looking for a better oracle architecture and start looking for missing observation channels.**

2. **The oracle's blind spots are not in the tree — they are in everything that is not the tree.** A normalised component-boundary tree diff is silent about: computed style, event/effect traces, call ordering, lifecycle timing, focus, computed accessibility semantics, and anything outside the fixture set. That is where our real defect escapes will come from. Section 3 is built around this.

3. **The economics are dominated by the long tail and by review throughput, not by the first-pass conversion rate.** Airbnb's 75%→97% took *more calendar time* than the initial 75% pass. Meta reportedly treats reviewer capacity as loop infrastructure. Google's split was 35.97% LLM-only / 38.48% LLM-then-human / 25.55% human-only — i.e. **two thirds of changes touched a human**. Our census/kill-criteria machinery is the right instinct; it should be tuned by the long-tail data, not by aspiration.

---

## 1. Codemod platforms: what mature platforms give you that a hand-rolled codemod does not

### 1.1 OpenRewrite / Moderne

The most architecturally serious of the platforms.

- **Lossless Semantic Tree (LST)** rather than an AST: captures structure, semantics, *type attribution*, comments and formatting, so transformations print back byte-faithfully and match on *resolved type* rather than text.
- **Recipes** are deterministic, composable programs over the LST. Same input → same output, every time, explicitly contrasted against LLM non-determinism.
- **Composition**: recipes chain; the idiom is many narrow recipes rather than one sweeping transform.
- **Dry-run + structured diff preview** before any PR opens.
- **Data tables**: recipes emit *structured side-channel data* (not just diffs) — e.g. `FindLstProvenance` emits a table of which tooling version produced each LST. This is the provenance mechanism.
- **Moderne** pre-computes LSTs for every repo and runs recipes in parallel across thousands — one semantic model of the estate.
- 2026 direction: coding agents call the *same deterministic recipes* through MCP (Trigrep / Prethink), and author new recipes when none exists. The agent's job is recipe selection and authoring, not editing code directly.

**Relevance to us:** OpenRewrite is JVM/polyglot but not a realistic host for an LWC-template→JSX transform **[inference]**. The transferable ideas are **recipe composition granularity**, **dry-run-before-PR**, and above all **data tables as first-class output**.

### 1.2 GritQL / Grit.io

- Rust + Tree-sitter, declarative pattern language; any valid JS snippet in backticks is a valid pattern.
- Reproducible AST-based transforms, no API/token cost, claimed millions of LoC in seconds; used across a claimed 80M+ LoC.
- GritQL is open source and has been vendored into Biome. **The commercial status of Grit.io as a standalone product in 2026 could not be verified from the sources fetched — treat any "platform" claims with caution.**

### 1.3 codemod.com

The most active platform in 2026 for JS/TS migrations specifically.

- **JSSG** (JavaScript ast-grep) is now the primary transformation engine.
- **Workflows**: YAML-configured multi-step migrations with **matrix strategies** and **manual approval gates**.
- Terminal UI for workflow runs: inline logs, per-task trigger/retry/cancel, **runtime dry-run controls**, shell steps that can *require approval* in interactive runs.
- `npx codemod ai` (March 2026) installs an MCP server + `/codemod` skill into Claude/Cursor/Codex/Goose — i.e. the platform's pitch is "give agents compiler-aware code intelligence" rather than "replace the agent".
- ESLint itself adopted Codemod for its migrations (July 2026). **[snippet-only]**

### 1.4 ast-grep vs jscodeshift — the honest limitation

- **ast-grep indexes only the AST. It has no variable scopes, no type information, no def/use, no control- or data-flow.** This is documented by the project itself.
- **jscodeshift path objects carry parent and scope information** — strictly more semantic context, at the cost of speed and single-language scope.

**Relevance to us:** our template-AST codemod, if it resolves LWC template bindings against the class's tracked/api/wire members, already carries *more* semantic context than ast-grep offers. Migrating onto ast-grep/GritQL would be a **downgrade in semantic power** in exchange for speed we don't need at our scale **[inference]**.

### 1.5 Meta and Google orchestration

- **Google Rosie**: shards a master change along project/ownership boundaries into atomically-submittable pieces, then runs each shard through an *independent* test → mail → review → submit pipeline. Rosie **caps the number of outstanding shards**, runs at lower priority, and negotiates load with shared test infrastructure.
- **Meta CodemodService**: reportedly requires review of *every* automated diff without exception, and treats reviewer throughput as loop infrastructure (ML-based diff routing → reported 17% increase in review actions/day). **This is second-hand via a vendor guide, not a Meta primary source — flagged as unverified.**

### 1.6 What a platform gives that a hand-rolled codemod lacks — the actual list

| Capability | Do we have it? | Verdict |
|---|---|---|
| Recipe composition (many narrow, chained) | Partially — one codemod pipeline | Worth restructuring |
| Dry-run + structured diff preview | Unknown | Cheap, adopt |
| **Data tables / structured provenance per unit** | **No (census is static, not per-run)** | **Adopt — highest platform-derived value** |
| Sharding into independently-gated units | Partially (per-component) | Extend to PR/review level |
| Outstanding-shard caps + load negotiation | No | Adopt as review-queue cap |
| Approval gates on risky steps | Via kill criteria | Formalise per-tier |
| Type/scope-aware matching | **Yes, and better than ast-grep** | Keep |
| Conflict handling on re-run / rebase | Unknown | Worth checking |

---

## 2. Published AI migration efforts at scale

### 2.1 Google — *Migrating Code At Scale With LLMs At Google* (FSE 2025, arXiv 2504.09691)

The single most useful paper for us. Architecture:

| Layer | Mechanism | Determinism |
|---|---|---|
| Change-location discovery | **Kythe** code index; recursive reference discovery to **5 hops** | Deterministic |
| Categorisation | Regex + heuristics into relevant / irrelevant / not-migrated | Deterministic |
| Modification | Internal Gemini (DIDACT), **temperature 0.0**, prompting only, no fine-tuning | Non-deterministic |
| Validation | 6-step pipeline (below) | Deterministic |
| Final gate | Human eyeball in Critique + code-owner acceptance | Human |

**The six-step validation ladder, in order** (failure halts the remaining checks and flags for manual work):
1. **Success** — LLM responded without error
2. **Whitespace** — the change modified actual code, not just formatting
3. **AST parser** — changed file parses, *and its AST differs from the original*
4. **Punt** — the LLM confirms the change was necessary
5. **Build** — compiles
6. **Test** — regression tests pass

**Non-determinism handling:** three modification rounds per file; a *random* one of the successful attempts is chosen.

**Results:** 39 migrations, 3 developers, 12 months, 595 code changes, 93,574 edits. **74.45% of changes and 69.46% of edits LLM-generated.** Split: LLM-only 35.97%, LLM-then-human 38.48%, human-only 25.55%. Developers self-reported ~50% time reduction — the paper explicitly says this is *perception, not tracked data*.

**Failure modes worth internalising:**
- **Hallucination taxonomy**: reformatting only, comment-only changes, irrelevant changes. Note that step 2 (whitespace) and step 3 (AST-differs) exist *specifically* to catch the no-op/cosmetic failure class. **We should check that our pipeline has an equivalent no-op detector.** [inference]
- Context-window overflow on large files failed at step 1.
- **Pre-existing test failures blocked validation** — a dirty baseline poisons the gate.
- **Golden-file tests required manual updates** — a direct warning against golden-master approaches in a migration.
- Language coverage was uneven (worse on Dart than Java/C++/Python).

**Metric definitions worth stealing verbatim:**
- **LLMΔ** = Levenshtein edit distance between the baseline and the first LLM snapshot.
- **HumanΔ** = Levenshtein edit distance between the first LLM snapshot and the final human-modified version.
These two numbers, computed from git history, give a *quality* signal far better than a binary pass rate. See §5.

### 2.2 Airbnb — Enzyme → React Testing Library, 3,500 files

The most directly analogous effort (React, component-level, semantics-preserving-but-not-textual).

- **Pipeline as a state machine** with per-file steps: Enzyme refactor → Jest fixes → lint → TypeScript → done. Each stage gated by validation before advancing.
- **Brute-force retry over prompt perfection.** Validation errors fed back into the next attempt along with current file state. Most simple/medium files succeeded within **10 attempts**; long-tail files needed **50–100**.
- **Context selection beat prompt engineering.** Prompts ran 40k–100k tokens and pulled ~50 related files: the component under test, the test file, current validation failures, *sibling tests from the same directory* (to preserve team-specific idiom), migration guidelines with few-shot examples, and known-good passing tests from the same project. The team's stated conclusion: **choosing the right related files mattered more than perfecting the prompt.**
- **"Sample, tune, sweep"**: cluster the failures → pick 5–10 representative failures → fix prompt/scripts → validate on the sample → re-run the whole remaining set → repeat. Breadth-first over depth-first.
- **Numbers:** 4 hours → 75% (2,625 files). 4 days of tuning → 97% (+1,225). 1 week manual → 100% (~100 files). **6 weeks total vs an 18-month manual estimate.**
- **What resisted automation:** intricate test state setup, excessive indirection between test logic and assertions, complex mocking patterns absent from the examples.

**Critical caveat for us:** Airbnb's validation was *pass/lint/compile*, **not behavioural equivalence**. A migrated test that passes proves the test runs, not that it asserts the same thing. Our differential oracle is a strictly stronger gate than Airbnb had. **[inference]**

### 2.3 Meta — Assured LLMSE / TestGen-LLM

The framing is the valuable part: **"Assured Offline LLM-Based Software Engineering"** — the LLM sits inside a workflow that delivers only improvements carrying *verifiable guarantees of both enhancement and non-regression*. Candidate outputs pass a **filter funnel**, and anything that does not demonstrably improve on the original is discarded.

Reported funnel on Instagram Reels/Stories: **75% built, 57% passed reliably, 25% increased coverage, 73% of surviving recommendations accepted by engineers.** **[snippet-only — from secondary coverage of arXiv 2402.09171, primary not fetched]**

**Transferable principle:** every generated artefact must clear a *measurable improvement-or-parity* filter, and the funnel's per-stage yield is itself the headline metric. That is exactly the shape our kill criteria should take.

### 2.4 Amazon — Q Code Transformation / MigrationBench

- Q Code Transformation: analyse → rewrite → build-and-fix iteration, **holding changes until a human reviews the code together with build and test results**.
- 2025 addition: *selective transformation* — natural-language chat and/or input files to tailor the transformation plan, i.e. human steering of the plan layer.
- The widely-quoted "5 people upgraded 1,000 production apps Java 8→17 in 2 days, ~10 min/app" figure comes from **AWS marketing material and was not verified against any primary engineering writeup. Treat as unverified.**
- **MigrationBench** (arXiv 2505.09569, Amazon Science): 5,102 repos full / 300 selected, Java 8 → 17/21, with an automated evaluation framework. Their **SD-Feedback** method with Claude 3.5 Sonnet v2 hit **62.33% pass@1 for "minimal" migration and only 27.33% for "maximal"**. **[snippet-only]** — The gap between minimal and maximal is the honest signal: *make-it-compile* is roughly 2.3× easier than *make-it-idiomatic*. **[inference] Our tiering should encode the same distinction — a "renders identically" tier and a "idiomatic React" tier are different products with different success rates.**

### 2.5 2026 research directions

- **Environment-in-the-Loop** (arXiv 2602.09944, Feb 2026): argues that static analysis of the *environment* is the neglected half of migration; agents should actively build environments and interact with them (install, retry, correct, test). **Only the abstract was retrievable — architecture, benchmarks and results could not be verified.**
- **MatchFixAgent** (arXiv 2509.16187): see §3.7 — the most directly useful verification architecture in the survey.
- Several 2026 arXiv IDs surfaced in search (2604.x, 2605.x, 2606.x, 2607.x on mutation-guided regression diagnosis, round-trip mutation testing, agent harnesses). **I did not fetch these; do not rely on them.**

### 2.6 Salesforce-specific context (important, and not in our earlier docs)

**Salesforce Multi-Framework went GA in July 2026.** This is directly load-bearing for this project:

- A **framework-agnostic runtime on the Headless 360 Platform** — React apps run natively.
- They execute on a **separate origin**: `https://<org>--<namespace>.<instance>.my.salesforce.app/app/c__<bundle>`. Same-Origin Policy isolates each app; no cross-app cookie/storage access.
- Available APIs: **GraphQL via the Data SDK** (`@salesforce/platform-sdk`), **Apex** invocation, and **UI APIs** for user context — with **no auth/token management required**.
- **Microfrontends** — embedding externally-hosted React components inside Lightning *alongside* LWC with event passing — is described as **future, not yet available** in the GA post. Angular support signalled.
- **Salesforce ships no LWC→React migration tooling.** The GA post's migration section covers only beta→GA SDK import and GraphQL refactors.

**Consequences for us [inference]:**
1. The separate-origin model means a React component **cannot** be dropped into a Lightning page next to its LWC ancestor today. This kills naive "shadow render side-by-side in a real org" verification (§3.8) and reinforces that our fixture-driven oracle is the right primary gate.
2. `@salesforce/platform-sdk` GraphQL is the *supported* data path — worth checking whether our TanStack Query shim should be re-pointed at it rather than at a hand-rolled Apex bridge.
3. Our shim's `enabled` guards should be checked against the actual SDK's subscription semantics.

---

## 3. VERIFICATION — the core section

### 3.0 What our oracle already proves, stated precisely

Rendering both implementations against identical fixtures and diffing normalised component-boundary trees proves: **for the fixture inputs exercised, at the observation points taken, the structural output visible at component boundaries — modulo the normaliser — is equal.**

Every word in that sentence is a limitation. The five quantifiers are the five gaps:

| Quantifier | Gap |
|---|---|
| "for the fixture inputs exercised" | **Fixture-space adequacy** — §3.2 |
| "at the observation points taken" | **Temporal/lifecycle behaviour** — §3.3 |
| "structural output" | **Computed style / visual** — §3.1 |
| "visible at component boundaries" | **Side effects: events, Apex, wire, navigation** — §3.4 |
| "modulo the normaliser" | **Normaliser blindness** — §3.6 |

### 3.1 Visual / computed-style regression — **our largest single gap**

**The evidence is unambiguous that DOM comparison does not cover style.** From the visual-testing literature: *comparing DOM snapshots does not mean the output in the browser is visually identical; DOM-based comparison only compares structure and basic HTML layout without considering styling aspects like colours and fonts.* And `semantic-dom-diff` — the closest published analogue to what we built — **explicitly strips `<style>` and `<script>` contents entirely.**

We have a **catalog-driven CSS conversion whose output is verified by nothing.** LWC's shadow-DOM style scoping (`:host`, `::slotted`, per-component scoping attributes) does not survive into plain React class names without semantic change. Specificity inversions, scope leakage into descendants, and SLDS token drift are all invisible to a boundary-tree diff **[inference]**.

Two options, and **they are not the same cost**:

**(a) Computed-style differential (recommended first).** At each boundary node the oracle already visits, also capture a whitelisted set of `getComputedStyle` properties (display, position, box model, colour, background, font, flex/grid, z-index, overflow, visibility) and diff them. This reuses the existing tree walk, produces a *readable* diff ("`.slds-card__header` padding-left 1rem → 0"), is far less flaky than pixels, and needs no browser-image pinning.

**(b) Pixel screenshot diff (advisory, second).** The literature is consistent about the flakiness sources: **CSS animations, dynamic content, and cross-OS font rendering / anti-aliasing** — a Mac baseline will fail on a Linux CI runner with unchanged code. Mitigations that are the accepted practice: run in the **Playwright Docker image**, pin Playwright version (browser build is pinned to the package version, which is what makes it deterministic), prefer **component-level over full-page** screenshots, and set **per-component thresholds** (common start point `maxDiffPixelRatio: 0.01`) rather than one global tolerance — teams doing this report ~80% less visual flake **[snippet-only]**.

Chromatic/Percy are the managed options; **Chromatic's TurboSnap** uses the bundler dependency graph to snapshot only stories affected by changed files, and it **waits for Storybook `play` functions to complete before capturing** — which makes interaction-state screenshots viable. **[snippet-only]** For a migration where *every* component changes, TurboSnap's savings largely evaporate **[inference]** — the cost case for a paid VRT service is weak here.

### 3.2 Fixture-space adequacy — measured, not asserted

The classic and correct critique of golden-master/characterisation testing is that it *"checks whether original behaviour is preserved **when adequate input space coverage exists**"* — and nothing in the method tells you whether it does.

Our negative controls prove the oracle **can** fail. They do not measure **how much** it can catch. Those are different claims and we are currently making the weaker one.

**Mutation testing is the correct generalisation of our negative controls.** Inject a catalogue of *migration-realistic* faults into the generated React and measure the kill rate:

- flip a conditional (`if:true` → `if:false` equivalent)
- drop an `iterator` key / reverse iteration order
- drop one prop from a child element
- change an event handler binding to a sibling
- swap `null` vs `undefined` vs `''` in a falsy-render guard
- delay/reorder an async resolution
- drop a `disabled`/`aria-*` attribute
- change a CSS class from the catalog to its near-neighbour

The literature is explicit that **coverage does not imply effectiveness** — high-coverage suites still miss subtle faults when assertions are weak — which is precisely why mutation score is the better adequacy criterion. Also relevant: LLM-generated assertions score better on mutation than EvoSuite's but the absolute numbers are low (~19% vs ~17%) **[snippet-only]** — a caution against trusting generated fixtures without measuring them.

**Deliverable: an oracle kill-rate score per component tier.** Fixtures that kill no mutants are dead weight and should be pruned or replaced; components whose kill rate is below threshold should be forced into a higher-scrutiny tier. This converts kill criteria from a static census heuristic into a measured one.

### 3.3 Noise-floor cancellation — Diffy's trick, and it is cheap

Twitter's **Diffy** runs three instances: a **candidate** (new code) and **two instances of known-good old code** (primary and secondary). It measures disagreement between primary↔secondary (pure noise, since both are known-good) and primary↔candidate. **If the two disagreement rates are about the same, the difference is noise and is ignored.**

This maps onto our oracle with almost no work: **render the original LWC twice** against the same fixture and diff those two trees. Any field that differs is non-deterministic (generated ids, timestamps, `Math.random`, iteration order of a Set, animation frame timing) and should be subtracted from the signal channel rather than hand-added to a normaliser ignore-list.

Two benefits:
1. It replaces *guessed* normalisation rules with *measured* ones — and guessed normalisation rules are the main way a differential oracle silently goes blind (§3.6).
2. It produces a defensible **oracle precision number**: "the noise floor is N fields per component; anything above that is signal."

This is the highest value-per-hour item in the whole survey. **[inference]**

### 3.4 Effect-trace differential — the second-largest gap

A boundary-tree diff observes the DOM. It does not observe:

- **`CustomEvent` dispatch** — name, `bubbles`, `composed`, `cancelable`, and `detail` payload. LWC components communicate upward almost exclusively this way; a React `onFoo` callback prop has *none* of these semantics. A parent listening for a composed event that no longer crosses a shadow boundary is a silent, total failure that renders identically.
- **Imperative Apex calls** — count, ordering, arguments. A React effect that re-runs on every render issues N calls where LWC issued 1. **The final DOM is identical.**
- **Wire adapter re-subscription** on reactive parameter change — our `enabled` guards are exactly the risk surface here, and nothing currently verifies them.
- **Navigation / toast / platform events.**
- **Cleanup on unmount** — LWC `disconnectedCallback` vs React effect cleanup. A missing unsubscribe is a leak that no render diff can see.

**Concrete technique:** instrument both harnesses to emit an ordered **effect log** — `(seq, kind, target, normalised-args)` — and diff the logs as a second channel alongside the tree. This is precisely the "domain-specific comparator" the shadow-testing literature insists on (*"simple JSON comparison misses equivalent but differently ordered results; build domain-specific comparators"*).

Prior art that this is a real and tractable technique: the **React-tRace** work validates a hook semantics by implementing components twice and comparing **side-effect ordering, reconciliation and event handling** between the two. **[snippet-only]**

### 3.5 Interaction sequences — property-based / model-based differential

Our oracle currently compares outputs of a *state*. Real defects live in *transitions*.

`fast-check` supports **model-based testing** (a command/model API) and there is an explicit UI-oriented derivative (`fast-check-frontend`) whose stated purpose is to *generate random user interaction sequences and verify components maintain their invariants*. **[snippet-only — I did not fetch the repo; treat the library as unverified, but the technique is standard and implementable directly on `fast-check`'s `modelRun`.]**

The migration-specific application is stronger than generic PBT: **we do not need to write an invariant.** The invariant is *"the original component is the model."* Generate a random sequence of interactions (click, type, prop change, resolve/reject the mocked Apex), replay the *identical* sequence against both implementations, and diff tree + effect log after each step. That is a differential model-based test, and it turns our single-shot oracle into a state-space explorer.

Cost is real but the marginal defect yield is likely the highest after §3.1/§3.4 **[inference]**.

### 3.6 Normaliser blindness — a self-audit we have not done

`semantic-dom-diff`'s option set is a catalogue of exactly the ways a tree differ goes blind: `ignoreAttributes` (globally or per-tag), `ignoreTags`, `ignoreChildren` (assert the tag exists but ignore its light DOM), `stripEmptyNodes` — plus unconditional removal of comments, `<style>`, `<script>` and SVG contents, and whitespace normalisation.

**Anything our normaliser drops is, by construction, a defect class the oracle cannot detect.** We should produce an explicit written inventory: for each normalisation rule, *what real defect would it hide*, and is that acceptable? Then check each entry against the measured noise floor from §3.3 — rules that the noise floor does not justify should be deleted.

The general risk is documented in the snapshot-testing literature and repeated in Playwright's own ARIA-snapshot docs: **"it can be tempting to accept changes to snapshots without fully understanding them, potentially hiding bugs."**

### 3.7 LLM-as-judge — only in one specific role

The evidence against LLM-as-judge as a *gate* is strong and specific:

- LLMs **frequently issue false negatives**, concluding correct implementations fail requirements. In an analysis of misjudgements, **hallucination was the single largest cause (33%)** — judges commented on wrongly-implemented statements *that do not appear in the judged function*, and on non-implemented requirements that *were* implemented. **[snippet-only]**
- Models can simultaneously suffer severe over-correction (high FN) and unsafe acceptance (high FP), **and the accompanying explanations may not faithfully justify the decision.**
- Reported ~80–85% accuracy in controlled settings; **>50% error rates on bias tests for frontier models in production.** **[snippet-only]**
- A dedicated ASE paper documents *systematic overcorrection in requirement-conformance judgement*. **[snippet-only]**

**But there is one role where an LLM in the verification loop is clearly justified — MatchFixAgent (arXiv 2509.16187) shows it.** Its architecture:

1. **Semantic Analyzer** — LLM analyses six properties *in parallel*: control flow, data flow, input/output, library API, exception handling, specifications. Crucially, **cheap deterministic similarity scoring short-circuits the LLM entirely** on ~25% (control flow) and ~35% (data flow) of decisions.
2. **Test Generator & Repair Agent** — uses the semantic reports to write **targeted differential tests** aimed at the *suspected* inequivalences, then attempts repair.
3. **Verdict Agent** — synthesises, and **weights test execution results as ground truth**.

Results: verdicts on **99.2%** of pairs (vs 71.6% for prior work); repairs **50.6%** of inequivalent translations (vs 18.5%), with **95.9%** of patches validated correct; **309s and $1.22 per case**. Ablation: removing semantic analysis dropped accuracy **42.3%** *while increasing* token use 5.2%. On hard disputed cases a bare LLM agent scored only 47.7%.

**The transferable lesson is the division of labour: the LLM proposes *where to look*; the deterministic differential test *decides*.** For us that means using an LLM to read an LWC/React pair and propose **fixtures and interaction sequences most likely to distinguish them** — then feeding those into our existing oracle, which renders the verdict. The LLM never votes.

### 3.8 Shadow traffic / canary — not applicable in the form used elsewhere

Shadow testing mirrors production requests to a candidate service and discards its responses; it is the standard technique for service rewrites, with Diffy/Opendiffy as the canonical comparator.

For a **UI component migration** there is no request/response pair to mirror **[inference]**. The nearest analogue — running both implementations in a real org and comparing — is blocked by the Salesforce Multi-Framework origin isolation described in §2.6 (React runs on `*.my.salesforce.app`, and LWC↔React microfrontend interop is *not yet shipped*). What survives is:

- **Canary rollout as risk control, not verification**: ship migrated components to a small population first with error-rate monitoring. Google did the equivalent — *"changes were rolled out slowly to observe any adverse effects"* for large distributed IDs.
- **Production error/telemetry comparison** post-cutover as the escaped-defect measurement channel (§5).

### 3.9 Accessibility-tree diffing — a genuinely complementary channel

Playwright's `toMatchAriaSnapshot` produces a **YAML representation of the accessibility tree**: **role**, **accessible name**, and state attributes (`checked`, `disabled`, `expanded`, `invalid`, `level`, `pressed`, `selected`). Comparison is case-sensitive, order-sensitive, whitespace-collapsing.

This is **not** redundant with our tree diff, because the a11y tree is *computed*, not authored: implicit roles from tag+attribute combinations, accessible name resolution through `aria-labelledby` / `aria-label` / content / `<label for>`, and state derived from properties. A migration that changes `<button>` to `<div role="button">`, or breaks a `for`/`id` association across a component boundary, or loses an SLDS assistive-text span, produces a *structurally similar* tree with a *different* a11y tree **[inference]**.

Documented caveats: not ideal for highly dynamic content; large snapshots become hard to interpret; strict ordering.

### 3.10 Golden-master / snapshot testing — **redundant for us, and say so**

This is the one place where we are already ahead and should not spend effort.

Golden master / characterisation testing records `y = p(x)` for an old implementation and asserts the new one reproduces it. **Our oracle does the same thing with a live reference instead of a recording**, which is strictly better on two axes:

1. **No stale baselines.** Google's paper reports golden-file tests *required manual updates* during migration — recorded baselines become a maintenance tax exactly when the code is churning most.
2. **No blessing problem.** The snapshot literature's central complaint is that when snapshots fail often for low-impact reasons, **teams start ignoring failures, which defeats the purpose.** A live differential has no "accept new baseline" button to abuse.

**Recommendation: do not add checked-in DOM snapshot files.** The one exception is *recorded network fixtures* (§4.4), which is a different thing.

---

## 4. Agent architecture for migration

### 4.1 Single agent with a validator ladder beats a multi-agent committee

Every *shipped, measured* effort in this survey (Google, Airbnb, Amazon Q) uses **one transform step wrapped in a deterministic validator ladder plus retry**, not a committee of agents. The multi-agent designs appear in (a) research papers and (b) vendor case studies with **no metrics** — the Aviator "real-world case study" describes a Reader/Planner/Migrator trio with vector DB and RAG but **reports no cost, no success rate and no defect data**, which is why I weight it near zero.

The one multi-agent design that earns its complexity is MatchFixAgent — and note *what* the agents are: not "a Java agent and a Python agent" but **analysis / test-generation / adjudication**, i.e. a decomposition along the *verification* axis, with deterministic short-circuits removing the LLM from 25–35% of decisions.

**[inference] For us: keep one transform agent. If we add agents, add them to verification (fixture proposer, failure triager), not to transformation.**

### 4.2 The IR / planning layer

- Google's plan layer is **deterministic** (Kythe reference graph + regex categorisation). The LLM never decides *where* to change.
- Amazon Q's *selective transformation* (2025) inverts this: natural-language chat and input files let a human **tailor the transformation plan** before execution — human steering at the plan layer, not the code layer.
- Codemod Workflows expose the plan as **YAML with matrix strategies and manual approval gates**.

**[inference] Our census is our plan layer and it is already deterministic — this is correct and matches Google. The gap is that the plan is not currently a reviewable, editable artefact per component. Emitting a per-component plan (which recipes, which fixtures, which tier, which gates) that a human can amend before the run is the Amazon Q lesson.**

### 4.3 Self-repair loops and how to cap them

Airbnb's design is the reference implementation: **per-step validation, feed the validation error back with the current file state, configurable max attempts.** Their empirical distribution — most files ≤10 attempts, long tail 50–100 — is the number to design around.

Google's variant: **3 rounds, pick a random success** (to handle non-determinism, not to handle failure).

Cost control, from the budget-aware agent literature: per-request ceilings, per-session rolling budgets, model-tier routing, and **circuit breakers to prevent infinite loops and budget spikes**; a planner limited to e.g. two replanning attempts with immediate termination when cumulative cost exceeds budget. An unconstrained agent on an SWE task is quoted at **$5–8/task**. **[snippet-only]** For calibration, MatchFixAgent's verified figure is **$1.22 and 309s per validation case**.

**[inference] Concrete policy for us:**
- Attempt cap **by tier**, not global. Tier-1 (simple) components get ≤5 attempts; anything needing more is mis-tiered and that is itself a census signal.
- **Escalate rather than retry** past the cap — Airbnb's finding was that past a point manual intervention is cheaper than more retries.
- Adopt **"sample, tune, sweep"**: never burn budget perfecting one file. Cluster failures, fix 5–10 representatives, re-sweep the whole remainder.
- Hard $ and token circuit breaker per component *and* per sweep.

### 4.4 Environment-in-the-loop and fixtures

The 2602.09944 abstract's claim — that static analysis of the environment is insufficient and agents must build and interact with the environment — is directionally right for us **[inference: full paper unverified]**. Our concrete version is **record/replay of the data layer**: Polly.js records real HTTP interactions to **HAR** files and replays them deterministically, with a client-side server for simulating loading/error states.

For LWC the analogue is recording **real Apex/wire responses from a scratch org** into replayable fixtures rather than hand-writing mocks. This directly attacks the fixture-adequacy problem in §3.2: recorded responses contain the null fields, the 0-row cases, the field-level-security omissions and the 2000-row governor-limit shapes that hand-written fixtures never do **[inference]**. Note the standing critique of record/replay — recordings drift from the API and can encode incidental detail — which is why they should be *refreshed* on a schedule, not frozen.

### 4.5 Human-in-the-loop checkpoints

Consistent across all efforts: **the human gate is at review of the diff, with build+test results attached** — Google (Critique + code-owner acceptance), Amazon Q (holds until human reviews with build and test results), Meta (review every automated diff, reportedly without exception).

The non-obvious lesson is **review throughput is the bottleneck, and it is engineerable**: Rosie caps outstanding shards and negotiates infra load; Meta routed diffs by ML for a reported 17% lift in review actions/day **[unverified]**.

**[inference] For us: the oracle's output is the review artefact.** A reviewer should see "tree diff: clean / style diff: 2 properties / effect log: identical / mutation kill rate: 0.86 / attempts: 2" and be able to approve in seconds. Optimising *that* summary is higher-leverage than another point of auto-conversion rate.

---

## 5. Metrics — what serious efforts actually measure

**Verified from primary/near-primary sources:**

| Source | Metrics used |
|---|---|
| Google (FSE'25) | % of *changes* LLM-generated (74.45%); % of *edits* LLM-generated (69.46%); **LLMΔ / HumanΔ Levenshtein distances**; three-way split LLM-only / LLM-then-human / human-only; self-reported time reduction (flagged as perception) |
| Airbnb | Per-step pass rate through the state machine; % files complete after each sweep (75% → 97% → 100%); **retries-to-success distribution**; calendar time vs manual estimate |
| Meta TestGen-LLM | **Filter funnel yield**: % built (75), % passed reliably (57), % increased coverage (25), % accepted by engineers (73) **[snippet-only]** |
| MatchFixAgent | Verdict coverage (99.2%); repair rate (50.6%); patch correctness (95.9%); **$ and seconds per case** |
| Amazon MigrationBench | pass@1 split by **minimal vs maximal** migration (62.33% / 27.33%) **[snippet-only]** |

Generic industry migration KPIs (defect escape rate, defect density, automation rate, feature lead time) exist but are unremarkable **[snippet-only]**. One consistently-repeated practitioner point: **teams that skip the baseline cannot prove ROI**, and chasing too many KPIs at once burns out instrumentation.

**Recommended metric set for us [inference], in priority order:**

1. **Autonomy rate** — % of components merged with **zero human edits** after generation. (Google's "LLM-only": 35.97% — that is the realistic benchmark, not 97%.)
2. **HumanΔ / LLMΔ ratio per component**, computed from git history post-merge. Cheapest high-signal quality metric in this entire survey. It tells you *how wrong* the generator was, not just whether it failed.
3. **Oracle kill rate** (mutation score, §3.2) — the only number that says the oracle is *worth trusting*. Report per tier.
4. **Noise floor** (§3.3) — fields/component of non-determinism. Report alongside kill rate; the two together define oracle precision and recall.
5. **Retries-to-success distribution** — not the mean. The shape identifies mis-tiered components.
6. **Funnel yield per gate** (Meta's framing): parsed → no-op-filtered → built → tree-clean → style-clean → effect-clean → merged.
7. **Review minutes per component** and **review queue depth** — the actual bottleneck.
8. **Escaped defect rate per tier**, measured post-cutover from production telemetry (§3.8).
9. **$ and tokens per merged component**, with the circuit-breaker trip rate.

Explicitly **not** a headline metric: raw auto-conversion %. Airbnb's own data shows the last 22 points cost more calendar time than the first 75.

---

## 6. TECHNIQUES WE SHOULD ADOPT — ranked, highest value first

Cost estimates are engineer-days and are my own estimates **[inference]**.

---

### 1. Noise-floor control: render the ORIGINAL twice and subtract (Diffy's primary/secondary)
- **Catches that our oracle does not:** nothing directly — it makes everything else trustworthy. It converts *guessed* normalisation rules into *measured* ones, and every guessed rule is a defect class we are blind to (§3.6).
- **Why first:** it is the cheapest item here and it de-risks items 2–6 by giving them a calibrated signal channel.
- **Also delivers:** a defensible "oracle precision" number for the write-up.
- **Cost: 0.5–1 day.**

### 2. Computed-style differential at every boundary node
- **Catches:** CSS catalog mistranslation; loss of LWC shadow-DOM scoping (`:host`, `::slotted`, scoping attributes); specificity inversions; SLDS token drift; collapsed flex/grid layout; `display:none` vs conditional-render divergence. **Our catalog-driven CSS conversion currently has zero verification** — the boundary-tree diff provably ignores style, and `semantic-dom-diff` (the closest published analogue) strips `<style>` outright.
- **Why not pixels first:** computed-style diffs are readable, reuse the existing tree walk, and are immune to font/AA/OS flake.
- **Cost: 2–4 days** (whitelist ~25 properties, extend the walker, extend the differ).

### 3. Effect-trace differential (events, Apex, wire, navigation, cleanup)
- **Catches:** `CustomEvent` semantics loss (`composed`/`bubbles` not crossing shadow boundaries — a total functional failure with an *identical* DOM); duplicate Apex calls from an effect with a bad dependency array; missing/extra wire re-subscription — **which is exactly what our `enabled` guards are supposed to control and nothing currently checks**; missing unmount cleanup / leaks; wrong `detail` payload shape.
- **Design:** ordered `(seq, kind, target, normalised-args)` log emitted by both harnesses; diff as a second channel. Build a domain-specific comparator (order-sensitive for calls, order-insensitive where genuinely concurrent) — the shadow-testing literature is emphatic that naive JSON comparison fails here.
- **Cost: 3–5 days.**

### 4. Mutation testing of the oracle → a kill-rate score per tier
- **Catches:** *silently inadequate fixtures.* Today we know the oracle **can** fail (negative controls); we do not know **what fraction** of realistic migration faults it would catch, or which fixtures are dead weight.
- **Design:** a catalogue of ~15 migration-realistic mutation operators (§3.2) applied to generated React; kill rate reported per component; below-threshold components auto-escalated a tier. This makes the census *measured* rather than heuristic.
- **Cost: 3–5 days** for the operator catalogue + runner; reuses the existing oracle wholesale.

### 5. Differential model-based interaction testing (`fast-check` `modelRun`, original as the model)
- **Catches:** everything that only appears after a *transition* — stale closures over props, state batching differences, event-handler rebinding, double-fire on rapid clicks, ordering of async resolution vs user input, conditional-branch combinations no hand-written fixture covers.
- **Key insight:** we do not need to author invariants. **The original component *is* the model.** Replay identical generated interaction sequences against both, diff tree + style + effect log after each step.
- **Cost: 5–8 days** (needs a shared interaction-driver abstraction over both harnesses). Highest marginal defect yield after items 2–3 **[inference]**.

### 6. Recorded Apex/wire fixtures from a real scratch org (Polly.js-style HAR record/replay)
- **Catches:** the *shapes* hand-written fixtures never contain — nulls, empty result sets, FLS-stripped fields, 2000-row governor-limit responses, error payloads, slow responses. Directly raises the mutation kill rate from item 4 by widening the input space.
- **Caveat:** refresh recordings on a schedule; frozen recordings drift from the API.
- **Cost: 2–4 days** plus org access.

### 7. ARIA / accessibility-tree snapshot diff (`toMatchAriaSnapshot` or equivalent)
- **Catches:** *computed* semantics our authored-tree diff misses — implicit role changes (`<button>` → `<div>`), accessible-name resolution broken across a component boundary, lost `aria-labelledby`/`for`/`id` associations, lost SLDS assistive-text, state attributes (`expanded`, `pressed`, `selected`) not wired through.
- **Cost: 1–2 days** if a Playwright-based harness already exists; ~3 if not.

### 8. No-op / cosmetic-change detector in the validator ladder (Google steps 2–3)
- **Catches:** the specific LLM hallucination class Google documented — reformatting-only, comment-only, and irrelevant changes. Their ladder has a dedicated **"whitespace"** gate *and* an **"AST differs from original"** gate before build, plus a **"punt"** gate where the model confirms the change was necessary.
- **Cost: 0.5–1 day.** Check whether we already have this; if not it is nearly free.

### 9. Per-component provenance record (OpenRewrite data tables + Rosie sharding)
- **Catches:** nothing directly — it is how we *enforce* kill criteria and route review. Emit a structured row per component: recipes fired, fixtures used, oracle channels run and their verdicts, kill rate, noise floor, retry count, tokens, $, tier, escalation reason.
- **Also:** cap outstanding review shards (Rosie's load-negotiation lesson) — reviewer throughput is the real bottleneck (Meta).
- **Cost: 2–3 days**, and it is what makes items 1–8 legible to a human reviewer.

### 10. Tier-scoped retry caps + "sample, tune, sweep" + circuit breakers
- **Catches:** budget blowout on the long tail. Airbnb: most files ≤10 attempts, tail 50–100, and past a point manual is cheaper. Design: attempt cap **per tier**; exceeding it is an escalation *and* a census signal that the component was mis-tiered; never perfect one file — cluster failures, fix 5–10 representatives, re-sweep.
- **Cost: 1–2 days** on top of an existing retry loop.

### 11. LLM as *fixture proposer*, never as judge (MatchFixAgent's division of labour)
- **Catches:** distinguishing inputs a human would not think to write — the LLM reads the LWC/React pair and proposes fixtures and interaction sequences most likely to expose divergence; **our deterministic oracle renders the verdict.** MatchFixAgent's ablation showed the analysis→targeted-test structure was worth 42.3% accuracy while *reducing* tokens.
- **Hard rule:** the LLM never votes on pass/fail (see §3.7 on false negatives and unfaithful explanations).
- **Cost: 2–3 days**, worth doing only after items 1–5 exist to consume the proposals.

### 12. Component-level pixel screenshot diff, advisory-only
- **Catches:** the residue item 2 misses — overlap, clipping, z-order, text overflow, icon/sprite loss.
- **Only with:** Playwright Docker image, pinned Playwright version, component-scoped (not full-page) screenshots, per-component thresholds (~`maxDiffPixelRatio: 0.01` starting point), **advisory not blocking.**
- **Cost: 3–5 days** including CI image plumbing and baseline management. Ranked last of the adopt list because item 2 gets most of the value for a fraction of the flake.

---

## 7. Deliberately NOT worth adopting

**1. Checked-in DOM/HTML snapshot (golden-master) files.**
Strictly weaker than what we have — a recorded baseline instead of a live reference. Google's paper reports golden-file tests *required manual updates* during migration; the snapshot literature's central failure mode is that frequent low-impact failures train teams to bless diffs without reading them. Our oracle has no "accept baseline" button, and it should stay that way.

**2. LLM-as-judge as a pass/fail gate.**
Documented false-negative rates driven by hallucination (33% of misjudgements involved commentary on code that was not in the function), simultaneous over-correction and unsafe acceptance, and explanations that do not faithfully justify the verdict. Use it to propose tests (item 11) or to triage/rank failures for humans. Never to decide.

**3. Shadow traffic / canary comparison in production, in the service-rewrite sense.**
No request/response pair to mirror for UI components, and Salesforce Multi-Framework's origin isolation (`*.my.salesforce.app`) plus not-yet-shipped LWC↔React microfrontend interop means side-by-side in-org rendering is not currently possible. Keep *canary rollout* as risk control and production telemetry as the escaped-defect channel — but do not build a Diffy-style proxy.

**4. Formal equivalence checking / translation validation via SMT or symbolic execution.**
No tractable formalism spans DOM + CSS + async scheduling + framework runtime. Note that the state-of-the-art research in this exact area (MatchFixAgent) **falls back to differential testing as ground truth** — the same thing we already do. Nothing to gain.

**5. Porting onto Grit / codemod.com / OpenRewrite as our transform engine.**
- **ast-grep (and therefore GritQL/JSSG) has no scope, no types, no def/use, no control/data flow** — by its own documentation. Our template-AST codemod, resolving bindings against `@api`/`@track`/`@wire` members, is *more* semantically informed.
- OpenRewrite's LST is genuinely superior technology but is not a realistic host for LWC templates.
- Grit.io's 2026 product status could not be verified.
- **Steal the features** (dry-run, recipe composition granularity, data tables, approval gates) — do not adopt the platform mid-project.

**6. Multi-agent transformation committees.**
Every shipped, measured effort uses one transform step + a deterministic validator ladder. The multi-agent migration case studies I found report **no metrics at all**. The only multi-agent design that earns its cost decomposes *verification*, not transformation — which is item 11, already on the adopt list.

**7. Fine-tuning a model on our LWC/React corpus.**
Google explicitly used prompting only (no custom fine-tuning) at far greater scale than ours, at temperature 0.0. Airbnb's own conclusion was that **related-file selection mattered more than prompt quality** — and both dominate fine-tuning at our corpus size **[inference]**.

**8. Chromatic/Percy as a paid managed VRT service.**
TurboSnap's economics depend on *few* components changing per PR. In a migration where every component changes, the savings evaporate. Self-hosted component-level Playwright screenshots (item 12) get the same signal.

**9. Code coverage as a quality gate.**
The mutation-testing literature is consistent: coverage does not imply effectiveness; high-coverage suites miss subtle faults when assertions are weak. Mutation kill rate (item 4) is the metric that means something here; coverage would just be a number we optimise into meaninglessness.

**10. Raw auto-conversion % as the headline KPI.**
Airbnb's 75%→97% cost more calendar time than the first 75%, and Google's honest number is **35.97% LLM-only**. Report autonomy rate and HumanΔ/LLMΔ instead (§5).

---

## 8. Two things this survey changed my mind about

**[inference]**

1. **We are over-invested in the oracle's architecture and under-invested in its observation channels.** No published effort has a behavioural differential oracle at all. The marginal return on a *better tree differ* is near zero; the marginal return on a *style channel and an effect channel* is large.

2. **Salesforce Multi-Framework GA (July 2026) is a project-level input we had not accounted for.** React on-platform is now supported, with GraphQL via `@salesforce/platform-sdk`, direct Apex invocation and UI APIs — but on an isolated origin, with LWC↔React microfrontend interop **not yet shipped**. This affects the target architecture, the shim's data layer, and rules out in-org side-by-side verification. Worth a dedicated follow-up.

---

## Sources

### Fetched directly (full page read)
- https://arxiv.org/abs/2504.09691 — *Migrating Code At Scale With LLMs At Google* (abstract)
- https://arxiv.org/html/2504.09691v1 — same paper, full HTML (validation ladder, metrics, failure modes)
- https://getdx.com/research/migrating-code-at-scale-with-llms-at-google/ — practitioner digest of the above
- https://medium.com/airbnb-engineering/accelerating-large-scale-test-migration-with-llms-9565c208023b — Airbnb Enzyme→RTL migration
- https://arxiv.org/abs/2602.09944 — *Environment-in-the-Loop* (abstract only; body not retrievable)
- https://arxiv.org/html/2509.16187v3 — *MatchFixAgent* translation validation and repair
- https://developer.salesforce.com/blogs/2026/07/build-with-react-on-salesforce-multi-framework-is-now-ga — Salesforce Multi-Framework GA
- https://www.augmentcode.com/guides/code-migration-tools-vs-migration-loop — "migration loop"; Meta/Google/Amazon comparison (vendor source)
- https://open-wc.org/docs/testing/semantic-dom-diff/ — semantic DOM diffing options and normalisation
- https://playwright.dev/docs/aria-snapshots — ARIA snapshots / `toMatchAriaSnapshot`
- https://www.aviator.co/blog/llm-agents-for-code-migration-a-real-world-case-study/ — multi-agent migration case study (no metrics; low evidentiary value)

### Surfaced via search results only — NOT fetched; treat as lower confidence
- https://arxiv.org/abs/2402.09171 — Meta, *Automated Unit Test Improvement using LLMs* (TestGen-LLM / Assured LLMSE)
- https://arxiv.org/abs/2505.09569 — Amazon, *MigrationBench*
- https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees
- https://docs.openrewrite.org/reference/recipes-with-data-tables
- https://docs.openrewrite.org/recipes/core/findlstprovenance
- https://moderne.ai/openrewrite
- https://moderne.ai/blog/understanding-openrewrite-beyond-the-myths
- https://docs.moderne.io/user-documentation/agent-tools/prethink/
- https://docs.grit.io/ and https://github.com/getgrit/gritql
- https://codemod.com/ , https://docs.codemod.com/changelog , https://codemod.com/blog/jssg , https://codemod.com/blog/npx-codemod-ai
- https://eslint.org/blog/2026/07/eslint-codemod-migrations/
- https://ast-grep.github.io/advanced/tool-comparison.html
- https://www.hypermod.io/blog/4-jscodeshift-vs-ast-grep
- https://abseil.io/resources/swe-book/html/ch22.html — Software Engineering at Google, ch. 22 (Rosie / LSCs)
- https://blog.twitter.com/engineering/en_us/a/2015/diffy-testing-services-without-writing-tests — Diffy noise cancellation
- https://github.com/opendiffy/diffy
- https://en.wikipedia.org/wiki/Characterization_test
- https://blog.thecodewhisperer.com/permalink/surviving-legacy-code-with-golden-master-and-sampling
- https://www.chromatic.com/docs/snapshots/ and Chromatic/TurboSnap guides
- https://github.com/Netflix/pollyjs
- https://github.com/dubzzz/fast-check and https://github.com/mdubourg001/fast-check-frontend (library existence unverified)
- https://arxiv.org/pdf/2410.21136 — LLM test oracles: actual vs expected behaviour
- https://arxiv.org/html/2607.22880 — coverage/mutation score correlation with effectiveness (2026 preprint, unverified)
- https://link.springer.com/article/10.1007/s10515-026-00638-5 — LLM reviewers, systematic overcorrection
- https://arxiv.org/pdf/2507.16587 — LLM-as-a-judge for code generation/summarization
- https://arxiv.org/pdf/2507.05234 — React-tRace (differential validation of hook semantics)
- https://microsoft.github.io/code-with-engineering-playbook/automated-testing/shadow-testing/
- https://aws.amazon.com/blogs/aws/upgrade-your-java-applications-with-amazon-q-code-transformation-preview/ and related AWS pages (marketing; "1,000 apps in 2 days" unverified)
