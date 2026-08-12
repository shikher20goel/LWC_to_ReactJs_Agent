# 10 — Cluster F: Fixtures, Real-Traffic Capture, and Adversarial Generation

**R13.** Can we capture real org traffic and replay it against the differential
oracle, or are we limited to synthetic + adversarial fixtures?

Researched 11 Aug 2026. Salesforce API version current at time of writing:
**v67.0 (Summer '26)**. Salesforce CLI: **2.146.3**.

---

## Part 0 — Verdict up front

**Do not build real-org traffic capture. Build synthetic-org *shape* capture plus
a metadata-driven adversarial generator. This is not a compromise — it dominates
real capture on every axis that matters.**

The argument in one line: **capture buys you shape fidelity, not value fidelity,
and shape comes from the platform, not from the customer's data.** A scratch org
seeded with fabricated records returns a byte-structurally-identical
`RecordRepresentation` to a production org. You get 100% of the fidelity benefit
and 0% of the compliance liability.

The residual gap — org-specific *configuration* you didn't think to model — is
closed by capturing **metadata** (`ui-api/object-info`), which is not personal
data, rather than **records**, which are.

Everything below is the working.

---

## Part 1 — Where the fixture actually enters the system

This is the most important structural finding and it reframes the whole question.

In the `@salesforce/sfdx-lwc-jest` harness, `lightning/uiRecordApi` is **replaced
by a stub module**. No HTTP request is ever issued. The fixture is injected as a
plain JavaScript object at the *module boundary*:

```js
import { createTestWireAdapter } from '@salesforce/wire-service-jest-util';
import { getRecord } from 'lightning/uiRecordApi';
// getRecord is already a test wire adapter under sfdx-lwc-jest
getRecord.emit(mockRecord);
getRecord.error(body, status, statusText);
```

Three adapters exist: a generic one, an **LDS** one (`registerLdsTestWireAdapter`
/ `createLdsTestWireAdapter`), and an **Apex** one. The `register*` forms are
legacy; `create*TestWireAdapter` is the current form and makes `register*`
unnecessary.

### Consequences

1. **There is no network layer to intercept in the default oracle.** Both the
   LWC original and the React candidate must receive the *same object*, injected
   at the adapter seam. See Part 6 — this is why MSW is the wrong tool here.

2. **A captured HAR is not a fixture.** It is a transport-level artefact that
   must be *transformed* into an adapter-level object. That transform is code we
   would own, and it can be wrong — silently, in a way that makes the oracle
   agree with itself while both sides are wrong. This is a real cost of the
   capture path that is easy to underestimate.

3. **The fixture contract is `RecordRepresentation`, not HTTP.** So the correct
   question is not "can we capture traffic" but "can we reproduce
   `RecordRepresentation` faithfully". The answer to that is yes, trivially,
   from a synthetic org.

---

## Part 2 — Wire shape vs on-the-wire shape

### 2.1 UI API REST (the "on the wire" shape)

```
GET /services/data/v67.0/ui-api/records/{recordId}?fields=Account.Name,Account.Rating
```

Query parameters (per the UI API Developer Guide): `fields`, `optionalFields`,
`layoutTypes` (`Compact` | `Full`), `modes` (`Create` | `Edit` | `View`),
`childRelationships` (`ObjectApiName.ChildRelationshipName`), `pageSize`,
`updateMru`. Since API 45.0 at least one of `fields` / `optionalFields` /
`layoutTypes` is required.

Response — the `Record` representation. Documented properties:

| Property | Type |
|---|---|
| `apiName` | String |
| `childRelationships` | Map&lt;String, Record Collection&gt; |
| `fields` | Map&lt;String, Field Value&gt; |
| `id` | String |
| `lastModifiedById` | String |
| `lastModifiedDate` | String (ISO 8601) |
| `recordTypeId` | String |
| `recordTypeInfo` | Record Type Info \| null |
| `systemModstamp` | String (ISO 8601) |

Real responses additionally carry `eTag` (String) and `weakEtag` (Number) even
though the doc's property table omits them; both appear in Salesforce's own
example payloads and `weakEtag` is listed explicitly on the `getRecord` LWC
reference page.

Concrete shape:

```json
{
  "apiName": "Account",
  "childRelationships": {},
  "eTag": "8897eb60da3dea171b0d755821bf2c36",
  "fields": {
    "Name":   { "displayValue": null,   "value": "Burlington Textiles Corp of America" },
    "Rating": { "displayValue": "Warm", "value": "Warm" }
  },
  "id": "001B000000UnQ2wIAF",
  "lastModifiedById": "005...",
  "lastModifiedDate": "2017-08-18T15:26:22.000Z",
  "recordTypeId": "012000000000000AAA",
  "recordTypeInfo": null,
  "systemModstamp": "2017-08-18T15:26:22.000Z",
  "weakEtag": 1503067582000
}
```

Note `Name.displayValue` is `null` while `Rating.displayValue` is `"Warm"` —
`displayValue` is populated only for types that have a formatted/localised
rendering. Components that render `displayValue ?? value` and components that
render `displayValue` alone behave differently on the same record. **This is a
first-class adversarial axis.**

### 2.2 What `@wire` hands the component

**Substantially the same object, with five differences that matter.**

| # | Difference | Impact on fixtures |
|---|---|---|
| 1 | **Envelope.** The component receives `{ data, error }`, not the bare record. The record is at `.data`. | Trivial, but the fixture file convention (`__tests__/data/getRecord.json` holding the bare record, `.emit()` wrapping it) must be identical on both sides. |
| 2 | **Immutability.** "Objects passed to a component are read-only. To mutate the data, a component should make a shallow copy." | A React candidate that mutates the fixture will pass in Jest (plain object) and break in production (frozen/shared store object). **Freeze fixtures with `Object.freeze` deep-applied** so the harness catches this. |
| 3 | **LDS store superset.** The record is reassembled from a normalised store. The LDS `getRecord` adapter returns child relationships and layout types *in addition to* the fields you specify, and overlapping requests from other components can leave extra fields in the store. | A component can accidentally depend on a field it never requested. Fixture sets must include both the exact-fields case and a superset case. |
| 4 | **Emission cadence.** LDS serves cached data then revalidates, so the wire can emit **more than once** for one request, and can emit `data` then `error` or `error` then `data`. `[inference]` — this is documented LDS caching behaviour but Salesforce does not spell out the emission sequence contract. | Fixtures must be **sequences**, not single values. A single `.emit()` under-tests every component that has a loading/refresh state. |
| 5 | **Parameter coverage.** "The `getRecord` wire adapter uses the User Interface API resource, but doesn't support all its parameters." | Do not assume every REST-reachable payload variant is reachable through the adapter. Capture at the adapter's parameter surface, not the REST surface. |

**Bottom line: the shapes are the same; the *lifecycle* is not.** Real-traffic
capture gives you point-in-time payloads and tells you nothing about difference
#4, which is where a large share of real migration bugs will live.

### 2.3 Error shapes — there are four, not one

`FetchResponse`, modelled on the Fetch API `Response`:

```json
{
  "status": 400,
  "body": [
    { "message": "The \"fields\" query string parameter...",
      "statusCode": 400,
      "errorCode": "INVALID_INPUT" }
  ],
  "headers": {},
  "ok": false,
  "statusText": "Bad Request",
  "errorType": "fetchResponse"
}
```

| Source | `error.body` shape |
|---|---|
| UI API **read** (`getRecord`, `getObjectInfo`, …) | **Array** of `{ message, statusCode, errorCode }` |
| UI API **write** (`createRecord`, `updateRecord`) | **Object**, with field-level errors |
| **Apex** (`@AuraEnabled`, read or write) | **Object** |
| **Network** / offline | **Object** |

Real-world components branch on `Array.isArray(error.body)`. A fixture set that
only ever emits the array form will not exercise the other branch. **All four
must be synthesised — you will never capture all four from real traffic without
deliberately breaking a production org.** This is a concrete case where synthetic
strictly beats captured.

---

## Part 3 — Capture options, assessed

### 3.1 The Lightning Experience reality check

**Lightning Experience does not fetch records over `/services/data/vXX/ui-api/`
in the browser.** LDS requests go through the Aura endpoint (`/aura`, or
`/s/sfsites/aura` on Experience Cloud) as **boxcarred action batches** — up to
250 actions per POST — with descriptors like:

```
aura://RecordUiController/ACTION$getRecordWithFields
```

`RecordUiController` exposes `getRecordUis`, `getRecordWithFields`,
`getRecordWithLayouts`, `getRecordsWithFields`, `getRecordsWithLayouts`,
`getValidationRulesInfo`, `postRecordAvatarAssociation`, `updateLayoutUserState`,
`updateRecord`, and `executeGraphQL`.

So a HAR taken from a live LEX session contains Aura envelopes, not clean UI API
JSON. You would need to parse the `message`/`actions` payload, match descriptors,
and unwrap `returnValue`. `[inference]` — I could not verify from Salesforce
primary docs that the `getRecordWithFields` `returnValue` is exactly the
documented `RecordRepresentation`; it is very likely but treat it as unverified.

**This makes HAR capture materially harder than it sounds and adds an
undocumented-format dependency to the pipeline.**

### 3.2 Options table

| # | Option | Fidelity to adapter contract | Effort | Credential risk | PII risk | Verdict |
|---|---|---|---|---|---|---|
| 1 | **DevTools HAR from LEX** | Highest to *runtime*, but needs Aura unwrapping; format undocumented | High | Medium (see 3.3) | **Severe** — response bodies are full customer records | **Reject** |
| 2 | **UI API direct REST** | Exact `RecordRepresentation` | Low | Low | Severe if org holds real data | **Accept, gated to synthetic orgs** |
| 3 | **`sf api request rest`** | Same as #2, plus CLI-managed auth | **Lowest** | **Lowest** — no session ID ever touches our code | Same as #2 | **Recommended mechanism** |
| 4 | **`sf apex run` (anonymous Apex + `JSON.serialize`)** | The only practical way to snapshot `@AuraEnabled` Apex wire payloads | Medium | Low | Severe if real data | **Accept for Apex-backed wires, gated** |
| 5 | **Apex REST (custom `@RestResource`)** | Requires deploying code to the org purely for capture | Medium | Low | Severe | **Reject** — deploying capture endpoints to a customer org is its own risk |
| 6 | **Chrome extension (e.g. Salesforce Inspector Reloaded)** | Gives SOQL/tooling access, not `RecordRepresentation` | Low | Medium (extension holds session) | Severe | **Reject.** 2026 feature set **not verified** in this pass |
| 7 | **TLS-intercepting proxy (mitmproxy / Charles)** | Same as #1 | High | **Severe** — MITM of a corporate SaaS session | Severe | **Reject.** Most security teams forbid this outright |
| 8 | **LWC Local Dev (Beta)** | Winter '26 single-component preview supports LDS wire adapters, `@salesforce/*` modules and Apex against a real org | Low | Low | Severe if pointed at prod | **Useful for manual shape discovery only, not a fixture pipeline.** Still **Beta** as of Winter '26 |

### 3.3 On HAR sanitisation — a trap worth naming explicitly

Chrome/Chromium **v130+ sanitises HAR exports by default**, stripping `Cookie`,
`Set-Cookie` and `Authorization` headers. Unsanitised export requires opting in
via *Settings → Preferences → Network → Allow to generate HAR with sensitive
data*. Third-party sanitisers exist (Cloudflare's `har-sanitizer`, Google's
`har-sanitizer`, Edgio's, `sanitizhar`); Cloudflare's runs entirely client-side
and strips session cookies and JWTs.

**None of these redact response bodies.** Every one of these tools solves the
*credential* problem. A "sanitised" HAR from a Salesforce org still contains
every customer name, email, phone number and case description that was on screen.
If anyone on the team says "we sanitised the HAR", that statement is about
tokens, not about PII. Say so loudly in any runbook.

### 3.4 The recommended capture command

```bash
# Record shape — exactly what @wire(getRecord) will hand the component
sf api request rest \
  'services/data/v67.0/ui-api/records/001XXXXXXXXXXXXXXX?fields=Account.Name,Account.Rating' \
  --target-org my-scratch-org \
  --stream-to-file fixtures/Account.getRecord.json

# Object metadata — the schema we actually want to commit
sf api request rest \
  'services/data/v67.0/ui-api/object-info/Account' \
  --target-org my-scratch-org \
  --stream-to-file fixtures/Account.objectInfo.json
```

`sf api request rest` (**Beta**) flags verified: `--method/-X`, `--body/-b`
(`@file` supported), `--header/-H`, `--stream-to-file/-S`, `--target-org/-o`
(**required**), `--file/-f`, `--include/-i`, `--flags-dir`. Arbitrary paths are
supported (both `services/data/...` relative and `/services/data/...` absolute).
There is **no `--api-version` flag** — pin the version in the path.

This is the right mechanism because it reuses the CLI's existing auth: **no
session ID is ever handled by our tooling, logged, or written to disk.**

---

## Part 4 — Compliance. Read this before writing any capture code.

### 4.1 Who is who

Per the **Salesforce Data Processing Addendum (April 2026)**: Salesforce is the
**Processor**; the Customer is the **Controller** (or itself a Processor acting
on a Controller's instructions). Customer warrants that its processing
instructions have been authorised by the relevant Controller.

**Nothing in that DPA authorises a third party — us, or a migration consultancy,
or a developer's laptop — to extract records from the org.** Exporting records
creates a *new* processing operation with a *new* controller/processor analysis
that has to be done by the org's owner, not by us.

### 4.2 The GDPR surface

| Article | Obligation triggered by fixture capture |
|---|---|
| **5(1)(b)** purpose limitation | Data collected for CRM operation is now being used for software testing. That is a new purpose requiring compatibility assessment. |
| **5(1)(c)** minimisation | "Adequate, relevant and limited to what is necessary." A component test needs *a shape*, not 40 real fields on 500 real people. Minimisation is close to dispositive here. |
| **25** data protection by design and by default | Requires designing the tool so real data is not needed. **This research exists to satisfy Art. 25.** |
| **32** security of processing | Explicitly names pseudonymisation as a measure. Applies to pre-production environments exactly as it does to production. |
| **28** processor contracts | Every downstream recipient — including an LLM provider — needs a DPA and controller authorisation. |
| **17** right to erasure | See 4.4. This is the one that has no good answer. |

The **EDPB Guidelines 01/2025 on Pseudonymisation** are directly on point:
**pseudonymised data that could be re-attributed using additional information
remains personal data.** Masking is a risk-reduction measure, not an exemption.
The Spanish DPA (AEPD) has published specifically on personal-data breaches in
development and pre-production environments — I was unable to fetch the article
body (HTTP 500), so I cite only its existence and title; do not rely on my
characterisation of its contents.

### 4.3 The LLM problem — the decisive one

**This is an agentic migration tool. Fixtures land in a model's context window.**

If a fixture contains real customer records, then every migration run transmits
personal data to a model provider. `[inference]` on the precise legal
characterisation — get counsel — but the shape of it is:

- The model provider becomes a **sub-processor** (Art. 28), requiring a signed
  DPA and, in a consultancy setting, the *end client's* authorisation.
- It is likely an **international transfer** requiring SCCs and a transfer impact
  assessment, depending on hosting region.
- Zero-retention and no-training configuration become **contractual
  requirements**, not preferences.
- Prompt logs, traces, and eval datasets each become a separate retention
  surface.

None of this is impossible. All of it is a permanent operational tax on a
*developer tool*, incurred to obtain data whose *values we don't need*.

### 4.4 Git is forever

Fixtures live in `__tests__/data/*.json`, in git, on every developer's machine,
in every fork, in every CI cache, in every artefact store.

`git filter-repo` can rewrite history in the canonical repo. **It cannot reach
clones, forks, CI caches, or anyone's `~/.git` reflog.** A GDPR Art. 17 erasure
request against a record embedded in git history is, practically speaking,
unsatisfiable.

**This single fact is sufficient to justify a default-deny policy on committing
real record data, independent of every other argument in this section.**

### 4.5 Sandbox ≠ safe. Know your sandbox types.

| Sandbox type | Production records? | Storage |
|---|---|---|
| **Developer** | **No — metadata only** | 200 MB |
| **Developer Pro** | **No — metadata only** | 1 GB |
| **Partial Copy** | **Yes** — sampled per template, ~10k records/object; refresh every 5 days | Per template |
| **Full** | **Yes** — every record and attachment | Matches production |
| **Scratch org** | **No — metadata/source only** | Small |

"It's only a sandbox" is **not** a compliance answer. A Full or Partial Copy
sandbox contains real customer data and is a production-equivalent risk surface
unless it has been masked.

**Developer, Developer Pro and scratch orgs are safe by construction** — there is
no production data in them to leak. That is the environment we should be
capturing from.

### 4.6 The safe pattern (this is the policy)

1. **Never capture from production. Ever. No exceptions, no flags, no override.**
2. **Never capture from an unmasked Full or Partial Copy sandbox.**
3. **Capture from a scratch org or Developer sandbox seeded with synthetic data
   you generated.** Snowfakery (Salesforce.org, open source) is the ecosystem
   standard for recipe-driven synthetic Salesforce data; `sf data import tree`
   works for small sets.
4. **The shape comes from the platform; the values come from you.** This is the
   whole trick, and it costs nothing.
5. **Commit metadata (`ObjectInfo`), not records.** Screen metadata too: custom
   field labels and picklist values occasionally contain business-confidential
   or even personal information (a picklist of employee names is not rare).
6. If someone insists on production-derived data anyway: it requires a DPIA, a
   named legal basis, a masked environment, a retention limit, a documented
   prohibition on committing it to git, and a documented prohibition on placing
   it in an LLM context. And it is *still* personal data (EDPB 01/2025). Escalate
   to counsel; do not let a migration deadline decide this.

---

## Part 5 — Masking and anonymisation tooling, 2026

### 5.1 Salesforce Data Mask (branded **Data Mask & Seed**)

Verified from Salesforce Help:

- **Delivery:** a managed package installed in the **production** org; Salesforce
  auto-upgrades it.
- **Licensing:** Professional, Enterprise, Unlimited and Developer Editions, via
  the **Data Mask** or **Data Mask & Seed** add-on licences. Pricing not
  published on the pages reachable in this pass (`salesforce.com/platform/data-masking/`
  returned HTTP 403) — **treat 2026 pricing/packaging as unverified.**
- **Where it runs:** masking jobs run **only in sandboxes**, and only full or
  partial sandboxes. It cannot mask production, and it does not mask data
  dynamically on export to external systems.
- **Techniques:** random character replacement, similarity-mapped word
  replacement, pattern-based masking, deletion.
- **Irreversibility:** "When you mask sandbox data, you can't unmask it." The
  only route back to originals is refreshing the sandbox from production.
- The help page states **API version 50.0**; whether that is current or stale doc
  text is **unverified**.

**What it guarantees:** that the specific fields you configured, in the specific
sandbox you ran it against, no longer hold their original values, irreversibly
within that sandbox.

**What it does not guarantee:**

- **Not GDPR anonymisation.** The techniques are pseudonymisation, randomisation
  and deletion. Under EDPB 01/2025, output that can be re-attributed with
  additional information is still personal data. Do not let anyone claim "Data
  Mask makes it not-personal-data".
- **Free text is not covered in any reliable way.** `Description`, `Comments`,
  Case bodies, Chatter posts and email bodies routinely carry PII that no
  rule-based field-level masker reliably scrubs. `[inference]` — this is a
  general property of rule-based masking, not a Salesforce-specific claim.
- **Files and attachments are field-level-masking blind spots.** ContentVersion
  records, PDFs and scanned documents are reported as untouched by field-level
  masking. `[inference / vendor-sourced]` — this claim comes from third-party
  vendor blogs, not Salesforce documentation.
- It does not help at all if you are exporting to a repo, because the export
  itself is the risky operation.

### 5.2 Third-party / other options

Surfaced but **not independently verified for 2026 capability**: Gearset data
masking, Own (Owndata) sandbox anonymisation and seeding tiers, Cloud Compliance
Sandbox DataMasker, Flosum, K2view, Xetfer. All claims about these are vendor
marketing until tested.

**Open-source Salesforce-specific masking:** I found no credible dedicated OSS
masker in this pass. **Snowfakery** (Salesforce.org, open source) is the relevant
OSS tool but it is a **generator**, not a masker — which is precisely what our
recommendation needs anyway.

### 5.3 Position

**Masking is the wrong tool for this problem.** Masking is for teams who need
production-*volume*, production-*distribution* data in a sandbox for load and
integration testing. A component-level differential oracle needs neither. Reaching
for Data Mask here means paying for an add-on licence to solve a problem we can
delete instead.

---

## Part 6 — MSW and replay harnesses

### 6.1 What MSW is and how it works in Node/Jest

MSW v2 is the current major version and the de facto default API-mocking tool
across the JS ecosystem in 2026. In Node it works via `setupServer`:

```js
// src/mocks/node.js
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
export const server = setupServer(...handlers);

// jest.setup.js  (setupFilesAfterEach)
beforeAll(() => server.listen());   // synchronous, no await
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

Mechanism: it **patches native request-issuing modules (`http`, `https`)** plus
`fetch`/`XMLHttpRequest`, rather than running a Service Worker. It exposes
lifecycle events (`server.events.on('request:start', …)`) for observation without
altering responses. `resetHandlers()` after each test is what stops a
`server.use()` override bleeding across tests.

**Jest + jsdom caveat, and it bites:** `jest-environment-jsdom` deliberately
replaces built-in APIs with polyfills, breaking their Node compatibility and
therefore breaking MSW. The fix is to swap the environment to
**`jest-fixed-jsdom`**. Given Cluster A settled on a jsdom-based oracle, this is
a concrete, non-obvious configuration hazard.

### 6.2 Why MSW is the wrong layer for our default oracle

Per Part 1: **neither side of the differential issues an HTTP request.** The LWC
side is stubbed at the module boundary by `sfdx-lwc-jest`. If the React shim
(Cluster D) mirrors that seam — which it should — then MSW would never fire, and
adding it would be dead configuration that future maintainers assume is load-
bearing.

MSW becomes relevant in exactly one scenario: if the React candidate is built to
call UI API **over REST** because it is destined to run off-platform. In that
case you need MSW so both sides receive the same bytes. But note the cost: you
are then comparing two components that reach their data through **different
transport paths**, which weakens the differential — a difference in output could
be a transport artefact rather than a migration bug.

**Recommendation:** do not adopt MSW for the default oracle. Keep it in reserve
as an optional second "integration fidelity" lane, and only if an off-platform
REST-calling React target is actually chosen.

### 6.3 HAR replay

I found **no first-class HAR replay in MSW v2** in this pass. Community
HAR→handler converters exist; none verified. If HAR replay were ever needed, the
simpler and more auditable path is a small deterministic fixture loader we own —
JSON files in the repo, diffable in review, no format-conversion magic.

---

## Part 7 — Adversarial fixture generation

This is where the real leverage is, and it is where I'd spend the engineering
budget that capture would otherwise consume.

### 7.1 Derive the generator from metadata, not from data

`getObjectInfo` / `GET /ui-api/object-info/{objectApiName}` returns an
`ObjectInfo` containing field definitions with `dataType`, `length`, required /
`nillable` status, `relationshipName`, `referenceToInfos`, picklist value
configurations, record type metadata, and theme info.

**That is a complete schema.** Commit it. Generate everything from it.

```
ObjectInfo  ──▶  field-type catalogue  ──▶  tier-2 deterministic fixtures
            └──▶  fast-check arbitraries ──▶  tier-3 fuzz lane
```

This inverts the usual instinct: instead of capturing data and hoping it covers
the edges, you capture *schema* — which is not personal data — and synthesise
data that covers the edges **by construction**.

### 7.2 Per-type adversarial catalogue

| `dataType` | Adversarial values |
|---|---|
| String / TextArea / Email / Phone / Url | `""`, single char, exactly `length`, `length+1`, leading/trailing whitespace, embedded newlines, `<script>alert(1)</script>`, `&amp;`, `{{template}}`, RTL override `U+202E`, combining marks, astral-plane emoji (surrogate pairs), 10 000 chars |
| Boolean | `true`, `false`, **`null`** (impossible on-platform, reachable when FLS strips the field) |
| Int / Double / Currency / Percent | `0`, `-0`, negative, max scale, precision boundary, `Number.MAX_SAFE_INTEGER`, `null` |
| Date / DateTime | ISO 8601 UTC, epoch `0`, far future, DST boundary, 29 Feb, non-UTC offset, `null` |
| Picklist | each active value, an **inactive** value, a value **absent from the ObjectInfo picklist set** (config drift), `""`, `null` |
| MultiPicklist | single value, `;`-separated, `""`, trailing `;`, `null` |
| Reference | 15-char Id, 18-char Id, `null` (**missing optional relationship**), spanning record present vs `fields.Owner.value === null` |
| Compound (Address, Name, Geolocation, Location) | nested object populated, nested object with inner `null`s, whole compound `null` |
| Formula / rollup | value present with `displayValue: null`; both `null` |

**The `displayValue` axis is orthogonal and must be crossed with all of the
above:** `{value: X, displayValue: null}` vs `{value: X, displayValue: "Y"}` vs
`{value: null, displayValue: null}`.

### 7.3 Structural adversarials (type-independent — these find the real bugs)

1. **Pre-emit frame.** `data === undefined && error === undefined`. The component
   has rendered but the wire has not fired. Almost every component has a skeleton
   or empty state here and it is routinely untested. **The oracle must diff this
   frame.**
2. **Requested field missing from `fields`.** FLS stripped it →
   `record.fields.Foo` is `undefined` → `getFieldValue` returns `undefined`.
   **This is the single most common real-world LWC crash.** Must be in every
   fixture set for every component.
3. **`fields` contains keys the component never requested** (LDS store superset).
4. **`childRelationships: {}`** vs populated vs
   `{ Contacts: { records: [], totalCount: 0, nextPageUrl: null } }` — the
   empty-list render path.
5. **Large child relationship** with pagination cursors set.
6. **`recordTypeInfo: null`** vs populated; `recordTypeId` = the default
   `012000000000000AAA` vs a real one.
7. **Emission sequences:** `data`; `error`; `data → data'` (revalidation);
   `data → error`; `error → data`; `data → data` with *fewer* fields the second
   time.
8. **All four error envelopes** (Part 2.3) × statuses 400 / 403 / 404 / 500.

### 7.4 Three tiers

| Tier | What | Count | Where it runs |
|---|---|---|---|
| **1 — Golden** | One hand-checked, realistic, fully synthetic record per object. Human-readable. | ~1 per object | Every run; used for eyeball diffing and PR review |
| **2 — Catalogue** | Deterministic enumeration of 7.2 + 7.3, keyed by `ObjectInfo.dataType`. Fixed seed, committed. | ~20–60 per component | Every run. **This is the regression suite.** |
| **3 — Fuzz** | `fast-check` with custom arbitraries built from `ObjectInfo`. Shrinking yields the minimal failing record automatically. | Unbounded | Nightly / CI lane only |

`fast-check` is the right choice: ~10.4M weekly npm downloads as of March 2026,
ships TypeScript types, integrates with Jest, Vitest and the Node test runner,
and its `record` and `array` combinators compose cleanly into a
`RecordRepresentation` arbitrary. `json-schema-fast-check` is available if you
prefer to project `ObjectInfo` → JSON Schema first; that indirection is probably
not worth it since `ObjectInfo` is already precise.

**Promotion rule:** every counterexample the fuzz lane shrinks out gets
hand-committed into tier 2. Tier 3 discovers; tier 2 remembers. Never let a
nondeterministic lane gate a migration.

### 7.5 Caveat the fuzz lane needs

Differential + fuzz has a known failure mode: **random Unicode will surface
LWC-vs-React rendering artefacts that are not migration bugs** — whitespace
normalisation, attribute escaping, text-node splitting. Without a normalisation
layer and a known-benign-difference allowlist (Cluster A's tree-diff work), tier
3 will produce a high false-positive rate and get switched off. `[inference]`
Budget for the allowlist explicitly, or don't ship tier 3.

---

## Part 8 — Recommended strategy

### 8.1 Position

**Synthetic + adversarial is sufficient, and real-traffic capture is not worth
it.** Not "not worth it yet" — not worth it on the merits.

Four reasons, in order of weight:

1. **Capture buys shape, and we can get shape for free.** The `RecordRepresentation`
   returned by a scratch org is structurally identical to production's. The
   fidelity argument for capture is largely illusory.
2. **Real data is *bad* at the thing we need.** Production records are boringly
   well-formed. The bugs live in `null`s, FLS-stripped fields, empty child
   lists, `displayValue` gaps, emission sequences, and the four error envelopes
   — none of which you can reliably harvest from real traffic, and all of which
   you must synthesise anyway. Capture doesn't reduce the synthetic-generation
   work; it adds to it.
3. **The compliance cost is permanent and structural**, not a one-time gate:
   DPIA, legal basis, a DPA chain reaching the LLM provider, controller
   authorisation, transfer assessment, retention policy — all attached to a
   *developer tool*. And Art. 17 erasure against git history has no answer
   (§4.4).
4. **The mechanics are worse than they look.** LEX doesn't emit clean UI API JSON
   (§3.1); HAR sanitisers don't touch response bodies (§3.3); the HAR→fixture
   transform is code that can silently corrupt the oracle (§1).

### 8.2 The five-step build

**S1 — `fixture-capture` tool, default-deny.**
Wraps `sf api request rest` against `ui-api/records/{id}` and
`ui-api/object-info/{obj}`. **Refuses to run unless the target org is a scratch
org or a Developer / Developer Pro sandbox** (check `Organization.IsSandbox`,
`OrganizationType`, `TrialExpirationCode`). No override flag for production —
if it's not enforceable in code it isn't a policy.

**S2 — Seed the capture org synthetically.**
Snowfakery recipes (or `sf data import tree` for small sets) generate the
records. Values are fabricated by construction; nothing to mask, nothing to
erase.

**S3 — Commit metadata as the schema of record.**
`ObjectInfo` JSON goes in the repo. Captured *record* JSON goes in the repo
**only** from orgs we seeded ourselves. Screen `ObjectInfo` for confidential
labels/picklist values before committing.

**S4 — Generate, don't capture.**
Tiers 1/2/3 from Part 7, driven off `ObjectInfo`. Fixtures injected at the
**adapter boundary on both sides** — `createTestWireAdapter().emit()` on the LWC
side, the equivalent hook in the React shim. Deep-freeze every fixture so
mutation bugs surface in the harness rather than in production.

**S5 — Guardrails, failing closed.**
Pre-commit hook + CI check over `**/__tests__/data/**.json` and
`**/fixtures/**.json` scanning for: real org-Id prefixes not on the allowlist,
email-address patterns, E.164 / national phone patterns, and long free-text
fields. Fail the build, don't warn. Pair it with a one-page policy doc that
states in plain language: **no customer data in fixtures, ever, including in
LLM context.**

### 8.3 The one case that would change the answer

If the component census (Cluster C) finds a material share of components whose
behaviour depends on payload shapes we **cannot** reproduce from `ObjectInfo` —
plausible candidates: `lightning/uiRelatedListApi`, `uiListsApi`, list-view
payloads, or Aura-only responses with no public schema — then a narrow exception
becomes defensible:

- **Developer sandbox only** (metadata-only, so no production records exist), or
  a masked Full sandbox with a DPIA if truly unavoidable;
- **shape discovery only** — a human reads the payload, writes down the
  structure, and hand-authors a synthetic fixture matching it;
- the captured artefact is **never committed, never placed in an LLM context,
  and destroyed at the end of the session**.

Set the trigger threshold during the census. Write it down before you need it —
a threshold chosen under deadline pressure is not a threshold.

---

## Part 9 — What I could not verify

Stated plainly so nobody builds on sand:

- **Data Mask & Seed 2026 pricing and packaging.** `salesforce.com/platform/data-masking/`
  returned HTTP 403. Help doc confirms add-on licence across Pro/EE/UE/Dev
  editions; the commercial terms are unverified.
- **Whether the Data Mask help page's "API version 50.0" is current** or stale
  documentation text.
- **Third-party masking vendors' 2026 capabilities** (Gearset, Own, Cloud
  Compliance, Flosum, K2view, Xetfer) — vendor marketing only, untested.
- **Salesforce Inspector Reloaded's 2026 feature set** — not investigated.
- **Any first-class HAR replay in MSW v2** — none found; assume it does not
  exist rather than assuming I missed it.
- **AEPD article on dev/pre-production breaches** — HTTP 500 on fetch. I cite its
  existence and title only; I did not read it.
- **The exact `returnValue` envelope of `aura://RecordUiController/ACTION$getRecordWithFields`.**
  Inferred to wrap a `RecordRepresentation`; not confirmed from Salesforce
  primary documentation. Anyone building HAR unwrapping must verify this first.
- **LWC Local Dev GA status.** Search indicates **Beta** as of Winter '26; I did
  not confirm against a Summer '26 release-notes primary source.
- **All legal characterisations in Part 4 are engineering-grade, not
  legal advice.** The LLM sub-processor chain in §4.3 in particular is marked
  `[inference]`. Get counsel before any production-data decision.

---

## Sources

**Fetched directly:**

- https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-record.html — `getRecord` signature, parameters, returned `Record` shape, `weakEtag`
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_record.htm — UI API `Record` response body property table
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_resources_record_get.htm — `GET /ui-api/records/{recordId}` URI and query parameters
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-ui-api-record.html — `lightning/uiRecordApi` adapter and function inventory
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-object-info.html — `getObjectInfo` / `ObjectInfo` contents
- https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html — read-only/immutability guidance for data passed to components
- https://developer.salesforce.com/docs/platform/lwc/guide/data-error.html — `FetchResponse` error shape; UI API read vs write vs Apex vs network body shapes
- https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/cli_reference_api_commands_unified.htm — `sf api` command inventory (Beta status)
- https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_api_request_rest.html — `sf api request rest` full flag list and examples
- https://help.salesforce.com/s/articleView?id=platform.data_mask_overview.htm&language=en_US&type=5 — Data Mask packaging, licensing, masking techniques, sandbox-only, irreversibility
- https://cloud.google.com/blog/topics/threat-intelligence/auditing-salesforce-aura-data-exposure — Aura endpoint, `actions` payload format, boxcarring, `RecordUiController`
- https://mswjs.io/docs/integrations/node/ — MSW `setupServer`, lifecycle hooks, `http`/`https` patching
- https://www.aepd.es/en/prensa-y-comunicacion/blog/data-breaches-development-and-pre-production-enviroments — **fetch failed (HTTP 500)**; cited for existence/title only

**Surfaced by search, not fetched (treat accordingly):**

- https://www.salesforce.com/en-us/wp-content/uploads/sites/4/documents/legal/Agreements/data-processing-addendum.pdf — Salesforce DPA, April 2026 (controller/processor roles)
- https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf — EDPB Guidelines 01/2025 on Pseudonymisation
- https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202401_legitimateinterest_en.pdf — EDPB Guidelines 1/2024 on legitimate interest
- https://developer.chrome.com/docs/devtools/network/reference — HAR export sanitised vs with-sensitive-data
- https://blog.cloudflare.com/introducing-har-sanitizer-secure-har-sharing/ and https://har-sanitizer.pages.dev/ — client-side HAR sanitiser (credentials only)
- https://github.com/google/har-sanitizer , https://github.com/shayonj/sanitizhar — alternative HAR sanitisers
- https://github.com/salesforce/wire-service-jest-util — `create*TestWireAdapter` / `register*TestWireAdapter`
- https://developer.salesforce.com/docs/platform/lwc/guide/unit-testing-using-wire-utility.html — the three test wire adapters; fixture-file convention (`__tests__/data/getRecord.json`)
- https://github.com/salesforce/sfdx-lwc-jest — the harness itself
- https://fast-check.dev/docs/introduction/what-is-property-based-testing/ and https://www.pkgpulse.com/guides/property-based-testing-fast-check-javascript-2026 — fast-check adoption figures (~10.4M weekly, Mar 2026), arbitraries, shrinking
- https://github.com/meeshkan/json-schema-fast-check — JSON Schema → fast-check arbitraries
- https://qaskills.sh/blog/msw-mock-service-worker-testing-guide-2026 — MSW v2 status, `jest-fixed-jsdom` workaround
- https://help.salesforce.com/s/articleView?id=release-notes.rn_lwc_local_dev.htm&language=en_US&release=252&type=5 — LWC Local Dev (Beta)
- https://developer.salesforce.com/blogs/2025/09/winter26-developers — Winter '26 Local Dev platform-module support
- https://www.salesforce.com/platform/sandboxes-environments/salesforce-sandbox-guide/ — sandbox types (also corroborated by several secondary sources)
- https://www.varonis.com/blog/misconfigured-salesforce-experiences — `RecordUiController` action list, `aura://RecordUiController/ACTION$getRecordWithFields` descriptor
- https://www.salesforce.com/platform/data-masking/ — **fetch failed (HTTP 403)**; Data Mask & Seed branding only
