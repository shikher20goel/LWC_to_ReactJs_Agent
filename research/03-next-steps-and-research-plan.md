# **Next Steps — Research, Measurement, and the Spike**

## **Work plan before building the Ralph loop**

### **v1.1 — companion to `01-architecture-v2` and `02-agentic-engineering-best-practices`**

> **UPDATE (11 Aug 2026):** Cluster A research is complete and the S-1 spike has been **executed and passed**. See "S-1 SPIKE RESULTS" in this folder. Part 1 below is retained for the record; the live status board is doc `00 — Research Index & Status`.

---

# **Part 0 — The framing that matters**

Your remaining unknowns are not all the same kind of thing. Conflating them is the main way this stalls.

| Kind | Definition | Resolved by | Count remaining |
| :---- | :---- | :---- | :---- |
| **RESEARCH** | Someone external already knows this | Searching, reading source | \~13 questions |
| **MEASUREMENT** | Only your org knows this | Static analysis of your codebase | 1 census |
| **EXPERIMENT** | Nobody knows; depends on your specifics | A time-boxed spike | 1 blocking spike ✅ **DONE** |

**The ordering that matters:** the single blocking experiment invalidates roughly half the research if it fails. Run it first, or in parallel with the cheapest research — do not complete all research and then discover the foundation doesn't hold.

Per `02`'s own build order, skills are step 5 of 10\. Nothing below asks you to write a skill yet. That's deliberate.

---

# **Part 1 — The blocking spike ✅ COMPLETE — PASSED**

## **S-1: Can LWC render off-platform, for *your* components?**

**Why this was blocking:** the entire v2 architecture rests on the differential oracle. The oracle rests on rendering the original LWC in Node with no org attached.

**Result:** PASS on a synthetic component exercising every required construct. 14 assertions, 1.3 s. Three design corrections emerged (props are properties not attributes; traverse shadow *and* light DOM; suppress base-component shadow text but keep slotted text). See the S-1 results doc.

**Residual risk moved to:** "does it work on a real org component" — approximately one hour of work now that the harness exists.

---

# **Part 2 — The measurement (\~4 days)**

## **M-1: The org census**

Specified in `01-v2` Phase 0a. What it must output, because everything downstream is scoped by it:

census.json

├── base\_components\_used\[\]      { tag, count, files\[\] }

├── wire\_adapters\_used\[\]        { adapter, module, count }

├── lwcs\_with\_renderedCallback\[\]

├── lwcs\_with\_querySelectorAll\[\]

├── lwcs\_with\_composed\_events\[\]

├── lwcs\_using\_LMS\[\]            \+ subscriber map

├── lwcs\_using\_empApi\[\]

├── lwcs\_touching\_FLS\_or\_sharing\[\]     ← drives the R1 security risk

├── lwcs\_using\_record\_edit\_form\[\]      ← Tier H, drives the kill criterion

├── apex\_classes\_reachable\[\]    { class, depth, callers\[\] }

├── existing\_jest\_coverage\_pct

└── tier\_distribution           { M: n, A: n, H: n }

**This reprices the whole project.** The catalog in `01-v2` assumes \~90 base components; you likely use 20–25. That's \~70% off the most expensive artifact. It also gives you the real Tier-H percentage, which is the kill criterion.

Tooling for this is a research question — see R6/R7. **Don't hand-roll a parser before checking what exists.**

> **Note post-spike:** the census now has a second consumer. `catalog/base-components.xml` must enumerate readable **prop names** per base component, because the oracle normaliser cannot discover them by enumeration. The census tells you which components need entries and in what priority order.

---

# **Part 3 — The research prompts**

Run these as separate sessions with search enabled. Each is written to produce a *verifiable artifact*, not a summary — per `02` §7.2, weak tasks produce weak output.

## **Cluster A — Oracle feasibility ✅ COMPLETE**

R1 (off-platform rendering), R2 (wire mocking), R3 (DOM/a11y diffing) — done. See the Cluster A doc.

## **Cluster B — The deterministic codemod**

### **R4 — LWC template AST**

> Research the `@lwc/template-compiler` package: its parse API, the shape of the IR/AST it produces for LWC templates, and how directives (`for:each`, `iterator:*`, `if:true`, `lwc:if/elseif/else`, `lwc:dynamic`, `lwc:component`, `key`, `slot`, event bindings) are represented in that AST. Determine whether the AST is a stable public API or an internal detail, and what version pinning is advisable. Show how to walk it and emit code from it.

**Done when:** you can traverse a real template AST and print node types.

### **R5 — Mine the lwc2react transform rules**

> Read the source of the GitHub repo `blittle/lwc2react` in detail. Extract and document every transform rule it implements: how it converts template directives to JSX, how it maps `@api` to props, how it handles slots (named and anonymous), lifecycle methods, scoped CSS, and template-raised custom events. Identify exactly where and why it stops short on wire adapters. Produce a rule-by-rule table with the source-file reference for each, and a list of constructs it does not attempt.

**Done when:** you have a transform-rule table you can implement against — this is a large head start on the codemod.

## **Cluster C — Census tooling**

### **R6 — LWC static analysis at org scale**

> Research the best tooling in 2026 for statically analysing an entire Salesforce LWC codebase to produce a component inventory. Cover: Salesforce Code Analyzer v5, `@salesforce/eslint-plugin-lwc`, `@lwc/compiler`'s parse output, and any open-source LWC dependency-graph or inventory tools. Determine how to reliably extract, per component: `lightning-*` tags used, `c-*` children, `@wire` adapters and their modules, `@salesforce/*` imports, lifecycle hooks present, and `.js-meta.xml` targets. Recommend build-vs-buy and show the extraction approach.

### **R7 — Apex parsing and dependency graphing**

> Research how to parse Apex source and build a class-level dependency graph offline, as of 2026\. Cover `apex-parser` (the ANTLR grammar), Salesforce Code Analyzer / PMD's Apex rules, and any tools that emit call graphs. Determine how to resolve: class-to-class references, SOQL queries and the sObjects they touch, `@AuraEnabled` method signatures, and `with/without/inherited sharing` declarations. The goal is a graph supporting leaf-to-root topological migration ordering. Recommend a stack.

**Done when:** you know whether the census is a weekend of glue code or a two-week build.

## **Cluster D — Runtime shim design**

### **R8 — LDS semantics, precisely**

> Research the exact runtime semantics of Salesforce Lightning Data Service wire adapters, as of 2026: when `getRecord` re-emits, how the LDS cache deduplicates and revalidates, what `refreshApex` and `notifyRecordUpdateAvailable` actually invalidate, how `@AuraEnabled(cacheable=true)` interacts with the client cache, and the precise nested shape of the record payload (`fields.X.value` vs `displayValue`) including spanning fields. Cite the LWC Developer Guide. The goal is to replicate these semantics in a TanStack Query wrapper — so be explicit about which behaviours are replicable and which are not.

**Done when:** you have a behaviour table with a "replicable / not replicable" column. This directly populates the `<fidelity-loss>` entries.

### **R9 — TanStack Query architecture for a shim**

> Research best practices in 2026 for designing a shared data-access layer on TanStack Query used by many generated components: query-key factory conventions, structural sharing, `enabled` guards for dependent queries, invalidation graph design, and how teams enforce key conventions via ESLint. Focus on the case where components are machine-generated and must not invent their own conventions.

## **Cluster E — The harness**

### **R10 — Claude Agent SDK vs Claude Code as the loop runtime**

> Compare, as of 2026, running a long-horizon autonomous coding loop on (a) the Claude Agent SDK and (b) Claude Code in headless mode (`claude -p`). Cover: subagent support, hooks, permission modes and sandboxing, session resumption, tracing/observability, cost controls, and what each gives you for free versus what you must build. Reference Anthropic's own guidance on agent harnesses. Recommend one for a pipeline that runs 100+ iterations unattended.

### **R11 — Agent Skills spec conformance**

> Research the Agent Skills open standard published at agentskills.io (open-sourced December 2025). Document the full `SKILL.md` frontmatter schema including optional fields beyond `name` and `description`, directory conventions for `references/`, `scripts/` and `assets/`, how bundled scripts are invoked, versioning conventions, and any validation tooling. Note which fields are Claude-specific versus standard.

### **R12 — Existing Ralph implementations**

> Survey open-source Ralph-loop implementations as of 2026 — including `frankbria/ralph-claude-code`, `syuya2036/ralph-loop`, and the ralph-wiggum.ai project. For each, document: exit-detection strategy, rate limiting, cost caps, state-file conventions, dashboard/monitoring, and how they handle a task failing repeatedly. Recommend one to fork rather than writing a loop from scratch.

## **Cluster F — Fixture recording**

### **R13 — Capturing real org traffic for replay**

> Research how to record the actual sequence of Apex and UI API calls made by an LWC running in a Salesforce sandbox, for later replay as test fixtures. Cover: browser devtools HAR capture against Lightning Experience, the `/aura` and `/services/data` request shapes, whether Lightning Web Security or request batching obscures individual calls, and how teams convert captured traffic into MSW handlers. Assess feasibility and name the obstacles.

**Done when:** you know whether tier-2 (recorded) fixtures are practical or whether you're limited to synthetic \+ adversarial.

---

# **Part 4 — What NOT to research**

Genuinely settled. Researching these again is procrastination:

- Whether LWC→React is feasible in principle — answered, `lwc2react` proves the template half  
- Which agentic patterns to use — answered from Anthropic primaries in `02`  
- Whether Ralph works — answered; the constraint is verifiability, which the oracle addresses  
- Apex→Java approach — Path A is the default; Path B is a separate programme, not a research task  
- Auth approach — JWT Bearer, settled, and username-password is being retired regardless  
- Whether to use design-system-react — that's decision D-3, resolved by the census, not by more reading  
- **Whether the oracle is feasible — answered by the spike. It is.**

---

# **Part 5 — Sequencing (revised post-spike)**

DONE     S-1 spike ✅  ║  R1, R2, R3 ✅  (oracle cluster)

         └─ GATE PASSED: oracle renders, boundary tree is clean and stable.

Week 1   Real-component validation (\~1h)  ║  R6, R7 (census tooling)

         └─ GATE: does a REAL org component render? If no → re-plan.

Week 2   M-1 census

         └─ GATE: Tier H \> 35%? → STOP, reconsider LWC-OSS / strangler-fig.

         └─ GATE: FLS/sharing-dependent \> 50%? → STOP, security rewrite.

Week 3   R4, R5 (codemod)  ║  R8, R9 (shim)

         Decisions D-1…D-7 signed off

         Build the React half of the oracle → first end-to-end diff

Week 4   R10, R11, R12 (harness)  ║  R13 (fixtures)

         Walking skeleton: one component S0→S7 by hand, every decision recorded

         └─ GATE: can a human reach oracle-green by hand? If no, the loop can't.

Then     Phase 1 build (catalog, shim, codemod, 40–60 corpus)

**R6/R7 precede M-1.** Don't build the census tool before checking what exists.

**The walking skeleton is not research.** It's the specification for the pipeline, and it will surface three problems none of these documents anticipated. Budget for it.

---

# **Part 6 — What to build first, when research is done**

Per `02` Part 11, in order:

1. **20-case eval set** with real components — run bare Claude Code against them, record failures  
2. **Oracle harness** ✅ *(spike delivered a working base)* \+ **runtime shim**  
3. **`catalog/base-components.xml`** — now a **blocking** dependency; the oracle can't read props without it  
4. **10–14 consolidated tools**, namespaced, descriptions written as onboarding  
5. **Tool eval**, then let Claude optimise the tool descriptions against it  
6. **Skills — only for the gaps step 1 found.** Catalogs first; they're data, not prose  
7. Regression suite  
8. Wire the 8-stage workflow in code (≤40 instructions per stage)  
9. Ralph, tuned on the corpus only  
10. Tracing, before the first unattended overnight run  
11. Pilot, with metrics

**Two local skills that matter:** `skill-creator` (authoring the library) and `autonomous-build-orchestrator` (generating `plan.md` / `prd.json` / `progress.txt` / `CLAUDE.md`). Don't hand-write those state files.

---

# **Part 7 — Honest expectation**

Four weeks gets you to a defensible go/no-go with real numbers instead of estimates. Three gates can legitimately end the project — and finding that out in week 2 for the cost of a census is the best outcome available if it's true.

The most likely real outcome, per `01-v2` Part 12, is not binary: assistive tooling that substantially reduces work on Tier M/A components and flags Tier H accurately. Plan for that; treat full autonomy as upside.  
