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

## Quick start

    npm install
    npx jest --silent=false

Expected: printed canonical boundary trees and a passing oracle suite.

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
