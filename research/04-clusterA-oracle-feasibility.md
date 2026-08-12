# **Research Cluster A — Oracle Feasibility**

## **R1: Off-platform LWC rendering · R2: Wire adapter mocking · R3: DOM & a11y tree diffing**

**Status:** Research complete. Verdict below is actionable. **Companion to:** 01-architecture-v2.md, 02-agentic-engineering-best-practices.md, 03-next-steps-and-research-plan.md **Date:** August 2026

# **VERDICT (read this first)**

**The oracle is feasible — but not the way** **01-v2** **described it, and the correction is significant.**

| Question | Answer |
| :---- | :---- |
| Can LWC render in Node/jsdom without an org? | **Yes.** @lwc/engine-dom + jsdom is a supported, mature path. |
| Should we build the harness on raw @lwc/engine-dom? | **No.** Build on @salesforce/sfdx-lwc-jest, which already solves module resolution, lightning/\* stubbing, and @salesforce/\* import resolution for on-platform LWC. |
| Can we mock wire adapters and capture their config? | **Yes, and better than expected.** getLastConfig() gives us the call-log primitive for free. |
| Will lightning-\* base components render real markup off-platform? | **No — and this is the important finding.** The public lightning-base-components npm package is deprecated, and sfdx-lwc-jest renders base components as *stubs*, not real SLDS markup. |
| Does that kill the oracle? | **No.** It changes what we diff. See "The base-component correction" below. |

**Net effect on confidence:** unchanged at ~70% for the middle row (typical business component, correct after human review). The base-component finding is a design constraint we can absorb, not a blocker — but only because we discovered it before building.

# **R1 — Off-platform LWC rendering**

## **R1.1 The packages**

| Package | Purpose | Notes |
| :---- | :---- | :---- |
| @lwc/engine-dom | Renders LWC as DOM elements in a DOM environment. Exposes createElement(tagName, { is: Ctor }). | The core of the oracle. Actively maintained — v9.x as of mid-2026. |
| @lwc/engine-server | Renders a component tree to a **string** in a server environment, via renderComponent(tag, Ctor, props). | Tempting but see R1.4 — not the right choice. |
| @lwc/synthetic-shadow | Shadow DOM polyfill. On-platform LWC runs with this **enabled**. | Determines what our DOM normaliser sees. Must match on-platform behaviour. |
| @lwc/compiler | Compiles LWC source (HTML/JS/CSS) into runnable modules. | Invoked by the Jest transformer; we don't call it directly. |
| @lwc/jest-preset | Bundles transformer, resolver, serializer, and jsdom config. | Base layer, but see R1.2 — prefer sfdx-lwc-jest for on-platform source. |
| @salesforce/sfdx-lwc-jest | The on-platform wrapper. Ships stubs for lightning/\* modules and @salesforce/\* imports. | **This is what we build on.** |

Minimal DOM render, canonical form:

    import { createElement } from 'lwc';
    import PropertySummary from 'c/propertySummary';

    const el = createElement('c-property-summary', { is: PropertySummary });
    el.recordId = 'a01xx0000000001';
    document.body.appendChild(el);
    await Promise.resolve();          // flush microtask queue
    // el.shadowRoot is now populated

## **R1.2 Why sfdx-lwc-jest, not raw engine-dom**

This is the single most useful finding in R1 and it saves weeks.

Our source is **on-platform** LWC. That means it contains imports that don't exist as real modules anywhere:

    import getBroker      from '@salesforce/apex/PropertyController.getBroker';
    import NAME_FIELD     from '@salesforce/schema/Property__c.Name';
    import TITLE_LABEL    from '@salesforce/label/c.PropertyTitle';
    import USER_ID        from '@salesforce/user/Id';
    import { getRecord }  from 'lightning/uiRecordApi';
    import { NavigationMixin } from 'lightning/navigation';

Salesforce's own module-resolution guidance is explicit about the split: **if you develop on the Salesforce Platform, the base Lightning component stubs are provided for you** by the on-platform tooling; if you consume components from an npm package in an OSS project, you must write the stubs yourself. @salesforce/sfdx-lwc-jest is the on-platform tooling — it ships the resolvers and stubs so these imports resolve in Jest with no work from us.

**Building the oracle directly on** **@lwc/engine-dom** **means reimplementing all of that stubbing ourselves.** That's a multi-week detour for zero differentiated value.

**Decision: the oracle harness is a Jest (or Vitest-with-Jest-compat) environment configured from** **@salesforce/sfdx-lwc-jest****, with our differs layered on top as custom matchers.** We are not writing a bespoke renderer.

## **R1.3 The base-component correction ⚠️**

**Finding:** the public lightning-base-components npm package has been **officially deprecated** — only internal Salesforce developers receive future updates, so the public package lags on-platform components. LWC Garden (a specialist off-platform LWC tooling project) documents this and advises that you may need to mock your own lightning-\* components going forward. Separately, Salesforce's own guidance from the LWC OSS launch stated plainly that base components are **not part of the core framework** and are not available in OSS.

**What this means concretely:** when the oracle renders \<lightning-card title="Summary"\>, it will *not* produce the real SLDS card markup. It will produce a stub element.

**Why this is survivable — and arguably better.** Reframe what the oracle diffs:

> We are not asserting that LWC's SLDS markup equals React's SLDS markup. That comparison was never going to work anyway — it's the same reason the 95% pixel-parity check was deleted in v2.
>
> We are asserting that **the component boundary tree is equivalent**: the same base components appear, in the same positions, with equivalent props, driven by the same logic.

So the DOM diff operates on a **normalised component-boundary tree**:

    LWC side (stubbed)                    React side (mapped)
    ─────────────────────────────         ─────────────────────────────
    lightning-card[title="Summary"]  ≡    Card[title="Summary"]
      └ div.slds-grid                       └ div.slds-grid
         ├ lightning-formatted-text    ≡       ├ FormattedText[value="…"]
         └ c-broker-card[brokerId=X]   ≡       └ BrokerCard[brokerId=X]

The mapping from lightning-card → Card comes from catalog/base-components.xml — which already exists in the plan as the attribute-mapping table. **The catalog does double duty: it drives the codemod** ***and*** **teaches the differ what equivalence means.** That's a genuine architectural improvement over v2, where the catalog only fed the codemod.

**What we lose:** the oracle cannot verify that our React Card behaves like the real lightning-card internally. That's now an explicit, named fidelity gap — it belongs in the catalog per-component as a fidelity score and is covered by the base-component parity work, not by the oracle.

**What we keep:** everything that actually goes wrong in migration — wrong conditionals, wrong iteration, missing children, wrong props, wrong data shape, wrong call sequence. All still caught.

## **R1.4 Why not** **@lwc/engine-server**

Rendering to a string looks attractive for diffing. Reject it, for three reasons:

1.  **No interactivity.** SSR output is a static snapshot; we cannot dispatch events, so the event-log and focus diffs are impossible.
2.  **renderedCallback** **doesn't fire meaningfully.** That hook is our highest-bug-density Tier-A construct — losing observability on it defeats the purpose.
3.  **Output format is explicitly unstable.** The @lwc/engine-server docs state the serialisation format is aligned to a leading proposal but subject to change; @lwc/ssr-compiler and @lwc/ssr-runtime are flagged experimental and may break without notice.

**Use** **engine-dom** **+ jsdom.** Optionally add engine-server later as a fast pre-filter for pure-presentational nodes.

## **R1.5 Lightning Web Security**

On-platform, LWC modules are evaluated inside Lightning Locker or Lightning Web Security, which add restrictions on top of standard web platform APIs. Off-platform there is no LWS.

**Implication, both directions:** a component doing something LWS would have blocked will run *more* permissively in the oracle than in production. Conversely, if a component depends on an LWS-provided shim, it may fail off-platform. Neither is common, but flag any component using document/window directly for human review — the oracle's verdict on those is less trustworthy.

Note also: on-platform LWC runs with synthetic shadow enabled, and a documented side effect is that page-level injected styles leak into components. Our normaliser strips styles anyway, so this doesn't affect the diff — but it's relevant to the separate styling-parity review.

## **R1.6 Scaffold for the S-1 spike**

    // package.json (excerpt)
    {
      "devDependencies": {
        "@salesforce/sfdx-lwc-jest": "^7",
        "jest": "^29",
        "jest-environment-jsdom": "^29",
        "dom-accessibility-api": "^0.7",
        "@testing-library/dom": "^10"
      },
      "jest": {
        "preset": "@salesforce/sfdx-lwc-jest",
        "moduleNameMapper": {
          "^@migration/oracle$": "<rootDir>/oracle/index.js"
        },
        "setupFilesAfterEnv": ["<rootDir>/oracle/setup.js"]
      }
    }

Node 22 LTS pinned across the repo (harness, build, agent) — mismatched Node between the oracle and the Vite build is a genuinely annoying class of bug.

# **R2 — Wire adapter mocking**

## **R2.1 The three adapter flavours**

@salesforce/wire-service-jest-util (re-exported through @salesforce/sfdx-lwc-jest) provides three factories. The library does **not** inject adapters for you — your test config must reroute wire-adapter imports to a mocked implementation, which is exactly what the sfdx preset does for lightning/\*.

| Factory | Mimics | Emitted shape |
| :---- | :---- | :---- |
| createTestWireAdapter(fn) | Generic | Emits whatever you pass, unchanged |
| createLdsTestWireAdapter(fn) | Lightning Data Service | { data, error } shape; emits an initial object on registration |
| createApexTestWireAdapter(fn) | Apex @wire | { data, error } shape; callable imperatively too |

The LDS and Apex variants automatically reproduce the platform's data/error shapes and the initial registration emit. **This matters for us:** those are precisely the semantics that naive React conversions get wrong.

## **R2.2 The API surface we care about**

    interface LdsTestWireAdapter {
      emit(value: object, filterFn?: (config) => boolean): void;
      error(body?: any, status?: number, statusText?: string): void;
      emitError(opts?: {body?, status?, statusText?}, filterFn?): void;
      getLastConfig(): object;          // ← THE KEY METHOD
    }

Default LDS error, if you call error() with no args:

    { "ok": false, "status": 404, "statusText": "NOT_FOUND",
      "body": [{ "errorCode": "NOT_FOUND", "message": "The requested resource does not exist" }] }

Default Apex error differs — status 400, Bad Request, and body is an object with message rather than an array. **Our React error handling must reproduce the right one per adapter type.** Add this to catalog/wire-adapters.xml.

## **R2.3** **getLastConfig()** **is the call-log primitive — this is the find**

03's R2 asked whether we could assert on the *config* a wire was called with, including reactive $param resolution. **Answer: yes, natively.** getLastConfig() returns the last resolved config, and the docs note it's specifically useful when the @wire includes dynamic parameters.

That means the oracle's **call-log diff** — the check that catches the missing enabled guard, the #1 naive-conversion defect — needs no bespoke instrumentation on the LWC side:

    // LWC side
    getRecord.emit(fixture.record);
    const lwcConfig = getRecord.getLastConfig();
    // → { recordId: 'a01xx…', fields: ['Property__c.Name', 'Property__c.Price__c'] }

    // React side — MSW/shim records the query key + params
    const reactCalls = shim.getCallLog();
    diffCalls(lwcConfig, reactCalls);

**The defect it catches, concretely:** LWC wires do not fire while a reactive $param is undefined. useQuery *will* fire unless guarded. So on mount with no recordId yet, LWC's getLastConfig() returns nothing while React has already made a call. The diff shows one extra call. Mechanically detected, no human needed.

The filterFn parameter on emit is a bonus: when a component instantiates the same adapter multiple times (a list of children each wiring their own record), you can target emission per-instance by inspecting each instance's config.

## **R2.4 Known trap**

There is a documented failure where wire mocks break when sfdx-lwc-jest is installed **globally** — emit is not a function. Install it as a local devDependency. Pin the version and note it in CLAUDE.md as a forbidden change.

Also: the register\*TestWireAdapter family is deprecated in favour of create\*TestWireAdapter. Any 2019–2021 blog example you find will use the old API. Use create\* only.

## **R2.5 Fixture shape — where** **[object Object]** **comes from**

The LDS record payload is nested, not flat:

    { "id": "a01xx…", "apiName": "Property__c",
      "fields": {
        "Name":   { "value": "Ocean View", "displayValue": null },
        "Price__c": { "value": 1250000, "displayValue": "$1,250,000" }
      }}

A React conversion that reads data.Name instead of data.fields.Name.value renders [object Object] for every field. This is the exact bug that broke Salesforce's own Aura→LWC agent and required a human prompt to fix.

**Our text-diff catches it automatically.** Every synthetic fixture must use the real nested shape — never a flattened convenience object. Add a fixture-schema validator; a flattened fixture would silently make the oracle blind to the most common defect in the project.

# **R3 — DOM and accessibility-tree diffing**

## **R3.1 Recommended stack**

| Layer | Choice | Why |
| :---- | :---- | :---- |
| Accessible-name/role computation | **dom-accessibility-api** | Pure JS, works in jsdom, powers Testing Library's role queries. No browser needed. |
| A11y-tree serialisation format | **Playwright's ARIA-snapshot YAML shape** | Adopt the *format*, not necessarily the runtime. Well-designed, human-readable, diffable. |
| Optional browser-grade check | **Playwright** **ariaSnapshot()** | For the ~10% of nodes needing real browser semantics. |
| Rule-based a11y audit | **axe-core** | Separate concern from parity — see R3.4. |
| Structural diff | **Custom normaliser +** **jest-diff** | Off-the-shelf DOM differs don't understand our shadow/component-boundary semantics. |

## **R3.2 Why the a11y tree replaces pixel parity**

The accessibility tree is a projection of the DOM that browsers compute for assistive technology. It collapses presentational wrappers, resolves accessible names from aria-label, \<label\>, text content and alt, and surfaces roles and states. Asserting against it means a test fails only when **user-facing semantics** change.

That is precisely the property we need. Two implementations of the same component with different wrapper divs, different class names, and different CSS frameworks produce *different DOM* and *the same accessibility tree* — if and only if they're semantically equivalent. That's the definition of parity we actually want.

Playwright's comparison semantics are a good model to copy: case-sensitive, whitespace-collapsed (indentation and line breaks ignored), **order-sensitive**, with partial matching supported by omitting attributes or accessible names.

**Order-sensitivity is the right default for us** — a reordered list is a real regression, not noise.

## **R3.3 The normaliser — the actual engineering**

This is where the work is. Sketch:

    function normalise(root, { catalog }) {
      return walk(root, node => {
        // 1. Traverse INTO shadow roots; erase the boundary itself
        if (node.shadowRoot) return walkChildren(node.shadowRoot);

        // 2. Component boundary → canonical name via catalog (R1.3)
        const canonical = catalog.canonicalName(node.tagName);
        //    lightning-card → Card ; c-broker-card → BrokerCard

        // 3. Keep only semantic attributes; drop framework noise
        const attrs = pick(node.attributes, catalog.semanticAttrs(canonical));
        //    drop: data-lwc-*, class hashes, style, generated ids

        // 4. Normalise the id-reference graph rather than id values
        //    (aria-labelledby points to a generated id on both sides)

        // 5. Collapse whitespace-only text nodes
        // 6. Sort stable attributes for order-independent comparison

        return { canonical, attrs, children };
      });
    }

Five things that will bite, all foreseeable:

1.  **Generated IDs.** Both LWC and React generate ids for aria-labelledby/aria-describedby. Compare the *reference graph* (does the label element referenced actually contain the label text?), never the id strings.
2.  **Whitespace in accessible names.** Names are computed from text content and can pick up non-breaking spaces, newlines, or zero-width characters. Playwright normalises ordinary whitespace; persistent mismatches usually indicate unusual characters in the source markup. Normalise aggressively and log the raw name on mismatch.
3.  **Dynamic content.** Counts, timestamps, prices break a hardcoded comparison every run. Since we diff two live renders against the *same fixture*, this mostly disappears — but locale-dependent formatting will not. Pin locale and timezone in the harness.
4.  **Synthetic vs native shadow.** On-platform uses synthetic shadow. Ensure the harness matches, or you'll diff against behaviour production doesn't have.
5.  **Stubbed base components have no internal a11y tree.** A stubbed lightning-input exposes no textbox role. So the a11y diff is meaningful *between* base-component boundaries, and the boundary itself is checked by name+props. Document this limit in every scorecard.

## **R3.4 What the a11y diff does NOT do**

ARIA snapshots verify that the accessibility tree matches an expected structure — catching missing accessible names and changed roles — but they do **not** check WCAG rules like colour contrast, focus order, or ARIA misuse. Pair them with an axe-core scan for rule-based auditing.

So we run **both**, for different purposes:

  - **A11y-tree diff** → parity between LWC and React (check 5 in the S6 gate)
  - **axe-core** → absolute accessibility quality of the React output (check 10)

These are not redundant. A conversion can be perfectly faithful to an LWC that was itself inaccessible.

# **Consolidated impact on the plan**

## **Changes to** **01-architecture-v2.md**

| Ref | Change | Reason |
| :---- | :---- | :---- |
| §3.1 harness | Build on @salesforce/sfdx-lwc-jest, not raw @lwc/engine-dom | Module resolution and lightning/\* stubs come free (R1.2) |
| §3.2 DOM diff | Redefine as **component-boundary tree diff**, driven by the catalog | Base components render as stubs (R1.3) |
| §3.2 call diff | Use getLastConfig() on the LWC side | Native primitive, no instrumentation (R2.3) |
| §3.4 fixtures | Add a **fixture schema validator** enforcing nested LDS shape | A flattened fixture blinds the oracle to the most common defect (R2.5) |
| §6.1 gate | Split check 5: a11y-tree **parity diff** vs axe **rule audit** | They test different things (R3.4) |
| New | catalog/base-components.xml gains a canonical-name field | Now feeds the differ as well as the codemod (R1.3) |
| New risk | LWS absent off-platform → components touching document/window get lower oracle trust | (R1.5) |

## **Revised S-1 spike criteria**

Supersedes 03 Part 1. Five criteria, still 3 days:

1.  A real org LWC renders under sfdx-lwc-jest with all @salesforce/\* imports resolving
2.  element.shadowRoot is populated and traversable
3.  getLastConfig() returns the resolved wire config, with $-params substituted
4.  dom-accessibility-api produces an a11y tree from the rendered output
5.  **New:** a stubbed lightning-\* element is identifiable by tag and props in the output

**Criterion 5 is the new pass/fail.** If base-component stubs are opaque — no tag, no readable props — the boundary-tree diff doesn't work and we need a different equivalence definition. Test this on day one, not day three.

# **Open questions for the spike**

1.  Does getLastConfig() behave correctly when a component instantiates the **same adapter multiple times** (e.g. a list of children)? The filterFn API suggests yes — verify.
2.  Can the sfdx-lwc-jest stubs be **selectively replaced** with richer fakes for high-value base components (lightning-datatable, lightning-record-edit-form)? If so, deeper parity is available where it matters most.
3.  Does the harness run acceptably fast? Target **\<2s per component per fixture** — at 60 components × 15 fixtures that's a 30-minute suite, which is the outer bound of tolerable for a Ralph gate.
4.  Does Vitest work with the sfdx preset, or are we committed to Jest? Jest is fine; just decide once and pin it.

# **Sources**

  - @lwc/engine-dom, @lwc/engine-server, @lwc/jest-preset, lwc — npm and salesforce/lwc repo READMEs
  - lwc.dev — Unit Tests; Server-side rendering
  - salesforce/wire-service-jest-util — README and API docs; 2.x→3.x migration guide
  - salesforce/sfdx-lwc-jest — issues #268, #293 (deprecated API; global-install trap)
  - Salesforce Developers — Write Jest Tests for Wire Service; LWC Open Source (Get Started); Lightning Web Components Module Resolution (2020, updated 2025); Differences Between Building LWC on Platform and Open Source
  - Trailhead — Jest Testing Wire Service
  - LWC Garden — Lightning Base Components guide (deprecation of the public npm package)
  - lightning-base-components — npm
  - Playwright — ARIA snapshots documentation; practitioner guides on ariaSnapshot semantics and pitfalls
  - dom-accessibility-api

*All content paraphrased from sources; no source text reproduced.*
