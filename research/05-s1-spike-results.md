# **S-1 SPIKE RESULTS — Oracle Feasibility**

## **Executed 11 August 2026 · Verdict: PASS**

**What was run:** a working harness built on @salesforce/sfdx-lwc-jest v7.9.0, Node 22.22, @lwc/engine-dom 8.28.2, dom-accessibility-api 0.7.1. Fourteen assertions across three suites. All pass. Total runtime **1.3 s**.

**Important caveat:** this ran against a *synthetic* LWC I wrote to exercise every construct the oracle must handle — @api, @wire with a reactive $param, an Apex wire, lwc:if/else, a child c-\* component, a composed CustomEvent, three lightning-\* base components, a named slot, and a guarded renderedCallback. **It has not yet run against a component from your org.** That is now a one-hour job, not a three-day one — the harness is built.

The runnable artifact is oracle-spike.zip.

# **Criteria results**

| # | Criterion | Result |
| :---- | :---- | :---- |
| 1 | Renders with all @salesforce/\* imports resolved | ✅ @salesforce/schema/\*, @salesforce/apex/\*, lightning/uiRecordApi all resolved with zero custom stubbing |
| 2 | shadowRoot populated and traversable | ✅ Full markup available |
| 3 | getLastConfig() returns resolved wire config with $params substituted | ✅ Both LDS and Apex wires |
| 4 | Accessibility tree computable | ✅ computeAccessibleName() returned "Ocean View Estate" |
| 5 | **Stubbed** **lightning-\*** **identifiable by tag and props** | ✅ **— but not the way R1.3 predicted. See F1.** |

**Criterion 5 was the pass/fail and it passes** — with a correction that changes the normaliser design.

# **Findings**

## **F1 ⚠️ — Base-component props are JS properties, not attributes**

lightning-card.attributes.length === 0. Zero. But:

    card.title    === "Property Summary"
    card.iconName === "standard:account"

**Reading** **element.attributes** **returns nothing for base components.** My first normaliser did exactly that and produced an empty boundary tree — a silent false-pass that would have made the oracle blind.

Worse: the stub's prototype exposes only ["innerHTML","outerHTML","textContent","addEventListener"]. **You cannot discover the public API by enumeration.** You must know the prop names in advance.

**Consequence — a hard architectural requirement:** catalog/base-components.xml must enumerate the readable props for every base component, and the normaliser reads them by name. The catalog is no longer optional infrastructure; **the oracle cannot function without it.** It now serves three consumers: the codemod, the LLM, and the differ.

## **F2 — Stubs have a shadow root containing only slots**

    lightning-card.shadowRoot.innerHTML
      = "<slot></slot><slot name='actions'></slot><slot name='footer'></slot><slot name='title'></slot>"

So slotted content lives in **light DOM** while the stub's own render is shadow. A traversal that follows only shadowRoot stops dead at the first base component. My first pass did this and returned a two-node tree.

**Consequence:** traverse both, tracking which is which. That distinction turns out to matter — see F4.

## **F3 ✅ — Child** **c-\*** **components render for real**

Only lightning-\* is stubbed. c-broker-card has a genuine shadow root with real rendered content and correctly-passed props. **Your own component tree renders faithfully at every level.** This is the finding that makes the whole approach viable.

## **F4 ⚠️ — Text suppression must distinguish shadow from slotted content**

lightning-formatted-number renders **nothing** — value=1250000 sits on the element, no text output. So text captured inside a base component is meaningless, and I suppressed it.

That was too aggressive. It also suppressed \<h2\>Ocean View Estate\</h2\> — which is *our* content, merely slotted into lightning-card. **And losing that text loses** **[object Object]** **detection, the single most valuable thing the oracle does.**

Correct rule: suppress text rendered **by** a base component's own shadow root; keep text in slotted light-DOM children. One-line fix, now in the artifact. Before and after:

    before:  · h2                    ← text gone, oracle blind
    after:   · h2 "Ocean View Estate" ← [object Object] detectable

**This is exactly the class of bug that would have shipped silently.** The oracle would have been green on a component rendering [object Object] everywhere.

## **F5 ✅ — The undefined-reactive-param signal is detectable**

With no recordId set:

    { "fields": [...], "recordId": undefined }

The key is present; the value is undefined. So the diff rule is precise:

**If any reactive param in the LWC config resolves to** **undefined****, the React side must have issued zero calls for that query.**

This is the missing-enabled-guard defect, mechanically detectable. Note the nuance: the test adapter records config regardless of whether real LDS would have fetched, so infer from the *values*, never from call presence on the LWC side.

## **F6 ✅ — Composed events cross boundaries correctly**

Child dispatches contact (bubbles + composed) → parent handler fires → re-dispatched as brokerselected with detail intact. The event-log diff has a working substrate.

## **F7 ✅ — Speed is a non-issue**

**1.3 s for 14 assertions**, cold. Comfortably inside the \<2 s per component per fixture budget. A 60-component × 15-fixture suite is well within tolerance for a Ralph gate.

# **The working normaliser**

Output from the real harness, both states, byte-stable across independent renders:

LOADED:

    ◆ PropertySummary
      ◆ Card iconName="standard:account" title="Property Summary"
        · div
          · h2 "Ocean View Estate"
          ◆ FormattedNumber currencyCode="USD" formatStyle="currency" value=1250000
          ◆ BrokerCard
            · div
              · p "Jane Ortiz"
              ◆ Button iconName="utility:email" label="Contact" variant="brand"

EMPTY:

    ◆ PropertySummary
      ◆ Card iconName="standard:account" title="Property Summary"
        · p "Select a property to see details here"

◆ = component boundary, · = plain element. This is precisely the artifact to diff against a React render. Everything that matters is captured: structure, conditional branch taken, canonical component names, props, and our own text. Everything irrelevant is gone: class hashes, framework attributes, slot plumbing, layout wrappers, base-component internals.

Design decisions now proven in code, not asserted:

  - lightning-card → Card, c-broker-card → BrokerCard via catalog + PascalCase fallback
  - Slot elements flattened through — plumbing, not structure
  - Single-child layout wrappers with no semantics collapsed
  - Only structural attributes kept (role, aria-\*, type, href, alt, name)
  - Props sorted for order-independent comparison

# **What this does and does not prove**

**Proven:** the harness runs; on-platform imports resolve with zero custom work; wire config is capturable; base components are identifiable; your own component tree renders faithfully; the canonical tree is clean and deterministic; speed is fine.

**Not yet proven:**

1.  **Your real components render.** Synthetic ≠ real. Unusual imports, static resources, or platformResourceLoader may break. **Next action, ~1 hour.**
2.  **The React side.** Only the LWC half is built. The React renderer + a real diff are the next build step.
3.  **Coverage of exotic constructs.** No lightning-record-edit-form, lightning-datatable, LMS, or empApi in the synthetic component. Tier-H is stubbed by design, but LMS and empApi need their own probe.
4.  **getLastConfig()** **with repeated adapter instances.** Open question from Cluster A, still open — needs a list-of-children component to test.

# **Consequent changes to the plan**

| Ref | Change | Driver |
| :---- | :---- | :---- |
| 01-v2 §3.2 | Normaliser reads props **by name from the catalog**, never from attributes | F1 |
| 01-v2 §3.2 | Traverse shadow **and** light DOM, tracking provenance | F2 |
| 01-v2 §3.2 | Text rule: suppress base-component *shadow* output only, keep slotted content | F4 |
| 01-v2 §6.1 | Call-diff rule stated precisely: undefined reactive param ⇒ zero React calls | F5 |
| 01-v2 Phase 1 | **catalog/base-components.xml** **is promoted to a blocking dependency** — the oracle cannot run without prop lists | F1 |
| 03 Part 1 | S-1 marked complete; remaining risk moves to "does it work on real components" | — |

**The catalog promotion is the significant one.** In v2 the catalog was step 3 of Phase 1 and fed only the codemod. It is now the oracle's dependency too, which means it moves to the front and its per-component prop enumeration becomes mandatory rather than nice-to-have.

# **Next actions**

1.  **Drop one real org component into the harness** (~1 hour). Add its Apex mocks, point the tests at it, run. This converts "synthetic passes" into "your code passes."
2.  **Probe the exotics** — a component using LMS and one using empApi. Half a day.
3.  **Build the React half** — render the hand-written React equivalent, normalise with the same function, diff. This is the first real end-to-end oracle result.
4.  **Start** **catalog/base-components.xml** with the prop enumerations, census-ordered.

**Kill criteria from** **03** **are not triggered.** Proceed.
