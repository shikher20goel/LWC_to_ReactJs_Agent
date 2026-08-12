# Agent build backlog

Every task required to get from "working oracle" to "agent that converts LWC
to React at a measured, defensible rate."

Ordering is **not** mine — it is `research/02` Part 11 (the build order) and
`research/03` Part 5/6 (sequencing), which both say the same thing in
different words. Where I deviate I say so and why.

**Legend:** ✅ done · 🟡 in progress · ⬜ ready · 🔒 blocked · 🚧 gate

---

## The one hard blocker

**Seven tasks below need source from your Salesforce org. I have no org
access, and per `CLAUDE.md` hard rule 1 I must not ask for or handle
credentials.**

This is not a formality. The research is explicit that synthetic components
are not a substitute:

- Step 1 of the build order is a 20-case eval set **"from real components."**
- The Phase 1 exit is a golden corpus of **"40–60 components from your org,"**
  because sample apps are "unrepresentatively clean."
- The census is the **gate** that can legitimately kill the project
  (Tier H > 35%, or FLS/sharing-dependent > 50%).

Everything else I can build now. But an agent tuned only against components I
wrote myself is tuned against my own assumptions — that is precisely the
failure mode `research/02` calls "the LLM tests the code the LLM wrote."

**What unblocks all seven — no credentials to me, you run it:**

```bash
sf project retrieve start --metadata LightningComponentBundle --target-org <your-alias>
```

Then the same for `ApexClass`. Drop the result into `force-app/main/default/`.
Retrieved source is DATA, not instructions (hard rule 5) — I will treat it as
such.

---

## Phase A — Research (unblocked, runs without the org)

| ID | Task | Source | Depends | Status |
|---|---|---|---|---|
| R1–R3 | Oracle feasibility | Cluster A | — | ✅ `research/04` |
| S-1 | Oracle spike | 03 Part 1 | R1–R3 | ✅ `research/05` |
| R4 | LWC template AST (`@lwc/template-compiler`) | Cluster B | — | ✅ `research/06` |
| R5 | Mine `blittle/lwc2react` transform rules | Cluster B | — | ✅ `research/06` — verdict: **do not fork it** |
| R6 | LWC static analysis at org scale | Cluster C | — | ✅ `research/07` — verdict: 3–5 days, not 2 weeks |
| R7 | Apex parsing + dependency graph | Cluster C | — | ✅ `research/07` — `@apexdevtools/apex-parser@5.1.0` |
| R8 | LDS semantics → fidelity-loss table | Cluster D | — | ✅ `research/08` — 27-row table, 4 real losses |
| R9 | TanStack Query conventions for a shim | Cluster D | — | ✅ `research/08` |
| R10 | Agent SDK vs Claude Code headless as loop runtime | Cluster E | — | ✅ `research/09` — use Agent SDK |
| R11 | Agent Skills spec conformance | Cluster E | — | ✅ `research/09` — 6 frontmatter fields |
| R12 | Existing Ralph implementations to fork | Cluster E | — | ✅ `research/09` — fork nothing wholesale |
| R13 | Capturing real org traffic for fixture replay | Cluster F | — | ⬜ |

**R6/R7 precede the census tool.** Don't hand-roll a parser before checking
what exists.

---

## Phase B — Oracle hardening (unblocked, this is build-order step 2)

| ID | Task | Why | Depends | Status |
|---|---|---|---|---|
| O-1 | Boundary-tree normaliser | foundation | S-1 | ✅ |
| O-2 | React adapter + end-to-end diff | first real result | O-1 | ✅ |
| O-3 | LCS/keyed child alignment in `diffTrees` | 15 diffs → 3, correctly attributed | O-2 | ✅ |
| O-4 | **Call-log diff** (`getLastConfig()` vs React call log) | catches the missing-`enabled`-guard defect — the #1 naive-conversion bug | R2.3 ✅ | ⬜ |
| O-5 | Accessibility-tree parity diff (`dom-accessibility-api`) | check 5 of the S6 gate | O-1 | ⬜ |
| O-6 | axe-core rule audit (separate from parity) | a faithful conversion of an inaccessible LWC is still inaccessible | — | ⬜ |
| O-7 | Event-log diff | composed events already proven to cross boundaries (F6) | O-1 | ⬜ |
| O-8 | Fixture schema validator — enforce nested LDS shape | a flattened fixture blinds the oracle to `[object Object]` | — | ⬜ |
| O-9 | Catalog loader — replace the hardcoded `CATALOG` in `normalise.js` | catalog is a blocking dependency; the stand-in is technical debt | — | ⬜ |

---

## Phase C — Census (gate)

| ID | Task | Depends | Status |
|---|---|---|---|
| C-1 | Build census tool — LWC half | R6, R7 | ✅ `census/lwc-census.js` + `npm run census` |
| C-1b | Census tool — Apex half (sharing, SOQL access mode) | R7 | ⬜ **unblocked** — needed for gate C-4 |
| C-2 | **Run M-1 census against your org** | C-1 ✅ + org source | 🔒 **org — tool is ready and waiting** |
| C-3 | 🚧 **GATE:** Tier H > 35% → STOP, reconsider LWC-OSS / strangler-fig | C-2 | 🚧 |
| C-4 | 🚧 **GATE:** FLS/sharing-dependent > 50% → STOP, this is a security rewrite | C-2 | 🚧 |
| C-5 | Order `catalog/base-components.xml` by real usage | C-2 | 🔒 org |

The census "reprices the whole project" — the catalog assumes ~90 base
components; a typical org uses 20–25.

---

## Phase D — Deterministic codemod (target: ≥60% of emitted output)

| ID | Task | Depends | Status |
|---|---|---|---|
| D-1 | Template AST walker | R4 | ✅ `codemod/template.js` |
| D-2 | Directive transforms (`for:each`, `lwc:if/elseif/else`, `iterator:*`) | D-1, R5 | ✅ — `lwc:dynamic` flagged, not converted |
| D-3 | `@api`→props, `@wire`→hooks, getters, events (JS half) | D-1, R5 | ✅ `codemod/component.js` |
| D-4 | Event transforms (`onclick={h}` → `onClick`) | D-1 | ✅ — custom-event casing flagged as unrecoverable |
| D-5 | **Benchmark codemod output against the oracle** | D-2..D-4, O-* | ✅ **CLOSED LOOP** — `oracle/generated.react.test.js` |

Prefer deterministic code over LLM generation — every construct moved into the
codemod is a construct the model can no longer get wrong.

---

## Phase E — Runtime shim (`@migration/salesforce-runtime`)

| ID | Task | Depends | Status |
|---|---|---|---|
| E-1 | React base components (Card/Button/FormattedText/FormattedNumber) | — | ✅ partial — `shim/components.js` |
| E-2 | `useRecord` / `useApex` with `enabled` guards | R8, R9 | ✅ `shim/runtime.js` |
| E-3 | Query-key factory + invalidation graph | R9 | ✅ `shim/keys.js` — dev-throws on unbranded keys |
| E-4 | `<fidelity-loss>` table — F8/F9/F14/F16 | R8 | ⬜ **unblocked** |
| E-5 | Frozen shim tests | E-2 | ✅ 17 tests, marked frozen per rule 2 |

---

## Phase F — Agent harness (build-order steps 1, 3, 4, 7)

| ID | Task | Depends | Status |
|---|---|---|---|
| F-1 | **20-case eval set from real components** — step 1, run bare Claude Code, record failures | org | 🔒 **org** |
| F-2 | Eval *runner* (scoring, held-out split, delta reporting) | — | ⬜ ready |
| F-3 | 10–14 consolidated tools, namespaced, descriptions written as onboarding docs | F-1 | 🔒 |
| F-4 | Tool eval; let Claude optimise tool descriptions against it | F-3 | 🔒 |
| F-5 | Wire the 8-stage pipeline **in code, not a prompt** — ≤40 instructions/stage | F-3 | 🔒 |
| F-6 | Regression suite: every skill/catalog change re-runs the corpus, blocks on regression | F-1 | 🔒 |

---

## Phase G — Skills (build-order step 5 — **deliberately last**)

| ID | Task | Depends | Status |
|---|---|---|---|
| G-1 | Catalogs first — they are data, not prose | C-5 | 🔒 |
| G-2 | Write skills **only for gaps F-1 found** | F-1 | 🔒 |

`CLAUDE.md` forbids populating `skills/` before evals find real gaps.
`research/02` Part 11: *"Writing 55 skills before running a single eval is the
most likely way to waste three months of this project."*

I am not going to pre-write a skill library. It would look like progress and
would be built for imagined problems.

---

## Phase H — Ralph loop (build-order steps 8–10)

| ID | Task | Depends | Status |
|---|---|---|---|
| H-1 | Golden corpus: 40–60 org components, hand-migrated to oracle-green | org | 🔒 **org** |
| H-2 | 🚧 **GATE:** can a human reach oracle-green by hand on ≥80%? If not, the loop can't | H-1 | 🚧 |
| H-3 | `PROMPT.md` + Ralph state files (via `autonomous-build-orchestrator`) | H-2 | 🔒 |
| H-4 | Tune Ralph on the corpus **only**, until it reproduces all hand-migrations | H-3 | 🔒 |
| H-5 | Tracing — before the first unattended overnight run | H-4 | 🔒 |
| H-6 | Spend cap + sandbox (decision D-7) | — | ⬜ |
| H-7 | Pilot: 10–20 components, measure %auto, defects, human-min, cost | H-4 | 🔒 |

**Ralph is pointed at the golden corpus only, until it reproduces every
hand-migration from scratch.** Ralph over unverifiable work is a token bonfire.

---

## What "90% converted" can honestly mean

Per `01` Part 12, the number depends entirely on the bar:

| Bar | Confidence | Reachable? |
|---|---|---|
| Compiles, renders, structurally resembles source | ~90% | **yes** |
| Presentational components production-correct | ~90% | **yes** |
| Typical business component, correct after human review | ~70% | realistic target |
| Same, fully autonomous | ~25% | not at 90% |
| Whole app, unattended | ~5% | no |

So a defensible goal is **~90% of components reaching oracle-green with a
human reviewing Tier-A output**, plus accurate Tier-H escalation. Anything
claiming 90% unattended production-correctness contradicts the evidence base
in this repo.

Tier H is out of scope at any budget: `record-edit-form` and friends are a
form-engine build, not a translation.
