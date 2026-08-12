# **Agentic LWC → React (+ Apex → Java) Migration**

## **Best-Practices & Architecture Document — v2.0**

**Supersedes v1.0.** Read Part 0 first — three structural things changed, and one of them invalidates a section of v1 that sounded rigorous but wasn't.

**Status:** Pre-build. Sign this off before any skill file is written. **Confidence:** stated explicitly in Part 12\. Read it before committing budget.

---

# **Part 0 — What changed from v1, and why**

| \# | Change | Reason |
| :---- | :---- | :---- |
| **C-1** | **Added the differential oracle (Part 3).** LWC runs off-platform via LWC Open Source. So we render the *original* component locally, render the React version, feed both identical props and identical mocked data, and diff the resulting DOM \+ accessibility tree. | v1's verification gate assumed derivable tests. Most real LWC codebases have thin Jest coverage. Without an oracle, checks 4–5 degrade to "the LLM tests the code the LLM wrote," the gate always goes green, and Ralph confidently produces 200 wrong components. **This was the single biggest flaw in v1.** |
| **C-2** | **Deleted the 95% pixel-parity check.** Replaced with DOM-structure \+ a11y-tree equivalence. | SLDS on-platform vs. a React reimplementation will never hit 95% pixel match. That check would be disabled in week two, after which nothing caught visual regression. It sounded rigorous; it was decorative. |
| **C-3** | **Census moved to Phase 0, before catalog work.** | v1 specified a \~90-component catalog. Your org likely uses 20–25. Measuring first is days of work and cuts the most expensive artifact by \~70% — or tells you the project is infeasible, which is more valuable still. |
| **C-4** | **Apex→Java split into its own track with its own gate.** Path B demoted to "requires separate programme." | v1 treated it as a section of one project. It isn't. Honest confidence on Path B is low and v1 obscured that. |
| **C-5** | Golden corpus 10 → 40–60, drawn from **your org**, not sample apps. | 10 is too few to detect regression when a skill file changes. Sample apps are unrepresentatively clean. |
| **C-6** | **Skill library gets a regression suite.** Every skill edit re-runs the corpus and reports delta. | Otherwise you tune blind and the library rots invisibly. |
| **C-7** | **Added kill criteria (Part 10).** | v1 had no defined way to stop. A plan with no exit condition is how six-week spikes become nine-month sunk costs. |

---

# **Part 1 — Research findings (condensed; full sourcing in Part 13\)**

## **1.1 Prior art on LWC → React**

| Project | Substance | Use to us |
| :---- | :---- | :---- |
| `blittle/lwc2react` | Rollup plugin compiling LWC → React at build time. Handles template binding, reactive data, lists, conditionals, scoped CSS, `@api` props, named \+ anonymous slots, lifecycle methods, form/input events, template-raised custom events. **Explicitly does not handle wire adapters.** Author labels it a POC. | **Most useful artifact found.** Proves the template+reactivity half is mechanically tractable. Its one gap is precisely the platform half — which validates the M/A/H split. Mine its transform rules; don't depend on it. |
| `ccoenraets/lightning-react` | React app hosted *inside* a Lightning component, calling `@AuraEnabled` Apex. | Strangler-fig fallback for components too risky to convert. |
| "React inside LWC via `loadScript`" blog pattern | Two frameworks fighting for one DOM. | Anti-pattern. Documented only so the agent never proposes it. |

**Nobody has shipped an end-to-end LWC→React migration agent.** You're extending prior art, not reproducing it.

## **1.2 Salesforce's own Apex→Java migration — the highest-value source**

275 Apex classes, 3,537 files, seven years old, undocumented. Two years estimated manually; four months delivered with AI-assisted refactoring.

| Their finding | Our requirement |
| :---- | :---- |
| Files could not be translated in isolation — shared utilities, constants and static call chains were only meaningful in context. Isolated generation produced plausible-looking code that behaved wrong. | **R-1** Full dependency graph before generating anything. |
| They graphed dependencies, migrated leaf classes (constants, helpers) first, then each layer referenced *verified* output below it. | **R-2** Strict leaf-to-root topological order. |
| Static/global-state Apex would have reproduced its own flaws under direct syntax conversion. They wrote **explicit transformation rules** mandating OO service layers with DI and state separation, refined iteratively. | **R-3** Transformation rules are versioned first-class artifacts. Architecture is dictated, not inferred. |
| They did **not** port Apex tests. They extracted each test's logical intent and rewrote suites against the new service boundaries. | **R-4** Never port tests. Extract intent, regenerate. |
| Every generated file had to compile and lint before the next layer, because cascading errors break the pipeline. | **R-5** Hard build gate between layers. |
| Generation got \~80%. The rest needed manual end-to-end validation and cross-team bug bashes. | **R-6** Design the 20% handoff as a product. |

## **1.3 Salesforce's Aura→LWC agent — the structural template**

Shipped as MCP tools in `@salesforce/mcp` (60+ tools, \~15 toolsets; `aura-experts` \+ `lwc-experts`). Documented sequence:

`orchestrate_aura_migration` → `create_aura_blueprint_draft` (YAML IR: purpose, references, children, data, interactions, states) → `enhance_aura_blueprint_draft` → `transition_prd_to_lwc` (source IR → target IR) → `create_lwc_component_from_prd` → `guide_design_general`. Separate `verify_aura_migration_completeness` scores functional/UI parity, event handling, data binding, modularity, error handling, localization, security, performance.

**This is the architecture to copy.** Plan → source-IR → enriched-IR → target-IR → emit → style → score. Not a transpiler, not one mega-prompt.

**Calibration, from their own published walkthrough:** one *simple* component took a Salesforce developer advocate **four prompts and 30–40 minutes**, with three failures the agent couldn't self-resolve — a cross-component event with no target equivalent (human had to know Lightning Message Service was the answer), wrong field access rendering `[object Object]` everywhere, and broken styling needing a corrective prompt. Also documented: enabling all tools at once degrades tool selection.

## **1.4 Ralph loop**

Agent runs in a plain `while` loop; each iteration reads the same goal file, does **one** unit of work, exits. Fresh context every pass — that's the point, not a side effect. State lives in files and git, not conversation. Reliability comes from repetition, not brilliance. Tuning is empirical: each failure reveals a domain, you add a guardrail, repeat. Documented weak spots: **drift**, **uncapped cost**, **ambiguous tasks producing infinite garbage**, **legacy codebases needing human judgment**. Best suited to work with testable outputs.

**That last clause is the whole ballgame.** Ralph over unverifiable work is a token bonfire. Part 3 exists to keep us inside the regime where Ralph works.

## **1.5 Source acquisition & auth**

LWC source retrievable as `LightningComponentBundle` (Metadata API) or via `LightningComponentBundle`/`LightningComponentResource` (Tooling API). Use source format — it preserves the multi-file bundle as discrete files. The Salesforce DX MCP server runs locally, reuses existing CLI auth rather than taking new credentials, and exposes only explicitly-passed orgs and toolsets.

**Auth:** OAuth username-password flow retires Winter '27 (production rollout from Oct 2026); SOAP `login()` retires 1 June 2027; username-password already fails under org-wide MFA (mandatory since 2022). Use **JWT Bearer** or **Client Credentials**, credentials in the CLI keychain or a Named Credential.

---

# **Part 2 — Feasibility corrections**

## **2.1 Never accept a password**

`agent(orgAlias, componentName)` where the alias refers to an org the human pre-authorised via `sf org login web` (JWT for CI). Match the DX MCP posture: reuse existing auth, create no new credentials.

**Hard rule for the whole system:** *No skill, agent, or tool ever requests, stores, logs, or transmits a Salesforce password, security token, or session ID.*

## **2.2 The input is a graph, not a name**

One LWC name transitively pulls in: child LWCs (`<c-*>`, and `<lwc:component lwc:is={ctor}>`), Apex controllers and *their* dependency closure, wire adapters, `@salesforce/schema` imports (with field metadata, types, picklists, FLS), message channels **and their subscribers outside the requested subtree**, custom labels, static resources, custom permissions, `@salesforce/user/*`, `lightning/empApi` subscriptions, and `.js-meta.xml` targets/`targetConfigs` (which define how the component is configured and placed — the React version needs an answer for that).

**First honest output is a scope report,** gated on human confirmation: "you asked for X; that's 14 LWCs, 6 Apex classes, 3 message channels — 2 with subscribers outside scope — and 2 objects."

## **2.3 The three tiers**

**Tier M — MECHANICAL** (deterministic codemod, no LLM): `for:each`/`iterator:*` → `.map()` with stable keys; `if:true`/`lwc:if`/`lwc:elseif`/`lwc:else` → ternary/`&&`; `{prop}` → JSX; `@api` prop → props \+ TS interface; `@api` method → `useImperativeHandle` \+ `forwardRef`; getters → function or `useMemo`; `@track` → ordinary state; `<slot>` → `children`/named-slot props; `connectedCallback`/`disconnectedCallback` → `useEffect([])` \+ cleanup; `errorCallback` → error boundary; kebab tag → PascalCase import.

**Tier A — ASSISTED** (LLM proposes, rules constrain, oracle verifies):

| Construct | Why hard | Target |
| :---- | :---- | :---- |
| `@wire(adapter, {p:'$reactive'})` | LDS is a reactive deduplicating auto-revalidating cache. `$`\-params create implicit reactive deps. Wires emit many times, unrelated to lifecycle. | TanStack Query via shim. `$param` → query key **and** `enabled` guard. |
| `refreshApex` / `getRecordNotifyChange` | Cache invalidation semantics | `invalidateQueries` — needs one global key convention |
| `renderedCallback` | Fires after *every* render; real code guards with a flag | Read for **intent**, re-express. Naive `useEffect` → infinite loops. **Highest bug density.** |
| `this.template.querySelector(All)` | Shadow-scoped | `useRef`; `querySelectorAll` over `for:each` needs ref-callback arrays |
| `CustomEvent` \+ `bubbles`/`composed` | Non-React propagation | Callback props for direct child. **Composed+bubbling across levels → context or bus, or you silently lose behaviour.** |
| Shadow DOM, `:host`, `::part`, `--slds-*` | Real isolation | CSS Modules; `:host` → wrapper. Flattening leaks globally. |
| Lightning Message Service | Cross-DOM pub/sub, possibly non-React subscribers | Bus \+ documented boundary contract. If subscribers stay on-platform this is an **integration**, not a conversion. |
| `NavigationMixin` | pageReference objects | Router adapter \+ mapping table |
| `ShowToastEvent` | Platform toast | Toast provider |
| `lightning/empApi` | CometD streaming | SSE/websocket — backend work |

**Tier H — HUMAN-GATED** (stub \+ spec, never auto-convert): `lightning-record-edit-form`/`record-form`/`record-view-form` (renders layout by metadata, enforces FLS, applies validation rules, handles DML and field-level errors — replacing it is a *product*); `lightning-datatable` with custom types/inline edit/infinite scroll; `lightning-file-upload`; `lightning-input-rich-text`; **anything reading FLS/CRUD/sharing to decide what renders**; `lightning-flow-support`, `lightning-quick-action-panel`, `lightning-record-picker`.

> **Rule:** if correct behaviour depends on org metadata the agent hasn't read, it's Tier H. No exceptions.

## **2.4 Apex → Java is a separate programme (revised, C-4)**

**Path A — Salesforce remains system of record.** Apex → Spring Boot services calling SF REST/Composite/Bulk. SOQL → API query, DML → API write. No governor limits, but API limits and **loss of single-transaction atomicity** — a multi-DML Apex method becomes a distributed-consistency problem needing Composite or compensating actions. Sharing/FLS still enforced by Salesforce *if you run in user context*; an integration user silently removes your security model.

**Path B — data migrates off-platform.** Apex → Spring Boot \+ JPA \+ Postgres. **`with sharing`/`without sharing`/`inherited sharing` have no target equivalent and must be rebuilt as an explicit authz layer.** Triggers, roll-up summaries, validation rules, formula fields and record types are org metadata that Apex silently relied on — **none of it is in the Apex source, so no amount of reading Apex recovers it.**

| Apex | Path A | Path B |
| :---- | :---- | :---- |
| SOQL | REST/Composite query | JPQL / native SQL |
| DML | REST/Composite write | JPA repository |
| Governor limits | API rate limits \+ backoff | pool/GC |
| `with sharing` | run-as-user OAuth context | **explicit authz layer — must be built** |
| Trigger side effects | still fire in org | **gone — reimplement** |
| Formula/rollup fields | still computed by org | **gone — reimplement** |
| `@AuraEnabled(cacheable=true)` | `Cache-Control` \+ TanStack | same |
| `Database.SaveResult` partial success | Composite `allOrNone` | transaction boundary |
| `Test.startTest`/`@isTest` | JUnit \+ WireMock | JUnit \+ Testcontainers |

**Default to Path A.** It preserves security model, automation and data, and it's reversible. **Path B requires an explicit written decision per bounded context and should be scoped as its own programme with its own research phase** — this document does not adequately cover it, and pretending otherwise is how the project fails.

Either path: apply R-3 — no static Java utility classes. Constructor-injected services, explicit state separation, per rule file.

## **2.5 The agent must be able to recommend *not* converting**

- **LWC Open Source / LWR** — if the goal is "leave the org" rather than "reach React," open-source LWC preserves all component logic at a fraction of the cost.  
- **Strangler fig** — keep the LWC on-platform, surface it in the MFE shell, convert only what needs to be React.

An agent that only knows how to convert will convert things that shouldn't be. Build `dont-convert` into the analyzer as a first-class recommendation.

---

# **Part 3 — The differential oracle (NEW — the centrepiece)**

**The insight:** LWC runs off-platform. `@lwc/engine-dom` \+ `@lwc/synthetic-shadow` render a real LWC in Node/jsdom with no org. So we can execute both implementations under identical conditions and *mechanically* diff behaviour — no pre-existing tests required.

This converts the project from "we hope the LLM understood the component" to "we can prove it did, on observed paths."

## **3.1 Harness architecture**

                    ┌─────────────── FIXTURE ────────────────┐

                    │ props · mocked wire/Apex responses ·    │

                    │ recorded interaction script             │

                    └────────┬───────────────────┬────────────┘

                             │                   │

              ┌──────────────▼─────┐   ┌─────────▼──────────────┐

              │  LWC-OSS renderer  │   │   React renderer (RTL)  │

              │  @lwc/engine-dom   │   │                         │

              │  \+ adapter mocks   │   │  \+ MSW / shim mocks     │

              └──────────────┬─────┘   └─────────┬──────────────┘

                             │                   │

                    ┌────────▼───────────────────▼────────┐

                    │           DIFFERS                    │

                    │  1\. normalised DOM tree              │

                    │  2\. accessibility tree               │

                    │  3\. emitted-event log                │

                    │  4\. outbound-call log (order+args)   │

                    │  5\. text content                     │

                    │  6\. focus sequence                   │

                    └────────┬─────────────────────────────┘

                             │

                      PASS / DIFF REPORT

## **3.2 The five diffs, and what each catches**

| Diff | Normalisation | Catches |
| :---- | :---- | :---- |
| **DOM structure** | strip shadow boundaries, strip framework-generated attrs and class hashes, collapse whitespace, sort stable attrs | wrong conditionals, wrong iteration, missing slots, structural drift |
| **Accessibility tree** | computed roles, names, states, relationships | the real "did it look/behave the same" test — semantic, stable, replaces pixel parity (C-2) |
| **Emitted events** | name, detail shape, order, bubbles/composed intent | lost `CustomEvent`s, wrong detail shape, LMS gaps |
| **Outbound calls** | adapter/method, args, **call order**, call count | wrong wire params, missing `enabled` guard (extra call on mount with undefined id), `refreshApex` gaps, N+1 |
| **Text content** | trimmed, locale-fixed | **`[object Object]`** — the exact class of bug that broke Salesforce's own agent. Caught automatically here. |

## **3.3 Fixture generation — three tiers**

1. **Synthetic (free, immediate).** Derive from the SOURCE contract: each `@api` prop gets boundary values from its type; each wire gets a schema-shaped response, an error response, and an undefined/loading state. Cheap, covers the common paths, needs no org.  
2. **Recorded (high fidelity).** Instrument the live LWC in a sandbox; capture the real sequence of Apex calls and UI-API responses during real user flows. Replay against both implementations. **This is what catches shape bugs that synthetic fixtures miss** — real record payloads are nested (`fields.X.value`), synthetic ones are whatever you guessed.  
3. **Adversarial (LLM-generated).** Null fields, empty lists, permission-denied responses, slow/failed calls, rapid prop churn.

## **3.4 What the oracle does *not* prove**

Be honest with yourself about this, because the temptation to over-trust a green oracle is exactly how the project fails:

- **Only observed paths.** Unexercised branches stay unverified. Track fixture branch coverage against the source and report it.  
- **Not visual fidelity.** DOM+a11y equivalence with wrong CSS still passes. Styling needs human sign-off (or Storybook \+ visual review) — just not a fake 95% threshold.  
- **Not performance.** A correct-but-100×-slower component passes.  
- **Not Tier H.** A stub has nothing to diff. Oracle green on a graph containing Tier H stubs means nothing about the app.  
- **Not integrations.** LMS subscribers outside scope, `empApi` streams, and real DML are mocked. Mocked-correct ≠ integrated-correct.

**Report these as explicit coverage metrics, not as footnotes.**

## **3.5 Why this is worth more than half of v1's Phase 2**

It is the difference between Ralph grinding productively and Ralph grinding expensively. With a real gate, the loop's failure output is a *diff*, which is a specific, actionable, self-correcting signal. Without it, the failure output is "tests pass" and the errors accumulate silently until a human reads 200 components.

---

# **Part 4 — Pipeline (revised)**

 S-1 CENSUS      org-wide static analysis → what actually exists    \[ONCE, Phase 0\]

──────────────────────────────────────────────────────────────────────────────

 S0  ACQUIRE     org alias → retrieve bundle \+ dependency closure

 S1  GRAPH       parse → dep graph → topo sort → scope report → HUMAN CONFIRM

 S2  EXTRACT     per node: SOURCE CONTRACT (XML IR)

 S3  ENRICH      resolve schema/labels/permissions; classify M / A / H

 S3b FIXTURES    generate synthetic \+ attach recorded fixtures        \[NEW\]

 S4  DESIGN      SOURCE → TARGET contract, decisions \+ fidelity-loss

 S5  EMIT        codemod (M) · LLM+rules (A) · stub+spec (H)

 S6  VERIFY      build gate → ORACLE DIFF → HARD GATE                 \[REWRITTEN\]

 S7  SCORE       parity scorecard \+ coverage \+ unconverted manifest

S0→S6 runs per graph node, **leaf-first**. A node cannot enter S4 until every dependency has passed S6. That's R-1/R-2/R-5 enforced structurally rather than by instruction.

## **4.1 Determinism budget**

| Stage | Mechanism |
| :---- | :---- |
| Template → JSX | **deterministic codemod** (`@lwc/template-compiler` AST → JSX printer) |
| Decorators, lifecycle, getters | **deterministic codemod** |
| Base component → React | **table lookup** from catalog |
| Wire/LMS/nav/refresh | LLM constrained by skill rules \+ shim API |
| `renderedCallback` intent | LLM \+ mandatory human review |
| Apex → Java service design | LLM constrained by architecture rules |
| Tier H | stub \+ spec, no code |

**Target ≥60% of emitted lines from deterministic paths.** Every line an LLM doesn't write can't silently drift between runs — and it's the biggest cost lever on a Ralph loop.

## **4.2 Runtime shim — build before the agent**

`@migration/salesforce-runtime`: `lds/` (useRecord, useObjectInfo, useListView, useRelatedList, useApex, refreshApex, notifyRecordUpdate — TanStack-backed), `query-keys/` (the one canonical convention), `events/` (LMS bridge, toast provider, composed-event context), `navigation/` (pageReference → route), `schema/` (generated TS types from Describe \+ FLS helpers), `i18n/`, `security/` (useFieldAccess, `<IfPermitted>`), `testing/`.

Hand-written, hand-tested, **frozen test suite the loop may not edit**. Without it, every component invents its own data fetching and the codebase is unmaintainable by component \#20.

---

# **Part 5 — The Contract (IR)**

Two XML contracts per node — **SOURCE** (what the LWC does) and **TARGET** (what React will do), both committed. Diffing them is how a human reviews an architectural decision without reading generated code.

\<source-contract schema="2.0" node="propertySummary" type="lwc"\>

  \<identity\>

    \<api-name\>propertySummary\</api-name\>

    \<bundle-path\>force-app/main/default/lwc/propertySummary\</bundle-path\>

    \<source-hash\>sha256:…\</source-hash\>

    \<api-version\>62.0\</api-version\>

  \</identity\>

  \<purpose\>

    \<one-line\>Displays the selected property and its assigned broker.\</one-line\>

    \<user-visible-behavior\>\<\!-- prose; most important field for a reviewer \--\>\</user-visible-behavior\>

  \</purpose\>

  \<public-api\>

    \<property name="recordId" type="string" decorator="api" required="true"/\>

    \<method name="refresh" decorator="api" returns="void"/\>

  \</public-api\>

  \<exposure\>

    \<target\>lightning\_\_RecordPage\</target\>

    \<target-config target="lightning\_\_AppPage"\>

      \<property name="title" type="String" default="Summary"/\>

    \</target-config\>

  \</exposure\>

  \<data-dependencies\>

    \<wire adapter="getRecord" module="lightning/uiRecordApi" tier="A"\>

      \<param name="recordId" reactive-source="recordId"/\>

      \<param name="fields" value="\[NAME\_FIELD, PRICE\_FIELD\]"/\>

      \<emits-multiple-times\>true\</emits-multiple-times\>

      \<cacheable\>true\</cacheable\>

    \</wire\>

    \<apex class="PropertyController" method="getBroker" cacheable="true" call-style="wire" tier="A"/\>

    \<schema-import field="Property\_\_c.Name" type="Text" fls-sensitive="true"/\>

  \</data-dependencies\>

  \<lifecycle\>

    \<hook name="renderedCallback" tier="A" guarded="true"\>

      \<intent\>One-time chart init after first paint.\</intent\>

      \<risk\>Naive useEffect mapping will re-run and leak. REVIEW.\</risk\>

    \</hook\>

  \</lifecycle\>

  \<events\>

    \<emits name="propertyselected" bubbles="false" composed="false" detail-shape="{id:string}" tier="M"/\>

    \<listens channel="PropertySelected\_\_c" mechanism="LMS" tier="A"\>

      \<external-subscribers\>propertyTile (Aura), listView (LWC)\</external-subscribers\>

      \<note\>Subscribers OUTSIDE scope — boundary contract required.\</note\>

    \</listens\>

  \</events\>

  \<children\>

    \<child tag="c-broker-card" node="brokerCard" passes="brokerId" listens="oncontact"/\>

    \<base-component tag="lightning-card" tier="M" target-candidate="Card"/\>

    \<base-component tag="lightning-record-edit-form" tier="H"

                   reason="metadata layout \+ FLS \+ validation \+ DML"/\>

  \</children\>

  \<security\>

    \<fls-dependent\>true\</fls-dependent\>

    \<sharing-dependent\>false\</sharing-dependent\>

  \</security\>

  \<oracle-plan\>                                    \<\!-- NEW in v2 \--\>

    \<fixture kind="synthetic" cases="12"/\>

    \<fixture kind="recorded" source="sandbox-2026-08-11" flows="3"/\>

    \<branch-coverage-target\>0.85\</branch-coverage-target\>

    \<diffs\>dom, a11y, events, calls, text\</diffs\>

  \</oracle-plan\>

  \<classification\>

    \<tier-m count="14"/\>\<tier-a count="5"/\>\<tier-h count="1"/\>

    \<auto-convertible-estimate\>0.72\</auto-convertible-estimate\>

  \</classification\>

\</source-contract\>

TARGET contract mirrors it with `<decision>` elements:

\<decision id="D-wire-getRecord" tier="A" confidence="high"\>

  \<chose\>TanStack useQuery, key \['record', recordId, fieldSetHash\]\</chose\>

  \<rejected\>useEffect+fetch — loses dedup, revalidation, cache sharing\</rejected\>

  \<fidelity-loss\>

    LDS auto-revalidates when any component mutates the record. Replicated only for

    mutations routed through our mutation layer. Out-of-band org changes will NOT

    refresh. ACCEPTED.

  \</fidelity-loss\>

  \<rule-source\>skills/decisions/wire-to-query/SKILL.md\#getRecord\</rule-source\>

  \<oracle-evidence\>diff/propertySummary/calls.json — 12/12 fixtures match\</oracle-evidence\>

\</decision\>

**`<fidelity-loss>` is the difference between a migration you can trust and one you can't.** Reviewers read the loss log, not the diff.

---

# **Part 6 — Skill library (census-scoped)**

## **6.1 Principles**

1. **Progressive disclosure.** `SKILL.md` is a router under \~500 lines. Detail in `references/`, loaded only when the node's contract demands it. A component with no `@wire` never loads the wire reference.  
2. **Data, not prose.** Mappings live in machine-readable catalogs both the codemod and the LLM consume. Prose mappings drift and can't be regression-tested.  
3. **One skill \= one decision domain.**  
4. **Every rule carries a rationale and a failure mode.** Rules only survive iterative refinement if they explain themselves.  
5. **Scope tools per stage.** Enabling everything degrades tool selection (documented effect).  
6. **Build only what the census says exists (C-3).**

## **6.2 Structure**

skills/

├── ROUTER.md                     \~200 lines, read every iteration

├── catalog/                      MACHINE-READABLE — codemod \+ LLM

│   ├── base-components.xml       CENSUS-SCOPED (expect \~25, not \~90)

│   ├── wire-adapters.xml

│   ├── modules.xml

│   ├── apex-types.xml

│   ├── soql-patterns.xml

│   └── page-references.xml

├── lwc/          template-language · reactivity · lifecycle · composition ·

│                 events · shadow-dom · data-services · base-components ·

│                 platform-services · security · metadata

├── react/        component-design · hooks-semantics · state-management ·

│                 data-fetching · styling · forms · accessibility · testing · mfe

├── apex/         language · soql-sosl · dml-transactions · governor-limits ·

│                 sharing-security · async · triggers · testing

├── java/         service-layer · salesforce-client · persistence · security ·

│                 api-design · testing

├── decisions/    tier-classification · wire-to-query · event-topology ·

│                 state-placement · record-form-replacement · apex-path-selection ·

│                 dont-convert · fidelity-loss-accounting

├── pipeline/     graph-construction · contract-extraction · contract-transition ·

│                 fixture-generation · emission · verification · scoring

└── ops/          org-access · ralph-loop · human-handoff · oracle-harness

**Write order:** `catalog/` → `pipeline/` → `decisions/` → `lwc/` → `react/` → `apex/` → `java/` → `ops/`. Decision skills before knowledge skills — knowledge skills exist to serve decisions, and writing them first produces encyclopaedias nobody reads.

## **6.3 Skill template**

\---

name: wire-to-query

tier: decision

version: 1.0.0

loads-when: source-contract//data-dependencies/wire

token-budget: 1800

references: \[references/query-key-design.md, catalog/wire-adapters.xml\]

\---

\<skill\>

\<purpose\>Convert @wire into TanStack Query calls against @migration/salesforce-runtime,

preserving reactivity and cache semantics.\</purpose\>

\<preconditions\>

  \<requires\>TARGET contract has a data-layer decision\</requires\>

  \<requires\>@migration/salesforce-runtime is green on the graph\</requires\>

\</preconditions\>

\<decision-procedure\>

  \<step n="1"\>Look up adapter in catalog/wire-adapters.xml. If absent, STOP and escalate.

  Never invent a mapping.\</step\>

  \<step n="2"\>Each $-prefixed param becomes a query-key segment AND an \`enabled\` guard.

  LWC wires do not fire on undefined reactive params; useQuery WILL unless guarded.

  This is the \#1 defect in naive conversion and the oracle's call-diff catches it.\</step\>

  \<step n="3"\>cacheable=true → staleTime per catalog. cacheable=false → imperative, not a

  wire; route to the mutation path.\</step\>

  \<step n="4"\>Wire targeting a FUNCTION re-runs on emit — map to select/onSuccess, not to

  a useEffect on data.\</step\>

  \<step n="5"\>Record a \&lt;decision\&gt; with explicit \&lt;fidelity-loss\&gt; and

  \&lt;oracle-evidence\&gt;.\</step\>

\</decision-procedure\>

\<rules\>

  \<rule id="WQ-1" severity="error"\>No raw fetch. All I/O through the shim.\</rule\>

  \<rule id="WQ-2" severity="error"\>Query keys MUST follow catalog convention. Ad-hoc keys

  silently break invalidation app-wide.\</rule\>

  \<rule id="WQ-3" severity="error"\>Every reactive param needs an \`enabled\` guard.\</rule\>

  \<rule id="WQ-4" severity="warn"\>If the data is mutated anywhere in the graph, record an

  invalidation edge in the TARGET contract.\</rule\>

\</rules\>

\<failure-modes\>

  \<failure symptom="oracle call-diff: extra call on mount with undefined id"\>Missing enabled guard (WQ-3)\</failure\>

  \<failure symptom="oracle text-diff: \[object Object\]"\>LDS returns

  {fields:{X:{value,displayValue}}}, not flat. Use the shim's getFieldValue.

  (Observed failure in Salesforce's own agent.)\</failure\>

  \<failure symptom="stale data after save"\>Missing invalidation edge (WQ-4)\</failure\>

  \<failure symptom="infinite refetch"\>Unstable query key — object identity in key array\</failure\>

\</failure-modes\>

\<escalate-to-human\>

  \<when\>Adapter not in catalog\</when\>

  \<when\>Wire feeds a security-relevant conditional render\</when\>

  \<when\>Reactive dependency chain exceeds 2 hops\</when\>

\</escalate-to-human\>

\</skill\>

`<failure-modes>` is the Ralph tuning surface — every defect the loop produces becomes a new entry here, not a longer prompt. Note the symptoms are now phrased as **oracle diff signatures**, which makes them mechanically matchable.

## **6.4 Skill regression suite (NEW — C-6)**

`skills/` is software. It gets CI:

on skill change:

  1\. re-run full golden corpus (40–60 components) through S2→S7

  2\. report delta: newly-passing, newly-failing, score changes

  3\. block merge on any regression

  4\. record token cost delta per component

Without this you tune blind. With it, a skill edit is a measurable experiment.

## **6.5 Catalog entry format**

\<component tag="lightning-datatable" tier="H" coverage="partial" census-usage="34"\>

  \<purpose\>Sortable, selectable, inline-editable, virtualised grid.\</purpose\>

  \<targets\>

    \<target lib="tanstack-table" name="useReactTable" fidelity="0.85" recommended="true"/\>

    \<target lib="dsr" name="DataTable" fidelity="0.55"/\>

  \</targets\>

  \<attributes\>

    \<attr from="key-field" to="getRowId" transform="fn"/\>

    \<attr from="hide-checkbox-column" to="enableRowSelection" transform="negate"/\>

  \</attributes\>

  \<events\>

    \<event from="onrowselection" to="onRowSelectionChange"

           detail-shape-change="event.detail.selectedRows → RowSelectionState"/\>

  \</events\>

  \<unsupported\>

    \<feature name="custom data types"\>Bespoke cell renderers. HUMAN.\</feature\>

    \<feature name="inline edit \+ draft values"\>Full reimplementation. HUMAN.\</feature\>

  \</unsupported\>

  \<escalate-if\>columns contain type="action" or a custom type\</escalate-if\>

\</component\>

`census-usage` drives build priority. Note the count comes from S-1, so you build the catalog in descending order of actual use.

---

# **Part 7 — Agent topology & Ralph protocol**

| Agent | Stage | Tools | Writes |
| :---- | :---- | :---- | :---- |
| Orchestrator | all | loop, git, state files | `plan.md`, `progress.txt` |
| Surveyor | S-1 | parsers, fs | `census.json`, `census-report.md` |
| Acquirer | S0 | DX MCP (`metadata`) | `/source/**` |
| Cartographer | S1 | parsers, graph | `graph.json`, `scope-report.md` |
| Contract Analyst | S2–S3 | parsers, DX MCP (describe) | `contracts/source/*.xml` |
| Fixture Builder | S3b | harness, replay capture | `fixtures/**` |
| Architect | S4 | decision skills | `contracts/target/*.xml` |
| Emitter (React) | S5 | codemods, fs | `mfe/src/**` |
| Emitter (Java) | S5 | codemods, fs | `services/**` |
| Verifier | S6 | tsc, eslint, vitest, **oracle** | `verify/*.json`, `diff/**` |
| Scorer | S7 | — | `scorecard.md`, `unconverted.md` |

**Each subagent sees only its stage's skills and tools.** The Emitter never sees org credentials. The Acquirer never writes to `mfe/`.

## **7.1 Loop**

while :; do

  cat GOAL.md | claude \-p \--dangerously-skip-permissions   \# sandboxed container ONLY

  git add \-A && git commit \-m "ralph: $(date \-u \+%FT%TZ)" || true

  grep \-q "MIGRATION\_COMPLETE" progress.txt && break

  \[ "$(cat .iter)" \-gt 400 \] && { echo "ITERATION CAP"; break; }

done

`GOAL.md`:

Read plan.md, prd.json, progress.txt, CLAUDE.md.

Pick the SINGLE highest-priority task whose dependencies all show passes:true.

Do ONLY that task. Run its done-check. Update prd.json, append to progress.txt. Commit. Exit.

Never work on a node whose dependencies aren't verified green.

Never modify @migration/salesforce-runtime to make a component pass — fix the component.

  If the shim is genuinely wrong, FLAG FOR HUMAN and stop.

Never modify a fixture to make an oracle diff pass. Fixtures are evidence, not knobs.

Never invent a base-component or wire-adapter mapping. Escalate.

Never emit code for a Tier-H construct. Emit a stub and a spec.

Fail a done-check 3 times → mark BLOCKED with a diagnosis, move on.

When all tasks pass or are BLOCKED/HUMAN, append MIGRATION\_COMPLETE.

| Ralph risk | Mitigation |
| :---- | :---- |
| Drift | Fixed pipeline; loop can't invent stages; topological order removes "what next?" freedom |
| Uncapped cost | Iteration cap, per-node token budget, ≥60% deterministic emission, 3-strike block |
| Ambiguous tasks | Every task derives from a contract with a machine-checkable done-check |
| Legacy judgment | Tier-H escalation; scope report human-gated; reviewer packets |
| **Cheating the gate** | **Fixtures and shim tests are frozen and immutable to the loop** — this is the rule that makes the oracle trustworthy |

## **7.2 Handoff**

Once signed off, convert this into `plan.md`/`prd.json`/`progress.txt`/`CLAUDE.md` with a dependency-ordered atomic backlog and per-task done-checks using the `autonomous-build-orchestrator` skill. Don't hand-write those files.

---

# **Part 8 — Verification (rewritten)**

## **8.1 The gate**

| \# | Check | Command | Threshold |
| :---- | :---- | :---- | :---- |
| 1 | Types | `tsc --noEmit` | 0 errors |
| 2 | Lint | `eslint` \+ custom rules (`no-raw-fetch`, `query-key-convention`, `no-tier-h-code`) | 0 errors |
| 3 | Build | `vite build` | success |
| 4 | **Oracle: DOM diff** | harness | 0 structural diffs |
| 5 | **Oracle: a11y-tree diff** | harness | 0 diffs |
| 6 | **Oracle: event-log diff** | harness | 0 diffs |
| 7 | **Oracle: call-log diff** | harness | 0 diffs in adapter, args, order |
| 8 | **Oracle: text diff** | harness | 0 diffs |
| 9 | **Fixture branch coverage** | harness | ≥ contract target (default 0.85) |
| 10 | a11y rules | `axe` | no violations ≥ serious |
| 11 | Contract completeness | every SOURCE element addressed or waived in TARGET | 100% |
| 12 | Styling | human sign-off / Storybook review | reviewed |

Checks 1–3 mirror the "compile and lint before the next layer" rule that prevents cascading errors. Checks 4–9 are new in v2 and are where the actual confidence comes from. **Check 12 is deliberately human** — no fake automated threshold (C-2).

## **8.2 Scorecard**

Dimensions mirroring Salesforce's own verification tool, plus ours:

\<scorecard node="propertySummary" overall="78" verdict="REVIEW"\>

  \<dimension name="functional-parity" score="85" evidence="oracle:12/12 fixtures"/\>

  \<dimension name="ui-parity"         score="92" evidence="a11y-tree exact; CSS human-reviewed"/\>

  \<dimension name="event-handling"    score="60"\>

    \<note\>LMS boundary: 2 subscribers remain on-platform. Integration untested.\</note\>

  \</dimension\>

  \<dimension name="data-binding"      score="80"/\>

  \<dimension name="security"          score="55"\>

    \<note\>FLS conditional render replaced with static render. \*\*BLOCKING.\*\*\</note\>

  \</dimension\>

  \<dimension name="accessibility"     score="88"/\>

  \<coverage branch="0.87" fixtures-recorded="3" fixtures-synthetic="12"/\>

  \<fidelity-losses accepted="3" blocking="1"/\>

\</scorecard\>

**Any security finding is blocking regardless of overall score.** A component rendering a field the user can't see is a data-exposure bug, not a styling bug.

## **8.3 Non-code deliverables (equal standing)**

`census-report.md` · `scope-report.md` · `unconverted.md` (Tier-H stubs \+ specs \+ estimates) · `fidelity-log.md` · `integration-boundaries.md` · `coverage-report.md` · `review/<node>.md`

Generation gets \~80%; the rest needs manual end-to-end validation and bug bashes. **Design the 20% handoff as a product, not an apology.** A run that produces a fully-converted app with an *empty* fidelity log and unconverted manifest has failed — it means the agent papered over the gaps, and the gaps are where the incidents live.

---

# **Part 9 — Build plan (restructured)**

## **Phase 0 — Census \+ walking skeleton (2 weeks, mostly human) ← START HERE**

**0a. Component census (3–5 days).** Static-analyse the whole org:

- every `lightning-*` used, with counts  
- every wire adapter used, with counts  
- LWCs using `renderedCallback`, `querySelectorAll`, composed+bubbling events, LMS, `empApi`  
- LWCs touching FLS/CRUD/sharing  
- Apex classes reachable from LWC, with dependency depth  
- existing Jest coverage %  
- **output: the real Tier M/A/H distribution for *your* code**

**0b. Walking skeleton (5 days).** Take one trivial LWC (props \+ one child \+ one `@wire` \+ one `CustomEvent`) through S0→S7 **by hand**, writing down every decision. Stand up the oracle harness on it. That transcript is the pipeline's actual specification and will surface three problems this document hasn't anticipated.

**0c. Seven decisions:**

| ID | Decision | Default |
| :---- | :---- | :---- |
| D-1 | Apex Path A vs B | **A** (B \= separate programme) |
| D-2 | MFE shell | Module Federation |
| D-3 | UI library | headless \+ SLDS theme |
| D-4 | Data layer | TanStack Query |
| D-5 | TS strictness | strict |
| D-6 | Auth | JWT Bearer — never password |
| D-7 | Ralph autonomy tier \+ spend cap | sandboxed, capped |

**Gate:** if the census says \>35% Tier H, stop and re-scope. See Part 10\.

## **Phase 1 — Oracle \+ shim \+ catalogs (4–5 weeks)**

1. **Oracle harness** — LWC-OSS renderer, adapter mocks, five differs, fixture recorder. *This is now the first build artifact, not verification afterthought.*  
2. `@migration/salesforce-runtime` — hand-written, frozen tests.  
3. `catalog/base-components.xml` — **census-ordered**, only what's used.  
4. `catalog/wire-adapters.xml`.  
5. Deterministic template codemod. Benchmark against `lwc2react`'s rules.  
6. **Golden corpus: 40–60 components from your org**, hand-migrated, oracle-green.

## **Phase 2 — Skills (3–4 weeks)**

Write order per 6.2. Every skill lands with its regression-suite result.

## **Phase 3 — Backlog \+ loop (1–2 weeks)**

Run `autonomous-build-orchestrator`. Point the loop at the **golden corpus only**. Tune until it reproduces all 40–60 hand-migrations oracle-green from scratch. Only then aim at unseen components.

## **Phase 4 — Pilot (4 weeks)**

One real subtree, 10–20 components. Measure: % auto-converted, defects/component, human minutes/component, cost/component, oracle branch coverage. Baseline to beat: four prompts / 30–40 min / one simple component / expert human in the loop.

## **Phase 5 — Scale**

Only after Phase 4 metrics clear the thresholds in Part 10\.

**Total to a defensible go/no-go: \~7 weeks.** That's the number that matters, not the total programme length.

---

# **Part 10 — Kill criteria (NEW)**

Define these now, while nobody is emotionally invested.

| Gate | Condition | Action |
| :---- | :---- | :---- |
| After Phase 0a | Tier H \> 35% of components | **STOP.** Reconsider LWC-OSS or strangler-fig. Conversion economics don't work. |
| After Phase 0a | \>50% of components touch FLS/sharing for rendering | **STOP.** This is a security-rewrite, not a migration. |
| After Phase 0b | Oracle can't render your LWCs off-platform (Locker/LWS-dependent, exotic deps) | **STOP or re-plan.** Without the oracle, confidence drops to v1 levels — see Part 12\. |
| After Phase 1 | Golden corpus can't reach oracle-green *by hand* on ≥80% | **STOP.** If humans can't, the loop certainly can't. |
| After Phase 3 | Loop can't reproduce ≥70% of the corpus unattended | Re-scope to assistive tooling, not autonomous migration. Still valuable. |
| After Phase 4 | Human minutes/component ≥ 60% of a hand rewrite | **STOP.** Automation isn't paying. |
| Any time | Cost/component \> hand-rewrite cost | STOP |
| Any time | A security finding ships to prod undetected | Full stop, post-mortem, re-gate |

**The most likely outcome is not binary.** Expect "assistive tooling that halves the work on Tier M/A components and flags Tier H accurately." That is a *good* outcome. Plan for it rather than treating it as failure.

---

# **Part 11 — Risk register**

| \# | Risk | Sev | Mitigation |
| :---- | :---- | :---- | :---- |
| R1 | Silent security regression (FLS/sharing render flattened) | **Critical** | Security dimension blocking; contract flags; Tier H for metadata-driven; mandatory human review |
| R2 | Path A/B decided implicitly per class → incoherent backend | **Critical** | D-1 gated Phase 0; `apex-path-selection` refuses without explicit flag; Path B \= separate programme |
| R3 | **Oracle can't run your components off-platform** | **Critical (NEW)** | Test in Phase 0b before committing to Phase 1; kill criterion defined |
| R4 | **Over-trusting a green oracle** | **High (NEW)** | Branch coverage reported as a first-class metric; §3.4 limits documented in every scorecard |
| R5 | Cascading errors from unverified deps | High | Topological order \+ hard gate |
| R6 | Ralph drift / token burn | High | Fixed pipeline, caps, 3-strike block, ≥60% deterministic |
| R7 | Base-component gap found mid-build | High | Census-first; catalog in Phase 1 |
| R8 | LMS/event boundaries outside scope | High | Scope report; `integration-boundaries.md` |
| R9 | `renderedCallback` mapped naively | Medium | Always Tier A \+ human review; oracle call-diff catches loops |
| R10 | Query-key convention drift | Medium | ESLint rule; convention in shim, not prompts |
| R11 | Apex tests ported rather than re-derived | Medium | R-4 hard rule; lint for ported assertions |
| R12 | Agent converts what shouldn't be converted | Medium | `dont-convert` skill first-class |
| R13 | Auth deprecation breaks pipeline | Medium | JWT from day one; no password path exists to break |
| R14 | Contract drift after extraction | Low | `source-hash`; re-verify before emit |
| R15 | Over-scoped tool surface degrades selection | Low | Per-stage scoping |

---

# **Part 12 — Honest confidence**

**With the oracle (this document, v2):**

| Bar | Confidence |
| :---- | :---- |
| Emits React that compiles, renders, structurally resembles source | \~90% |
| Presentational components (props/slots/children, no wire) production-correct | \~90% |
| Typical business component (wire \+ Apex \+ children \+ events), correct **after human review** | \~70% |
| Same, **fully autonomous** | \~25% |
| Apex→Java **Path A** (SF stays SoR) production-usable | \~45% |
| Apex→Java **Path B** (data migrates) | \~15% — needs its own programme |
| Whole app, behaviour-identical, unattended | \~5% |

**Without the oracle (v1):** subtract roughly 10–20 points from every frontend row. The middle row — the one that decides whether this is worth doing — was \~60% in v1 and is \~70% here.

**Highest-confidence claim:** \~90% that Phase 0 (2 weeks) tells you decisively whether to proceed. That's the cheapest information in the plan.

**What this will not achieve at any budget:** metadata-driven components (`record-edit-form` et al. — that's building a form engine); sharing/FLS semantics under Path B; anything relying on org-side invisible work (triggers, flows, validation rules, rollups — Path B loses all of it and the Apex source contains no record it existed); and any *guarantee* — the oracle proves equivalence on observed paths only.

---

# **Part 13 — Sources**

Salesforce Engineering, "How AI-Driven Refactoring Cut a 2-Year Legacy Code Migration to 4 Months" (Dec 2025\) · Salesforce Developers Blog, "Migrate from Aura to LWC with Agentforce Vibes" (Jan 2026\) · LWC Developer Guide: Aura-to-LWC Migration Tools (Beta), Migration Verification Tools (Beta), Use DX MCP Tools for LWC (Beta), Migration Strategy, Understand the Wire Service, Supported Salesforce APIs · `salesforcecli/mcp` (Salesforce DX MCP Server) · `blittle/lwc2react` · `salesforce/design-system-react` \+ "Open Sourcing Design System React" · `ccoenraets/lightning-react` · ghuntley.com/loop and secondary analyses of the Ralph Wiggum loop · Salesforce Help 000886201; Winter '27 OAuth username-password retirement; SOAP `login()` retirement 1 June 2027 · "An Introduction to Apex for Java Developers" · Tooling/Metadata API `LightningComponentBundle`.

*All paraphrased; no source text reproduced.*  
