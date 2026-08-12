# Third-party test corpus

Real, public, open-source LWC components used to test the pipeline against
code **nobody here wrote**. Synthetic components validate the happy path we
imagined; these validate the one that exists.

| Source | trailheadapps/lwc-recipes |
|---|---|
| URL | https://github.com/trailheadapps/lwc-recipes |
| License | **CC0-1.0** (public domain dedication — see LICENSE.md) |
| Retrieved | 11 Aug 2026, from `main` |
| Contents | 15 component bundles, unmodified |

Salesforce's official LWC sample app (~2.9k stars). CC0 imposes no attribution
requirement; it is credited anyway.

## Why this corpus is NOT a substitute for your org

`research/01` is explicit that sample apps are "unrepresentatively clean", and
the census bears it out: **0% Tier A** across 15 components. A real org has
`renderedCallback`, `querySelectorAll`, LMS and composed events throughout.
These are teaching components — they are cleaner than production code by
design.

So treat the conversion rate here as an **upper bound**, not a forecast.

## Reproduce

    npm run corpus     # census + generate
    npm run preview    # http://localhost:8080

## What it caught

Running real components found six defects that the synthetic ones could not,
because the synthetic ones never did these things. See the commit that added
this directory.
