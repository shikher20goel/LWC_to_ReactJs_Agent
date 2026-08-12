# LWC → React Agent

An agentic system that migrates Salesforce Lightning Web Components to React,
verified by a differential oracle rather than by hope.

## Status

| Phase | State |
|---|---|
| Research (Cluster A) | ✅ Complete |
| S-1 oracle spike | ✅ **PASSED** — 14 assertions, 1.3s |
| Org-shaped component (`accountList`) | ✅ Passing — adds iteration + 3-way branch coverage |
| **React half of the oracle** | ✅ **End-to-end diff working** — LWC vs React, byte-identical, negative control fails correctly |
| Validation on a component from *your org* | ⬜ Still pending — see note below |
| Org census | ⬜ Blocked on R6/R7 research |
| Everything else | ⬜ Not started |

## The core idea

LWC runs off-platform in Node. So we render the **original** LWC and the
**generated** React side by side against identical fixtures, and diff:

1. Component-boundary tree
2. Accessibility tree
3. Emitted events
4. Outbound call log
5. Text content

That converts "we hope the LLM understood the component" into "we can prove
it did, on observed paths" — without needing any pre-existing tests.

## Running it

Requires Node 22+ (developed on 24).

```bash
npm install
npm test
```

That is **the gate**: 91 tests, ~3s. Green means the oracle, codemod, shim,
census and fixture validation all work.

### The four commands you'll actually use

| Command | What it does |
|---|---|
| `npx jest generated.react --silent=false` | **See the oracle prove a conversion.** Renders the original LWC and the generated React against identical fixtures and prints both boundary trees. They should be identical. |
| `npm run generate` | **Convert LWC → React.** Writes `react/generated/*.jsx` and reports which components are clean vs. need review. |
| `npm run census` | **The project gate.** Tiers every component and evaluates the kill criteria. |
| `npm run fixtures:check` | Validate fixture shape + provenance before committing any. |

Exit codes are deliberate so both are CI-usable:

- `npm run census` — `0` gates clear · `1` **Tier-H > 35%, STOP** · `2` parse
  failures, so the percentages are understated and the verdict is not trustworthy
- `npm run generate` — `1` means at least one component has review items.
  That is information, not a crash.

### Running it against your own org

```bash
sf project retrieve start --metadata LightningComponentBundle --target-org <your-alias>
```

Drop the result into `force-app/main/default/`, then run `npm run census` and
`npm run generate`. Until then every number here describes three components
written for this repo, which the research is explicit are
"unrepresentatively clean".

> ⚠️ Retrieve from a **Developer, Dev Pro, or scratch org** — those are
> metadata-only. Full and Partial Copy sandboxes contain real customer data,
> and per `CLAUDE.md` rule 7 it must never enter this repo. Git history makes
> that effectively irreversible.

## Components under test

| Bundle | Deployable | Covers |
|---|---|---|
| `propertySummary` + `brokerCard` | fixtures only (no meta.xml) | LDS wire, Apex wire, reactive `$param`, `lwc:if/else`, child `c-*`, composed events, named slot |
| `accountList` (+ `AccountController.cls`) | ✅ yes | **iteration** (`for:each`), `lwc:if/elseif/else`, Apex error branch, `data-*` event payload |

`accountList` is org-*shaped* and deployable, but it is still a component
written for this repo. **The remaining validation is to drop in a real bundle
retrieved from your org** — unusual imports, static resources, or
`platformResourceLoader` are the things synthetic components can't predict.

## Read first

`research/` in numerical order. `01` is what to build, `02` is how to build
it, `03` is what to find out next, `04`/`05` are the oracle evidence.

## Honest confidence

See `research/01-architecture-v2.md` Part 12. Short version: ~70% on a typical
business component *with human review*, ~25% fully autonomous, ~15% on
Apex→Java Path B. Full autonomy is upside, not the plan.
