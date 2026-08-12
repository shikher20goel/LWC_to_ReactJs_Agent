# Cluster D — Runtime Shim Research (R8 + R9)

**Date:** 11 Aug 2026
**Scope:** R8 — exact LDS/wire runtime semantics; R9 — TanStack Query architecture for a shared, machine-generated data layer.
**Consumers:** the `<fidelity-loss>` catalog, and the design of `@migration/salesforce-runtime`.

**Epistemic conventions used throughout:**

- Unmarked claims are backed by a document I actually fetched (see Sources).
- **[inference]** = my reasoning from documented primitives, not stated in the docs.
- **[UNVERIFIED]** = I looked and could not confirm it. Do not encode these as facts in the converter.
- Quotations are verbatim from the fetched page.

---

# PART 1 — R8: LDS semantics, precisely

## 1.1 Version context (Aug 2026)

- Current UI API doc version is **v67.0, Summer '26**.
- `lightning/graphql` (v2) supersedes `lightning/uiGraphQLApi` (v1); Salesforce recommends v2. v1 remains for Mobile Offline.
- `getRecordNotifyChange(recordIds)` is **deprecated**; superseded by `notifyRecordUpdateAvailable(items)`.
- Using `refreshApex` on **non-Apex** wire adapters is **deprecated** (Data Guidelines).
- **[UNVERIFIED]** I found no 2025–2026 change that alters the core wire/LDS contract described below. The semantics documented in the LWC Developer Guide as of Summer '26 match the long-standing behaviour.

---

## 1.2 The wire contract itself (the part everyone gets wrong)

From **Understand the Wire Service** (`data-wire-service-about.html`):

> "Properties in the `{adapterConfig}` object can't be undefined. If a property is undefined, the wire service doesn't provision data, and both `data` and `error` stay undefined."

> "If a reactive variable changes, the wire service provisions new data."

> "When data becomes available from the wire adapter, it's set in the `data` property while `error` remains `undefined`. When newer versions of the data are available, LDS emits a value on the wire."

Wired property default shape, assigned "after component construction and before any other lifecycle event":

```js
{ data: undefined, error: undefined }
```

Wired **functions** are a stream: "invoked whenever a value is available, which can be before or after the component is connected or rendered."

Provisioned data is **read-only / immutable**: the wire service provisions an immutable stream and objects passed to a component are read-only; to mutate, take a shallow copy. (Sourced from `data-wire-service-about.html` + the LWC wire-adapter RFC `lwc-rfcs/text/0103-wire-adapters.md`, both surfaced via search; RFC not fetched in full.)

### Four consequences that matter for conversion

1. **`data` and `error` are mutually exclusive per emission.** There is no "stale data + error" state in LWC. TanStack Query deliberately keeps `data` from the last success while surfacing `error` on a failed background refetch. This is a *behavioural* divergence, not just cosmetic.
2. **No documented automatic retry.** Nothing in the wire service docs describes retry-with-backoff. TanStack retries 3× by default.
3. **No window-focus / reconnect revalidation.** LDS revalidates on cache-lifetime expiry *at read time*, not on focus events. TanStack refetches on mount/focus/reconnect by default.
4. **`undefined` config ⇒ silence.** Not a loading state, not an error — literally nothing is provisioned. This is the `enabled` guard problem (§1.9).

---

## 1.3 When `getRecord` re-emits

`getRecord` is documented at `reference-wire-adapters-record.html`. Parameters:

| Param | Type | Notes (verbatim where quoted) |
|---|---|---|
| `recordId` | String, **required** | "The ID of a record from a supported object." |
| `fields` | String[] , conditionally required | `ObjectApiName.FieldName`. "Polymorphic fields aren't supported. Including a polymorphic field in `fields` can result in an invalid field error." |
| `layoutTypes` | String[], conditionally required | `Compact` \| `Full`. Either `fields` or `layoutTypes` must be specified. |
| `modes` | String[], optional | `Create` \| `Edit` \| `View` (default). Only with `layoutTypes`. |
| `optionalFields` | String[], optional | "If a field is accessible to the context user, it's included in the response. If a field isn't accessible, it isn't included in the response, but it doesn't cause an error." |

Return: `data` = Record object; `error` = FetchResponse. Doc note: "Don't use the `recordTypeInfo` property. Instead, use the `recordTypeId` property, which is returned for every record."

**Re-emission triggers**, assembled from `data-ui-api.html` + `reference-notify-record-update.html` + `data-wire-service-about.html`:

| # | Trigger | Citation |
|---|---|---|
| E1 | A reactive `$param` in the adapter config changes to a new defined value | "If a reactive variable changes, the wire service provisions new data." |
| E2 | Another component **mutates** the record through LDS (`updateRecord`, base record forms, `lightning-record-edit-form`) | "If Lightning Data Service detects a change to a record or any data or metadata it supports, all components using a relevant `@wire` adapter receive the new value. The detection is triggered if a Lightning web component mutates the record…" |
| E3 | The **cache entry expires** *and then* a wire triggers a read | "…or the LDS cache entry expires and then a Lightning web component's `@wire` triggers a read." |
| E4 | `notifyRecordUpdateAvailable([{recordId}])` is called anywhere in the app | "For every wire that uses record data from one of the supplied recordIds, Lightning Data Service obtains fresh data for the wire and re-emits updated values." |
| E5 | A `RefreshEvent` reaches a registered refresh container containing this component | `data-refreshview-api.html` |

**Non-trigger (critical):**

> "Values are not re-emitted to wires whose data has not changed, per the usual semantics of `@wire`." — `reference-notify-record-update.html`

So LDS performs a **deep equality gate on emission**, not merely referential stability. A refetch that returns identical data produces **zero** emissions and therefore zero re-renders.

**Not a trigger:** another user changing the record server-side. There is no server push. LDS is poll-on-read-after-expiry. **[inference]** — no doc describes a push channel for record data; combined with E3's explicit "cache entry expires and then a `@wire` triggers a read", the absence of push is strongly implied but never stated as such.

---

## 1.4 How the LDS cache deduplicates and revalidates

From `data-ui-api.html`:

- **Shared, cross-component:** "Records loaded in Lightning Data Service are cached and shared across components." "…a record is loaded once, no matter how many components are using it."
- **Deduplication + bulkification:** LDS "Optimizes server calls by bulkifying and deduping requests."
- **Revalidation:** LDS "re-requests the record data from the server to satisfy requests that occur after the cache lifetime," and updated data may arrive sooner.
- **Cache lifetime is deliberately unspecified:** the doc states values are subject to change as LDS improves. `apex-result-caching.html` echoes: "The default cache duration can change as we optimize the platform. When you design your Lightning web components, don't assume a cache duration."
- **Coverage:** "all custom objects and all the standard objects that User Interface API supports." "Custom metadata types are not supported."
- Apex does **not** share the LDS cache: "Apex doesn't share cache with LDS; data can become inconsistent between the two" (Data Guidelines).

**Normalization.** LDS behaves as a *normalized record store keyed by record Id*, not a per-request blob cache. Evidence is circumstantial but strong: single load shared across components requesting different field sets; per-record `eTag`/`weakEtag` in the Record Representation; `notifyRecordUpdateAvailable` operating on *record ids* rather than on wire configurations; and field-level `optionalFields` merging. **[inference]** — the public docs never say "normalized store." I could not find a Salesforce doc or blog describing the internal store; the 2019 "Caching and Synchronizing Component Data with LDS" blog post explicitly does **not** cover normalized storage, field-level merging, dedup mechanics, TTL, or revalidation procedure (I fetched it and confirmed the absence).

**[UNVERIFIED]** Whether a `getRecord` wire requesting `{Name}` re-emits when a *different* component fetches `{Name, Industry}` and the `Name` value is unchanged. Doc says values aren't re-emitted when data hasn't changed, which suggests no. Treat as: emission is gated on *the subset of data this wire asked for*.

---

## 1.5 What `refreshApex` and `notifyRecordUpdateAvailable` actually invalidate

### `refreshApex(provisionedValue)`

- Imported from `@salesforce/apex`.
- Takes **the value that was provisioned to the wired property/function** — i.e. it is bound to *one specific wire instance and its configuration*, not to a key or a record id.
- "The `refreshApex()` function returns a Promise. When the Promise is resolved, the data in the wire is fresh." (`apex-result-caching.html`)
- "It uses the configuration bound to the `@wire` to get the data and update the cache."
- **Does not** refresh data fetched by calling an Apex method **imperatively**. For that: call the method again, then `notifyRecordUpdateAvailable(recordIds)`.
- Using it on non-Apex wire adapters is **deprecated** (Data Guidelines).

Scope: **one wire, one config.** Not fuzzy. Not prefix-based. Other components wired to the same Apex method with the same params are **not** directly refreshed by your `refreshApex` call **[inference]** — though they may observe the updated Apex client cache entry on their next read, since the Apex cache is keyed by method+params. **[UNVERIFIED]**: the docs do not state whether the Apex client cache is shared across component instances such that one `refreshApex` updates siblings. Do not assume it does.

### `notifyRecordUpdateAvailable(items)`

Signature: `notifyRecordUpdateAvailable(items: Array<{ recordId: string }>) => Promise<void>`

- "Informs Lightning Data Service that record data has changed so that Lightning Data Service can take the appropriate actions to keep wire adapters updated."
- Scope: "Considers the record data wired by all instantiated components." — **application-wide**, all live components.
- Behaviour: "For every wire that uses record data from one of the supplied recordIds, Lightning Data Service obtains fresh data for the wire and re-emits updated values." — it **refetches**, it does not merely mark stale.
- Emission gate still applies: no re-emit where data is unchanged.
- Returns a Promise resolved when LDS finishes processing; resolved value is void.
- Supersedes `getRecordNotifyChange`.

**Does it reach records that appear only as nested/spanning values inside another record's payload?** E.g. does notifying an `Account` id refresh an open `getRecord(Opportunity, ['Opportunity.Account.Name'])` wire? **[inference]** Yes, if the store is normalized by id — which is the whole point of the API taking ids. **[UNVERIFIED]** — not stated in the docs. Flag this in the fidelity catalog as an assumption, because it determines whether the shim needs a normalized index.

### `RefreshView` API (`lightning/refresh`) — the third, structurally different mechanism

- Fire `RefreshEvent` (from `lightning/refresh`); it "makes a request to a container to begin the refresh process."
- `registerRefreshContainer()` / `registerRefreshHandler()` build a **refresh tree** "the order of which emulates the DOM."
- "Registered refresh methods in the refresh tree are invoked in a **breadth-first order** from the registered container's node," so parent handlers resolve before children.
- Handler callbacks "Return a `Promise` that resolves to a `Boolean`: `true` if the component has completed operations… and the refresh process can continue… `false` to prevent the refresh process from continuing to child elements."
- Replaces `force:refreshView` from Aura. View-scoped, not record-scoped.

This is an **ordered, vetoable, hierarchical** refresh protocol. TanStack Query has no analogue (§1.10, row F14).

---

## 1.6 `@AuraEnabled(cacheable=true)` and the client cache

From `apex-result-caching.html`:

- "To use `@wire` to call an Apex method, you must set `cacheable=true`."
- "To set `cacheable=true`, a method must only get data, it can't mutate (change) data."
- "Marking a method as cacheable improves your component's performance by quickly showing cached data from client-side storage without waiting for a server trip."
- "The caching refresh time is the duration in seconds before an entry is refreshed in storage. The refresh time is automatically configured in Lightning Experience and the Salesforce mobile app."
- "The default cache duration can change as we optimize the platform… don't assume a cache duration."

**Cache key computation is not documented.** I checked `apex-result-caching.html` and `apex-wire-method.html`; neither specifies it. **[inference]** it is method identity + serialized params, since changing a reactive `$param` yields a distinct fetch and distinct cached entry.

**Underlying mechanism** is the Aura *storable action* store. Search-surfaced (Aura guide `controllers_server_storable_actions.htm`, plus community posts): expiration age ≈ **900 s (15 min)** and refresh age ≈ **30 s** in Lightning Experience; on a cache hit the framework returns the cached response immediately and *may* call the server in the background, invoking the callback a **second time** if the response differs. I did **not** fetch the Aura page directly, and the LWC guide explicitly tells you not to rely on any duration. Treat 900/30 as **[UNVERIFIED, indicative only]** — never hardcode it.

Note the stale-while-revalidate double-callback shape: it is very close to TanStack's `staleTime` + background refetch, which is a happy accident for the shim.

**Apex ≠ LDS.** `updateRecord` on a record does not invalidate an Apex `@wire` returning that record; LDS and Apex caches are separate and "data can become inconsistent between the two."

---

## 1.7 The precise nested shape of the record payload

### Record Representation (`ui_api_responses_record.htm`)

| Property | Type | Notes |
|---|---|---|
| `apiName` | String | "The API name for this record" |
| `childRelationships` | Map<String, Record Collection> | "The child relationship data for this record" |
| `fields` | Map<String, Field Value> | "The field data for this record, matching the requested layout and mode" |
| `id` | String | "The ID of this record" |
| `lastModifiedById` | String | v44.0+ |
| `lastModifiedDate` | String | ISO 8601, v44.0+ |
| `recordTypeId` | String | v48.0+ |
| `recordTypeInfo` | Record Type Info | do **not** use per the LWC guide |
| `systemModstamp` | String | v44.0+ |
| `eTag`, `weakEtag` | String / Integer | Present in the representation family; **not detailed on the page I fetched**. `eTag` is used for cache validation. **[UNVERIFIED]** exact semantics. |

Crucial constraint on the page: nested records are "returned for only **two levels** of nested records" before reverting to ID-only references.

### Field Value (`ui_api_responses_field_value.htm`)

| Property | Type | Notes |
|---|---|---|
| `displayValue` | String | "The displayable value for a field." Non-null when the value is localizable/formatted (dates, currency) or is a related record. Null value ⇒ null `displayValue`. |
| `value` | Object | "The value of a field in its raw data form." **If the field references another record, `value` contains a nested Record response body.** Date/time in ISO 8601. |

### The shape, concretely

For `getRecord({ recordId, fields: ['Opportunity.Name','Opportunity.Amount','Opportunity.Account.Name','Opportunity.Owner.Name'] })` the payload is **[inference from the two representations above; I could not find an official verbatim JSON sample with a spanning field — the LWC `data-wire-example.html` page contains no JSON, and the UI API "Get a Record" page did not expose one to my fetch]**:

```jsonc
{
  "apiName": "Opportunity",
  "id": "006...",
  "eTag": "...",
  "lastModifiedById": "005...",
  "lastModifiedDate": "2026-08-10T12:00:00.000Z",
  "recordTypeId": "012000000000000AAA",
  "systemModstamp": "2026-08-10T12:00:00.000Z",
  "childRelationships": {},
  "fields": {
    "Name":     { "value": "Acme - 500 Widgets", "displayValue": null },
    "Amount":   { "value": 50000,                "displayValue": "$50,000.00" },
    "AccountId":{ "value": "001...",             "displayValue": null },
    "Account":  {                                 // spanning: value is a nested Record
      "displayValue": "Acme Corp",
      "value": {
        "apiName": "Account",
        "id": "001...",
        "fields": { "Name": { "value": "Acme Corp", "displayValue": null } }
      }
    },
    "Owner":    {
      "displayValue": "Alice Ng",
      "value": {
        "apiName": "User",
        "id": "005...",
        "fields": { "Name": { "value": "Alice Ng", "displayValue": null } }
      }
    }
  }
}
```

Key rules to encode in the shim:

1. `displayValue` is `null` for plain strings/text — **not** a duplicate of `value`. Only localizable/formatted/related values populate it.
2. A spanning request like `Opportunity.Account.Name` does **not** produce a flat key `"Account.Name"`. It produces `fields.Account.value.fields.Name.value`. Accessors must walk.
3. Accessor helpers:
   - `getFieldValue(record, field)` "returns the property `record.data.fields.fieldName.value`."
   - `getFieldDisplayValue(record, field)` returns `record.data.fields.fieldName.displayValue`; "A string that displays the field value. If the field doesn't exist, this function returns `undefined`." and "returns undefined if a localized or formatted value is not available."
4. **Spanning depth limits differ by layer — do not conflate them:**
   - Accessor helpers: "You can specify up to **three** relationship fields… `<SObjectName>.<relationship-1>.<relationship-2>.<relationship-3>.<fieldName>`."
   - Record Representation nesting: **two levels** of nested records.
   - GraphQL API: five levels child-to-parent (different API, search-surfaced only).
   - `GET /ui-api/records/{id}` fields param: "There's no limit to the number of fields you can specify"; no explicit depth limit stated on the page.
5. `fields` on an inaccessible/nonexistent field ⇒ **error**; `optionalFields` ⇒ silently absent from the payload. FLS is expressed as *key absence*, not as `null`.
6. Polymorphic fields aren't supported in `fields`.

---

## 1.8 Error payload shapes: LDS vs Apex

From `data-error.html` — the wrapper is a **FetchResponse** in both cases:

```js
{
  "status": 400,
  "body": { /* varies by API */ },
  "headers": {},
  "ok": false,           // "For an error, ok is always false"
  "statusText": "Bad Request",
  "errorType": "fetchResponse"
}
```

`error.body` differs by source — this is the part that breaks naive conversions:

| Source | `error.body` shape |
|---|---|
| **UI API read** (`getRecord`, `getRecords`, …) | **Array** of `{ message, errorCode? }`. Idiom: `error.body.map(e => e.message).join(', ')` |
| **UI API write** (`createRecord`, `updateRecord`, `deleteRecord`) | **Object** with object-level and field-level errors (`enhancedErrorType`, `output.errors[]`, `output.fieldErrors{}`) — the guide describes it as an object with field-level and object-level errors. Exact key names for `output.*` are **[UNVERIFIED]** from the page I fetched. |
| **Apex** (wire or imperative) | **Object** |
| **Network error** | **Object** |

Apex body (from `apex-error-handling.html`, verbatim example):

```jsonc
{
  "status": 500,
  "body": {
    "exceptionType": "System.NullPointerException",
    "isUserDefinedException": false,
    "message": "Attempt to de-reference a null object",
    "stackTrace": "Class.ErrorExamples.unhandled: line 9, column 1"
  },
  "ok": false,
  "statusText": "Server Error",
  "errorType": "fetchResponse"
}
```

With `AuraHandledException`, the body collapses to just a message — no `exceptionType`, no `stackTrace`:

```jsonc
{
  "status": 500,
  "body": { "message": "Something went wrong: Attempt to de-reference a null object" },
  "ok": false,
  "statusText": "Server Error",
  "errorType": "fetchResponse"
}
```

> "The error message includes your custom message and the one returned from Apex, which is available via `e.getMessage()`. But the error doesn't include the `body.stackTrace` property."

**Implication for the converter:** every hand-written `error.body.message` in LWC source is *only correct for Apex/write errors*, and every `error.body[0].message` is *only correct for UI API reads*. Real LWC codebases are full of both used incorrectly. The shim must expose a normalized `reduceErrors(error)` **and** preserve the original shape so that migrated `if (Array.isArray(error.body))` branches still behave.

---

## 1.9 The `$param === undefined` behaviour — the #1 conversion defect

LWC:

> "Properties in the `{adapterConfig}` object can't be undefined. If a property is undefined, the wire service doesn't provision data, and both `data` and `error` stay undefined."

TanStack Query: `useQuery` fires on mount unconditionally. A naive conversion of

```js
@wire(getRecord, { recordId: '$recordId', fields: FIELDS }) record;
```

to

```ts
useQuery({ queryKey: ['record', recordId], queryFn: () => getRecord(recordId, FIELDS) })
```

issues `GET /ui-api/records/undefined` on first render — a guaranteed 404 storm, and on Salesforce a wasted API/UI-API call per component per mount.

The correct mapping — **`enabled` on *every* config property, not just the obvious one**:

```ts
const cfg = { recordId, fields: FIELDS };
useQuery({
  queryKey: sfKeys.record(cfg),
  queryFn: () => fetchRecord(cfg),
  enabled: isWireConfigDefined(cfg),   // deep: no property anywhere in cfg is undefined
});
```

Disabled-query state in v5 (from `dependent-queries` and `disabling-queries`):

| | LWC wire, `$param` undefined | TanStack, `enabled: false`, no cache |
|---|---|---|
| data | `undefined` | `undefined` |
| error | `undefined` | `null` |
| status | n/a | `'pending'` / `isPending: true` |
| fetchStatus | n/a | `'idle'` |
| isLoading | n/a | `false` (because `isLoading === isPending && isFetching`) |

So `isLoading` is the correct spinner flag; `isPending` is **not**. A generated component that renders a spinner on `isPending` will spin forever on an unsatisfied dependency, whereas the LWC rendered nothing. This is the second-order form of the same defect and is just as common.

Also documented for disabled queries: no fetch on mount, no background refetch, **`invalidateQueries` and `refetchQueries` are ignored**, but manual `refetch()` works.

`skipToken` alternative (TS-only): `queryFn: filter ? () => fetchTodos(filter) : skipToken`. Warning from the docs: "`refetch` from `useQuery` will not work with `skipToken`… results in a `Missing queryFn` error." **Recommendation: the shim uses `enabled`, not `skipToken`**, because `refreshApex`/`notifyRecordUpdateAvailable` emulation needs `refetch()` to work.

Note the transition case: LWC does not document what happens to already-provisioned `data` when a `$param` transitions **defined → undefined**. **[UNVERIFIED]**. TanStack, with an `enabled` guard, will switch to a *different query key* (`[..., undefined]`) and show `data: undefined`. **[inference]** these probably differ; LWC most likely retains the last provisioned value on the property since nothing overwrites it. Flag it; do not silently pick a behaviour.

Similarly **[UNVERIFIED]**: whether `null` (as opposed to `undefined`) in a config property suppresses provisioning. The doc says `undefined` only. Assume `null` is passed through to the server and errors.

---

## 1.10 Behaviour table → fidelity-loss catalog

"Replicable in TanStack Query" is judged against a shim that may add a custom transport, a QueryCache subscriber, and generated code — but **not** against a full rewrite of the cache into a normalized store unless stated.

| ID | LDS / wire behaviour | Replicable in TanStack Query? | How / why not |
|---|---|---|---|
| F1 | Wire does not fire while any config property is `undefined`; `data` and `error` both stay `undefined` | **Yes** | `enabled: isWireConfigDefined(cfg)`. Must map `isLoading` (not `isPending`) to the LWC "nothing yet" state. |
| F2 | Re-emit on reactive `$param` change | **Yes** | Param is part of the query key; key change ⇒ new query. |
| F3 | `data`/`error` mutually exclusive; error clears data | **Yes, with an adapter** | The shim projects `{data: isError ? undefined : data, error}`. Note this *discards* TanStack's better stale-data-plus-error UX; it is a deliberate fidelity choice, and should be a per-component opt-out. |
| F4 | No automatic retry | **Yes** | `retry: 0` (or a documented policy) in the shim's default `QueryClient`. |
| F5 | No refetch-on-window-focus / reconnect | **Yes** | `refetchOnWindowFocus: false`, `refetchOnReconnect: false` defaults. |
| F6 | Stale-after-cache-lifetime, revalidate on next read | **Approximately** | `staleTime` + `refetchOnMount: true`. **Exact LDS TTL is undocumented and explicitly non-contractual**, so parity is definitionally unattainable — pick a value and document it. |
| F7 | One record loaded once, shared by N components | **Yes** | Identical query keys dedupe; `queryKey` factory guarantees identity across generated components. |
| F8 | **Field-level normalized record store**: components requesting different field subsets of the same record share one cached record | **NO** (not without a normalized layer) | TanStack caches per key; `record(id,[Name])` and `record(id,[Name,Industry])` are two independent entries that can drift. Mitigations: (a) canonicalize+sort field lists in the key so identical sets collapse; (b) a "field superset" resolver in the shim that promotes a component's field list to a per-record union; (c) a normalized store (e.g. `normy`-style) layered under the QueryClient. All three are net-new engineering, not TanStack features. **Catalog this as a genuine loss.** |
| F9 | **Request bulkification** — LDS batches multiple distinct record requests into fewer server calls | **NO** | TanStack dedupes *identical* keys only; it never coalesces *different* keys into one request. Requires a custom batching transport (microtask-window request collector → `getRecords`/composite). Possible, but it is a transport feature, not a TanStack feature. |
| F10 | Emission gated on deep data equality — no re-emit when refetched data is identical | **Mostly** | Structural sharing keeps `data` referentially identical when JSON-equal ("will keep the unchanged parts and only replace the changed parts"), and tracked-properties Proxies suppress renders for unobserved fields. But observers *are* still notified and `dataUpdatedAt` changes; components subscribing to `dataUpdatedAt`/`isFetching` will re-render where LWC would not. Also structural sharing is **JSON-only** — it silently degrades if the shim puts non-JSON values (Dates, Maps) in the cache. |
| F11 | Wired data is frozen / read-only | **Yes, with effort** | Not TanStack's default. Enforce via a custom `structuralSharing` that deep-freezes in dev, or freeze in the transport. Cheap, worth doing: generated components inherited LWC's no-mutation assumption. |
| F12 | `notifyRecordUpdateAvailable(ids)` refetches **every live wire holding those records, app-wide**, including records reached only as nested spanning values | **Partially** | For records whose id is in the query key: `invalidateQueries({ predicate })` with a record-id index. For records appearing *only* nested inside another record's payload (e.g. `Opportunity.Account.Name`) there is no key to match — you need a reverse index built by walking emitted payloads (records carry `id` + `apiName`, so this is feasible) or a normalized store. **Catalog the nested case as a loss in the naive tier.** Also note the LDS nested behaviour is itself **[UNVERIFIED]**. |
| F13 | `notifyRecordUpdateAvailable` **refetches immediately**, and returns a Promise resolved when processing is complete | **Yes** | `invalidateQueries` returns a Promise and defaults to `refetchType: 'active'` — "only queries that match the refetch predicate and are actively being rendered via `useQuery` and friends will be refetched". Matches "wired by all instantiated components" closely. |
| F14 | **RefreshView API**: DOM-ordered refresh tree, breadth-first parent-before-child, each handler returns `Promise<boolean>` and `false` **halts propagation to children** | **NO** | `invalidateQueries` is an unordered set operation with no hierarchy, no ordering guarantee, and no veto. Emulation requires a bespoke React context tree of refresh handlers (doable — see `RefreshBoundary` in §2.7) but it is entirely outside TanStack. **Highest-confidence entry in the fidelity-loss catalog.** |
| F15 | `refreshApex(value)` refreshes exactly the one wire instance whose config produced `value` | **Yes** | Return a handle carrying its `queryKey`; `refreshApex(handle)` ⇒ `queryClient.refetchQueries({queryKey, exact:true})`. |
| F16 | Mutations through LDS (`updateRecord`, `lightning-record-form`, inline edit) automatically update all wires with no invalidation call | **Yes inside React**; **NO across the platform** | Within a pure React app the shim's mutations can invalidate. If the migrated app is **embedded in Lightning Experience alongside surviving LWC/Aura components or standard UI**, LDS↔React cache coherence is impossible: LDS will not observe React's writes and React will not observe LDS's. Requires an explicit bridge (fire `notifyRecordUpdateAvailable` outward, listen to `RefreshEvent` inward). **Catalog as a loss for hybrid deployments.** |
| F17 | `displayValue` — server-computed, locale- and org-format aware, per user | **Yes only while the transport is UI API** | If the migration switches to SOQL/REST/GraphQL raw values, every `displayValue` must be re-implemented client-side (currency/locale/timezone/field-format). **Catalog as a loss for any non-UI-API transport.** |
| F18 | FLS expressed as **absent keys** with `optionalFields`; hard error with `fields` | **Yes only while the transport is UI API** | Same conditional as F17. Generated code that does `fields.X.value` will throw on FLS-hidden fields exactly as LWC would — preserve that, don't "helpfully" default to `null`. |
| F19 | Apex client cache (`cacheable=true`) with stale-while-revalidate double-callback | **Approximately** | `staleTime` + background refetch is the same shape. Exact TTLs undocumented/non-contractual ⇒ no exact parity. |
| F20 | Apex cache is **separate** from the LDS record cache; deliberate incoherence | **Yes** | Simply do not link Apex query keys to record keys in the invalidation graph. (Tempting to "improve" this — don't, silently: it changes behaviour. Make it an opt-in flag.) |
| F21 | `error.body` polymorphism: array for UI API reads, object for UI API writes / Apex / network | **Yes** | The shim must *synthesize* the FetchResponse envelope, including `errorType: 'fetchResponse'`, `ok:false`, `status`, `statusText`, and the correct `body` polymorphism, so migrated error branches still work. |
| F22 | Record Representation: nested records only **two** levels; accessors span **three** relationships | **Yes** | It's a payload-shape rule; re-implement `getFieldValue`/`getFieldDisplayValue` with the same traversal and the same `undefined`-on-missing behaviour. |
| F23 | Polymorphic fields unsupported in `fields` | **N/A / Yes** | Preserve as a lint error at conversion time. |
| F24 | No server push; other users' changes are invisible until expiry-triggered revalidation | **Yes** | Default matches. (Beware: adding focus refetch would make the React app *fresher* than the LWC original — a behaviour change, even if an improvement.) |
| F25 | Mobile Offline / draft records (`lightning/uiGraphQLApi` v1) | **NO** | Offline drafts, draft-aware reads, and the platform sync engine have no TanStack equivalent. Out of scope; catalog as unsupported. |
| F26 | Wire emissions can arrive **before** `connectedCallback`/render | **N/A** | React's model differs structurally; no user-visible equivalent. Only matters if generated code depended on ordering — flag such code for manual review. |
| F27 | Cross-tab cache sharing | **N/A → parity by default** | LDS caches per browser tab/app context. TanStack likewise. Do **not** add `broadcastQueryClient`; it would diverge. |

**The four entries to put at the top of `<fidelity-loss>`:** F8 (normalized field-level record cache), F9 (bulkification), F14 (RefreshView tree semantics), F16 (hybrid LDS↔React coherence). F12-nested and F25 follow.

---

# PART 2 — R9: TanStack Query architecture for a machine-generated shim

## 2.1 Version reality check (Aug 2026)

React bindings are still **v5**. A "v6" exists but is the **Svelte** adapter (Svelte 5 support) running on the v5 core; Solid v6 work targets Solid 2. Releases through 2026 (Apr 23, May 8, Jun 27) are feature/patch level. **Design against v5 React APIs.** (Search-surfaced from GitHub release tags and aggregator sites; I did not fetch a release page directly — treat the "no React v6" claim as high-confidence but **[UNVERIFIED]** in the strict sense.)

## 2.2 Defaults you must override

From `important-defaults`:

- `staleTime: 0` — data is stale immediately.
- `gcTime: 5 min` for inactive queries.
- Auto refetch on **mount, window focus, network reconnect** for stale queries.
- Failed queries "silently retried **3 times, with exponential backoff delay**".
- Structural sharing **on** by default.

Every one of these is wrong for LWC parity except structural sharing. Ship a locked-down `QueryClient` (§2.6).

## 2.3 Query keys are the public API — the rules

From `query-keys`:

- "Query keys have to be an Array at the top level."
- "Query keys are hashed deterministically! This means that no matter the order of keys in objects, all of the following queries are considered equal" — `['todos', {status, page}]` ≡ `['todos', {page, status}]`. But "Array item order matters!"
- "If your query function depends on a variable, include it in your query key." "Adding dependent variables to your query key will ensure that queries are cached independently, and that any time a variable changes, queries will be refetched automatically."

From `query-invalidation`: default matching is **prefix/fuzzy** — `invalidateQueries({queryKey:['todos']})` matches `['todos']` and `['todos',{page:1}]`; `exact: true` narrows; `predicate` gives full control.

**The single most important consequence for machine-generated code:** object members inside a key are order-insensitive, array positions are not. So a generated key should place *ordered, hierarchical* segments in array positions (scope → entity → operation) and *unordered parameters* in a trailing object. This makes prefix invalidation meaningful and makes codegen immune to property-ordering nondeterminism.

**Recommended key grammar for the shim** (adapted from TkDodo's factory pattern, which is the de-facto standard):

```ts
['sf', <domain>, <entity>, <operation>, <paramsObject>]
//  ^     ^         ^          ^           ^
//  |     |         |          |           unordered, hashed deterministically
//  |     |         |          'detail' | 'list' | 'related' | 'invoke' | 'meta'
//  |     |         'Account' | 'Opportunity' | apex class.method | 'graphql'
//  |     'record' | 'apex' | 'objectInfo' | 'picklist' | 'relatedList' | 'graphql'
//  namespace root — enables "invalidate everything Salesforce"
```

TkDodo's canonical shape, verbatim, for reference:

```ts
const todoKeys = {
  all: ['todos'] as const,
  lists: () => [...todoKeys.all, 'list'] as const,
  list: (filters: string) => [...todoKeys.lists(), { filters }] as const,
  details: () => [...todoKeys.all, 'detail'] as const,
  detail: (id: number) => [...todoKeys.details(), id] as const,
}
```

with the guidance to structure "from *most generic* to *most specific*" and to co-locate keys "next to their respective queries, co-located in a feature directory."

**Deviation for our case:** TkDodo's co-location advice assumes hand-written feature folders. With N machine-generated components, co-location means N chances to invent a key. **We centralize instead** — one generated `keys.ts` in `@migration/salesforce-runtime`, and generated components never write keys at all (§2.5). This is a deliberate, justified departure from the community default, and it should be written down in the package README so future humans don't "fix" it.

**Canonicalization rules the key factory must enforce** (all **[inference]**, but each is forced by a documented behaviour):

1. Sort and dedupe `fields`/`optionalFields` arrays before they enter the key — otherwise `['Name','Industry']` and `['Industry','Name']` are two cache entries for identical data (array order matters).
2. Uppercase/normalize the 15↔18-char record Id form. Mixing forms doubles the cache. **[inference]**
3. Strip `undefined`-valued params rather than embedding them, and let `enabled` handle suppression — but keep them in the key if their presence is semantically meaningful. Prefer: refuse to build a key at all when required params are missing, and have the hook substitute a stable `['sf','disabled']`-style key. **[inference]** Simpler alternative that I'd actually ship: keep `undefined` in the key (it hashes fine) and rely on `enabled`; when the param resolves, the key changes and a fresh query starts, which mirrors LWC exactly.
4. Never put functions, class instances, Dates, or Maps in a key — deterministic hashing and structural sharing are JSON-based.

## 2.4 Structural sharing

From `render-optimizations`:

- "as many references as possible will be kept intact between re-renders"; on partial change React Query "will keep the unchanged parts and only replace the changed parts."
- Hook top-level return objects are "not referentially stable"; "the `data` properties returned from these hooks will be as stable as possible."
- JSON-only. "You can turn it off by setting `structuralSharing: false` globally or on a per-query basis, or you can implement your own structural sharing by passing a function to it."
- Tracked properties via Proxies: re-render only on properties actually accessed.
- `select` "will only re-run if: the `select` function itself changed referentially" or the data changed ⇒ wrap in `useCallback` or hoist.

**For the shim:** structural sharing is what buys us F10 (LDS's no-emit-when-unchanged). Two rules for codegen:
- Never pass an inline arrow as `select` from a generated component — hoist every `select` to module scope, or the memoization is void. This is exactly the kind of thing generators get wrong at scale.
- Keep the cache JSON-pure. UI API payloads already are (dates are ISO strings) — do **not** "helpfully" parse dates in the transport, or structural sharing degrades and F10 parity is lost.

## 2.5 Making machine-generated components incapable of inventing conventions

Layered, cheapest first. Layers 1–3 are the ones that actually work at scale.

**Layer 1 — components cannot import TanStack at all.**
Generated code imports only `@migration/salesforce-runtime`. Enforce with ESLint `no-restricted-imports` scoped to the generated directory:

```js
// eslint.config.js
{
  files: ['src/generated/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@tanstack/react-query',
        message: 'Generated components must use @migration/salesforce-runtime hooks. Query keys and cache policy are owned by the runtime.',
      }],
      patterns: ['**/queryClient', '**/keys'],
    }],
  },
}
```

`useQueryClient` and raw `useQuery` become unreachable from generated code. This single rule removes ~90% of the convention drift surface.

**Layer 2 — the runtime owns every key; hooks take config objects, never keys.**
`useRecord({recordId, fields})` — there is no parameter through which a component could supply a key. Internally the hook calls the factory. Codegen literally cannot emit a key.

**Layer 3 — runtime key validation (dev + CI).**
Install a custom `queryKeyHashFn` on the `QueryClient` that throws in dev if a key wasn't produced by the factory. Brand keys by making element 0 a frozen sentinel:

```ts
export const SF_ROOT = Object.freeze({ ns: 'sf' as const });

const queryKeyHashFn = (key: readonly unknown[]) => {
  if (process.env.NODE_ENV !== 'production' && key[0] !== SF_ROOT) {
    throw new Error(
      `Unbranded query key ${JSON.stringify(key)}. Keys must come from sfKeys.*`
    );
  }
  return defaultHashFn(key);
};
```

Because deterministic hashing serializes the key, the sentinel object also hashes stably. Any hand-rolled `['record', id]` fails loudly the first time it runs — including in generated-code snapshot tests. **[inference]** — this is my design, not a documented TanStack pattern; verify `queryKeyHashFn` receives the raw key array before shipping.

**Layer 4 — `@tanstack/eslint-plugin-query`, strict.**

```js
import pluginQuery from '@tanstack/eslint-plugin-query'
export default [...pluginQuery.configs['flat/recommended-strict']]
```

Rules available: `exhaustive-deps`, `no-rest-destructuring`, `stable-query-client`, `no-unstable-deps`, `infinite-query-property-order`, `no-void-query-fn`, `mutation-property-order`, `prefer-query-options`. `exhaustive-deps` is the load-bearing one — it catches "variable used in `queryFn` but missing from `queryKey`", i.e. the class of bug that causes a generated component to serve another record's data. Documented caveat: it "works with query key factories" but is "less effective with heavily abstracted patterns" and "may struggle with complex dependency chains across multiple files." Since our factories live in another package, **do not rely on `exhaustive-deps` as the primary guard** — Layers 1–3 are. Note the official plugin superseded the stale community `eslint-plugin-react-query` (TanStack discussion #3992).

**Layer 5 — `QueryFunctionContext` instead of closures.**
TkDodo: "With this approach, you basically have no way of using any additional parameters in your `queryFn` without also adding them to the `queryKey`." The `queryFn` destructures from `queryKey`, so key/fn divergence becomes structurally impossible:

```ts
const fetchRecord = ({ queryKey: [, , , , params] }:
  QueryFunctionContext<ReturnType<typeof sfKeys.record>>) => uiApi.getRecord(params);
```

TkDodo further recommends **object-shaped keys** to avoid fragile positional destructuring — worth adopting for the params segment, which is exactly what the grammar in §2.3 does.

**Layer 6 — `queryOptions()` as the unit of sharing.**
It "just returns whatever you pass into it" but yields type inference and lets the same definition serve `useQuery`, `useSuspenseQuery`, `useQueries`, `prefetchQuery`, and `setQueryData(opts.queryKey, …)`:

```ts
function groupOptions(id: number) {
  return queryOptions({ queryKey: ['groups', id], queryFn: () => fetchGroups(id), staleTime: 5*1000 })
}
useQuery(groupOptions(1))
queryClient.prefetchQuery(groupOptions(23))
queryClient.setQueryData(groupOptions(42).queryKey, newGroups)
```

The shim should export `recordQueryOptions(cfg)` / `apexQueryOptions(...)` publicly for hand-written escape-hatch code, with `useRecord`/`useApex` as thin wrappers. This gives humans an on-ramp without letting generated code near it.

## 2.6 Invalidation graph design

**Primitives** (`QueryClient` reference): `invalidateQueries(filters, options)` with `queryKey` (prefix by default), `exact`, `predicate`, and `refetchType: 'active' | 'inactive' | 'all' | 'none'` **defaulting to `'active'`** — "only queries that match the refetch predicate and are actively being rendered via `useQuery` and friends will be refetched." Plus `setQueryData` (sync, creates if absent), `getQueryData`, `resetQueries` (back to initial state), `removeQueries` (evict).

**Design rules:**

1. **Model the graph as data, not as call sites.** A generated `INVALIDATION_EDGES` table maps mutation kind → key prefixes / predicates. Never let a generated component call `invalidateQueries` inline — that's the thing that rots.

```ts
type Edge =
  | { kind: 'prefix'; key: readonly unknown[] }
  | { kind: 'recordId'; recordId: string }
  | { kind: 'apexTouches'; methods: string[] };

const EDGES: Record<MutationKind, (ctx: MutationCtx) => Edge[]> = { /* generated */ };
```

2. **Three tiers, matching the three LWC mechanisms.** They are not interchangeable, and collapsing them is a fidelity bug:

| LWC call | Shim call | TanStack implementation |
|---|---|---|
| `refreshApex(value)` | `refreshApex(handle)` | `refetchQueries({ queryKey: handle.queryKey, exact: true })` |
| `notifyRecordUpdateAvailable(ids)` | same | `invalidateQueries({ predicate: touchesAnyRecordId(ids), refetchType: 'active' })` |
| `RefreshEvent` | `useRefreshView()` / `<RefreshBoundary>` | bespoke ordered tree walk (§2.7), *then* `invalidateQueries({ queryKey: sfKeys.all })` within the boundary's scope |

3. **`refetchType` is the LWC-parity knob.** LDS re-emits to *instantiated components*; `'active'` is exactly that, and it's the default. Use `'all'` only where the LWC original also warmed unmounted state (rare). Use `'none'` for "mark stale, let mount handle it".
4. **Record-id predicates need an index.** Because Apex results are opaque blobs, `touchesAnyRecordId` can only match LDS-family keys (which contain the id) unless you subscribe to the `QueryCache` and walk emitted Record payloads to build `recordId → Set<queryHash>`. Recommended for tier-2 fidelity; see F12.
5. **Beware disabled queries.** Documented: disabled queries "ignore `invalidateQueries` and `refetchQueries` calls." A component whose `$param` is currently undefined will not be refreshed by a notify — which is *also* true in LWC (it has no live wire). Parity holds. Don't "fix" it.
6. **Do not link Apex keys to record keys by default** (F20) — LDS deliberately doesn't.

## 2.7 Emulating RefreshView (F14)

TanStack cannot do this; React can. Sketch:

```tsx
const RefreshCtx = createContext<{ register(h: RefreshHandler): () => void } | null>(null);
type RefreshHandler = () => Promise<boolean>;   // false halts descent, per LWC semantics
```

`<RefreshBoundary>` holds a depth-ordered registry (register with a depth derived from context nesting), and `refresh()` walks it **breadth-first**, awaiting each level and pruning subtrees whose handler resolved `false`. Generated components call `useRefreshHandler(async () => { await refetch(); return true; })`, mirroring `registerRefreshHandler()` in `connectedCallback`.

Caveat: LWC's ordering "emulates the DOM"; React context nesting is a close but not identical proxy (portals, sibling order). **[inference]** — good enough for parity in practice; note the divergence in the catalog.

---

# PART 3 — Recommended API surface: `@migration/salesforce-runtime`

Design goals, in priority order: (1) generated components cannot invent conventions; (2) the call site reads like the LWC it replaced, so diffs are reviewable; (3) every LWC escape hatch has a named equivalent; (4) fidelity divergences are explicit flags, never silent defaults.

```ts
// ─────────────────────────────────────────────────────────────
// Core result type — mirrors the LWC wire contract exactly.
// ─────────────────────────────────────────────────────────────
export interface WireResult<T> {
  /** undefined until provisioned; undefined while an error is current (LWC parity, F3) */
  data: T | undefined;
  /** FetchResponse-shaped; undefined when data is current */
  error: FetchResponse | undefined;

  // --- escape hatch: full TanStack surface, for hand-written code only ---
  readonly query: UseQueryResult<T, FetchResponse>;
  /** stable identity; consumed by refreshApex() */
  readonly handle: WireHandle;
}

export interface WireHandle {
  readonly queryKey: readonly unknown[];
  readonly refetch: () => Promise<void>;
}

export interface FetchResponse {
  status: number;
  statusText: string;
  ok: false;
  headers: Record<string, string>;
  errorType: 'fetchResponse';
  /** array for UI API reads; object for UI API writes / Apex / network (F21) */
  body: Array<{ message: string; errorCode?: string }> | Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────
export interface SalesforceRuntimeConfig {
  transport: SalesforceTransport;            // UI API / proxy / mock
  /** default 30_000. LDS TTL is undocumented (F6) — this is a policy choice, not parity. */
  recordStaleTime?: number;
  /** default 30_000; Apex storable-action refresh age is ~30s but non-contractual (F19) */
  apexStaleTime?: number;
  /** default false. true = TanStack-native UX (keep stale data on error). Diverges from LWC (F3). */
  keepDataOnError?: boolean;
  /** default false. true enables the recordId→queryHash reverse index for nested notify (F12). */
  normalizedRecordIndex?: boolean;
  /** default false. true enables microtask request coalescing into getRecords (F9). */
  bulkifyRecordReads?: boolean;
  /** default true in dev: freeze provisioned data (F11) */
  freezeProvisionedData?: boolean;
}
export function SalesforceRuntimeProvider(props: React.PropsWithChildren<SalesforceRuntimeConfig>): JSX.Element;

/** The locked-down client. Exported for tests only; generated code never sees it. */
export function createSalesforceQueryClient(cfg: SalesforceRuntimeConfig): QueryClient;
// defaults: retry:0, refetchOnWindowFocus:false, refetchOnReconnect:false,
//           refetchOnMount:true, gcTime:5min, structuralSharing:true,
//           queryKeyHashFn: branded (dev-throws on unbranded keys)

// ─────────────────────────────────────────────────────────────
// LDS read adapters — one per LWC wire adapter, same config shape
// ─────────────────────────────────────────────────────────────
export interface GetRecordConfig {
  recordId: string | undefined;
  fields?: FieldRef[] | undefined;
  optionalFields?: FieldRef[] | undefined;
  layoutTypes?: Array<'Compact' | 'Full'> | undefined;
  modes?: Array<'Create' | 'Edit' | 'View'> | undefined;
}
export function useRecord(config: GetRecordConfig): WireResult<RecordRepresentation>;

export function useRecords(config: {
  records: Array<{ recordIds: string[]; fields?: FieldRef[]; optionalFields?: FieldRef[] }> | undefined;
}): WireResult<BatchRecordResult>;

export function useRelatedListRecords(config: {
  parentRecordId: string | undefined;
  relatedListId: string | undefined;
  fields?: FieldRef[]; optionalFields?: FieldRef[];
  pageSize?: number; sortBy?: string[]; where?: string;
}): WireResult<RelatedListRecordCollection>;

export function useObjectInfo(config: { objectApiName: string | ObjectRef | undefined }): WireResult<ObjectInfo>;
export function usePicklistValues(config: { recordTypeId: string | undefined; fieldApiName: FieldRef | undefined }): WireResult<PicklistValues>;
export function useGraphQL(config: { query: string | undefined; variables?: Record<string, unknown> }): WireResult<GraphQLResult>;

// ─────────────────────────────────────────────────────────────
// Apex
// ─────────────────────────────────────────────────────────────
/** Mirrors @wire(apexMethod, {a:'$a'}). `params: undefined` ⇒ never fires (F1). */
export function useApex<TParams extends Record<string, unknown>, TResult>(
  method: ApexMethodRef<TParams, TResult>,
  params: TParams | undefined,
  options?: { staleTime?: number; keepDataOnError?: boolean },
): WireResult<TResult>;

/** Mirrors an imperative Apex call. Not cached; never a query. */
export function callApex<TParams, TResult>(
  method: ApexMethodRef<TParams, TResult>,
  params: TParams,
): Promise<TResult>;

/** Generated per Apex class by the converter; carries cacheable-ness + identity for keys. */
export interface ApexMethodRef<TParams, TResult> {
  readonly __apex: `${string}.${string}`;   // 'AccountController.getAccounts'
  readonly cacheable: boolean;
  readonly __result?: TResult;              // phantom
  readonly __params?: TParams;              // phantom
}

// ─────────────────────────────────────────────────────────────
// Imperative record ops (lightning/uiRecordApi parity)
// ─────────────────────────────────────────────────────────────
export function useCreateRecord(): UseMutationResult<RecordRepresentation, FetchResponse, RecordInput>;
export function useUpdateRecord(): UseMutationResult<RecordRepresentation, FetchResponse, RecordInput>;
export function useDeleteRecord(): UseMutationResult<void, FetchResponse, string>;
// Non-hook forms for direct ports of LWC event handlers:
export function createRecord(input: RecordInput): Promise<RecordRepresentation>;
export function updateRecord(input: RecordInput, clientOptions?: { ifUnmodifiedSince?: string }): Promise<RecordRepresentation>;
export function deleteRecord(recordId: string): Promise<void>;
// All six auto-apply INVALIDATION_EDGES for the affected recordId (F16, in-React only).

// ─────────────────────────────────────────────────────────────
// Refresh mechanisms — three, deliberately not unified
// ─────────────────────────────────────────────────────────────
export function refreshApex(handle: WireHandle | WireResult<unknown>): Promise<void>;
export function notifyRecordUpdateAvailable(items: Array<{ recordId: string }>): Promise<void>;
export function useRefreshHandler(handler: () => Promise<boolean>): void;   // ≈ registerRefreshHandler
export function RefreshBoundary(props: React.PropsWithChildren<{ onRefresh?: () => void }>): JSX.Element;
export function useRefreshView(): { refresh: () => Promise<void> };         // ≈ fire RefreshEvent

// ─────────────────────────────────────────────────────────────
// Field accessors — byte-compatible with lightning/uiRecordApi
// ─────────────────────────────────────────────────────────────
export function getFieldValue(record: RecordRepresentation | undefined, field: FieldRef): unknown;
export function getFieldDisplayValue(record: RecordRepresentation | undefined, field: FieldRef): string | undefined;
// Both walk fields.X.value.fields.Y.value for spanning refs (up to 3 relationships, F22)
// and return undefined for missing fields, matching the LWC helpers exactly.

export function reduceErrors(error: FetchResponse | FetchResponse[] | undefined): string[];
// Handles all four body shapes (F21). Generated catch blocks call this.

// ─────────────────────────────────────────────────────────────
// Keys + options (public for hand-written code; unreachable from generated code)
// ─────────────────────────────────────────────────────────────
export const sfKeys: {
  all: readonly [typeof SF_ROOT];
  records: () => readonly unknown[];
  record: (c: GetRecordConfig) => readonly unknown[];      // canonicalizes+sorts fields
  relatedList: (c: RelatedListConfig) => readonly unknown[];
  objectInfo: (apiName: string) => readonly unknown[];
  apexAll: () => readonly unknown[];
  apex: (m: string, params: unknown) => readonly unknown[];
  graphql: (q: string, v: unknown) => readonly unknown[];
};
export function recordQueryOptions(c: GetRecordConfig): UseQueryOptions<RecordRepresentation, FetchResponse>;
export function apexQueryOptions<P, R>(m: ApexMethodRef<P, R>, p: P): UseQueryOptions<R, FetchResponse>;

// ─────────────────────────────────────────────────────────────
// Guard used by every hook — exported for the converter's tests
// ─────────────────────────────────────────────────────────────
export function isWireConfigDefined(config: object): boolean;  // deep: no undefined anywhere (F1)
```

### Reference implementation of the core hook

```ts
export function useRecord(config: GetRecordConfig): WireResult<RecordRepresentation> {
  const { recordStaleTime, keepDataOnError } = useRuntimeConfig();
  const enabled = isWireConfigDefined(config);           // ← F1: the whole ballgame
  const queryKey = sfKeys.record(config);

  const query = useQuery({
    queryKey,
    queryFn: fetchRecordFromContext,                     // reads params off queryKey (§2.5 L5)
    enabled,
    staleTime: recordStaleTime,
  });

  return useMemo(() => ({
    // F3: LWC never shows data and error together, unless explicitly opted out
    data: query.isError && !keepDataOnError ? undefined : query.data,
    error: query.isError ? (query.error as FetchResponse) : undefined,
    query,
    handle: { queryKey, refetch: async () => { await query.refetch(); } },
  }), [query, keepDataOnError, queryKey]);
}
```

Note what is *not* here: no `isLoading`/`isPending` in the LWC-parity surface. Generated components render exactly what the LWC did — nothing — until `data` or `error` appears. Loading UI is opt-in via `result.query.isLoading` (**not** `isPending`, §1.9).

### Converter-side rules implied by this surface

1. `@wire(getRecord, {recordId:'$recordId', fields:FIELDS}) rec;` → `const rec = useRecord({recordId, fields: FIELDS});` — the `$` disappears, the guard is automatic.
2. Every wired **function** (`@wire(x) handler({data,error}){}`) → `useEffect` on `[result.data, result.error]`. Emission-count parity is approximate: LWC's deep-equality gate vs React's structural sharing (F10). Flag any handler with side effects for review.
3. `refreshApex(this.rec)` → `refreshApex(rec)` — `WireResult` is accepted directly so the diff is one character.
4. `error.body[0].message` and `error.body.message` both survive unchanged because the shim reproduces the polymorphic body; but the converter should rewrite both to `reduceErrors(error)` and note it.
5. Any component using `layoutTypes` needs an object-info fetch to resolve the layout — different transport shape. Flag for manual review.

---

# Gaps I could not close (say so, don't guess)

1. **No official verbatim JSON sample of a `getRecord` payload with a spanning field.** The LWC `data-wire-example.html` contains no JSON; the UI API "Get a Record" page didn't surface one to my fetch; the 2018 UI API blog has none. The shape in §1.7 is assembled from the Record and Field Value representations and is **[inference]**. **Action: capture a real payload from a scratch org and pin it as a golden fixture before building the shim.** This is a one-hour spike with outsized value.
2. **LDS internal cache architecture** (normalization, merge, dedup mechanics, TTL, revalidation protocol, eTag usage) is not publicly documented anywhere I could find — the 2019 blog explicitly lacks it. All statements about normalization are **[inference]**.
3. **`notifyRecordUpdateAvailable` reach into nested/spanning records** — unverified. Determines whether the shim needs the reverse index. **Action: empirical test in an org.**
4. **Apex client cache key computation and whether it is shared across component instances** — undocumented.
5. **Actual LDS/Apex cache TTLs** — deliberately undocumented and non-contractual. The 900 s / 30 s figures are Aura-era, search-surfaced, and must not be hardcoded.
6. **`$param` transitioning defined → undefined** — undocumented; and whether `null` behaves like `undefined`.
7. **UI API write-error body key names** (`output.errors`, `output.fieldErrors`, `enhancedErrorType`) — the fetched page described the shape in prose without a verbatim example.
8. **`queryKeyHashFn` receiving the raw key array** (needed for the branding trick in §2.5 L3) — I did not fetch the API reference for it. Verify before relying on it.
9. **No React TanStack Query v6** — high confidence from release listings, but I did not fetch a release page directly.

---

# Sources

**Fetched directly (WebFetch):**

- https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-record.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-ui-api.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-wire-service-about.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-wire-example.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-guidelines.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-error.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-refreshview-api.html
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-result-caching.html
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-wire-method.html
- https://developer.salesforce.com/docs/platform/lwc/guide/apex-error-handling.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-notify-record-update.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-update-record.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-get-field-value.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-get-field-display-value.html
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_record.htm
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_responses_field_value.htm
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_resources_record_get.htm
- https://developer.salesforce.com/blogs/2019/09/caching-and-synchronizing-component-data-with-lightning-data-service
- https://developer.salesforce.com/blogs/2018/01/introduction-salesforce-ui-api
- https://tanstack.com/query/v5/docs/framework/react/guides/query-keys
- https://tanstack.com/query/v5/docs/framework/react/guides/query-options
- https://tanstack.com/query/v5/docs/framework/react/guides/dependent-queries
- https://tanstack.com/query/v5/docs/framework/react/guides/disabling-queries
- https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation
- https://tanstack.com/query/v5/docs/framework/react/guides/render-optimizations
- https://tanstack.com/query/v5/docs/framework/react/guides/important-defaults
- https://tanstack.com/query/v5/docs/reference/QueryClient
- https://tanstack.com/query/v5/docs/eslint/eslint-plugin-query
- https://tanstack.com/query/v5/docs/eslint/exhaustive-deps
- https://tkdodo.eu/blog/effective-react-query-keys
- https://tkdodo.eu/blog/leveraging-the-query-function-context
- https://github.com/TanStack/query/discussions/3992

**Attempted, returned 404 (recorded for completeness):**

- https://developer.salesforce.com/docs/platform/lwc/guide/apex-result-caching-refresh.html
- https://developer.salesforce.com/docs/platform/lwc/guide/data-ui-api-record-update.html

**Search-surfaced only — used for orientation, cited as lower-confidence, not fetched in full:**

- https://developer.salesforce.com/docs/platform/lwc/guide/reference-get-record-notify.html (getRecordNotifyChange, deprecated)
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-refresh.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-refreshview-registerrefreshhandler.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-wire-adapters-get-related-list-records.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-graphql-module.html
- https://developer.salesforce.com/docs/platform/lwc/guide/reference-lightning-graphql-api.html
- https://developer.salesforce.com/docs/atlas.en-us.lightning.meta/lightning/controllers_server_storable_actions.htm (900 s / 30 s figures)
- https://github.com/salesforce/lwc-rfcs/blob/master/text/0103-wire-adapters.md (immutability of provisioned values)
- https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_ui.pdf (UI API Guide v67.0, Summer '26)
- https://github.com/lukemorales/query-key-factory
- https://github.com/TanStack/query/releases (2026 release cadence; no React v6)
