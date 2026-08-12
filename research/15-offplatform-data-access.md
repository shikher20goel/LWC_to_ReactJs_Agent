# 15 — Off-Platform Data Access: Reaching Salesforce from a React App on AWS ECS

**Status:** Research complete, 12 Aug 2026
**Context:** Target architecture changed. The migrated React app runs in a container on AWS ECS, fully off the Salesforce platform. It is not an LWC, not in an Experience Cloud site, not in Lightning Experience. Every server interaction is now a cross-origin HTTP call to a Salesforce org.
**Current Salesforce API version at time of writing:** v67.0 (Summer '26).
**Decision this doc gates:** census gate **C-4** (FLS/sharing enforcement) and the overall scope of the migration programme.

---

## 0. BOTTOM LINE UP FRONT

1. **Your working belief is correct.** `@AuraEnabled` Apex is **not** an externally callable API. It is reachable only through the Aura/LWC framework's own server endpoint, which is an internal framework transport, not a supported integration surface. There is no supported way for a React app on ECS to call `@AuraEnabled` methods.
2. **Therefore: every `@wire(apexMethod)` and every imperative Apex import in a migrated component is a backend work item, not a frontend one.** The Apex must be re-exposed through a supported API. This is a whole workstream that a "convert the UI components" plan does not contain.
3. **The cheapest re-exposure path is usually `@InvocableMethod`, not `@RestResource`** — it is an additive annotation on an existing method-shaped unit of logic and gets you a generic REST endpoint with no URL design work. `@RestResource` is better when you want a designed API contract. Both are real work; neither is free.
4. **UI API *is* callable externally**, with OAuth, and it *is* CORS-allowlistable. This is genuinely good news for the shim: `getRecord`/RecordRepresentation semantics are preserved because they are literally the same API. UI API is also the only option in the list that enforces FLS, sharing, object perms, and layout metadata *for you*.
5. **Do not put a Salesforce access token in the browser.** Run a **BFF on ECS**. This is the IETF's own strongly-worded recommendation for exactly this class of application, and it also sidesteps the entire Salesforce CORS/allowlist problem.
6. **The FLS/sharing picture changed materially in Summer '26 (v67.0)** — Apex now defaults to *user mode* at API v67.0+. This is version-gated, so your existing older-API-version Apex is almost certainly still running in system mode. Read §6 carefully; this is the part most likely to cause a data-exposure incident.

---

## 1. THE DECIDING QUESTION: Can `@AuraEnabled` Apex be called from an external application?

### Verdict: **NO — not in any supported way.**

### 1.1 What the official docs say

Apex Developer Guide, *AuraEnabled Annotation*:

> "The @AuraEnabled annotation enables client-side and server-side access to an Apex controller method."

> "Providing this annotation makes your methods available to your Lightning components (both Lightning web components and Aura components)."

The scope statement is exhaustive in the negative sense: the annotation's documented effect is *availability to Lightning components*. Nothing in the Apex Developer Guide's REST/SOAP/integration chapters lists `@AuraEnabled` as an externally invocable surface. The externally invocable Apex surfaces that **are** documented are:

- `@RestResource` → `/services/apexrest/*` (Apex Developer Guide, *Exposing Apex Classes as REST Web Services*)
- `webservice` keyword → SOAP
- `@InvocableMethod` → Invocable Actions REST API (`/services/data/vXX/actions/custom/apex/*`)

`@AuraEnabled` appears in none of them.

Lightning Aura Components Developer Guide, *AuraEnabled Annotation*:

> "The AuraEnabled annotation enables Lightning components to access Apex methods and properties."

> "For API version of 50.0 or higher, you must specify which users can access Apex classes that contain @AuraEnabled methods."

That last line is an access-control statement about *Salesforce users of Lightning components*, not about API clients.

**Conclusion:** there is no documented request format, no documented endpoint, no documented auth binding, and no versioned contract for calling `@AuraEnabled` from a non-Lightning client. It is a framework-internal RPC mechanism.

### 1.2 The nuance you will hear from someone on the team, and why it does not rescue you

`@AuraEnabled` methods *are* physically reachable over HTTP, because the Aura framework itself is an HTTP client. Security researchers have documented and weaponised this. AppOmni Labs, *Lightning Components: A Treatise on Apex Security from an External Perspective*, demonstrates POSTing a crafted `message` payload to the Aura endpoint (e.g. `/s/sfsites/aura`) naming a controller action and its parameters:

> "The below payload is a skeleton that can be reused to call any custom apex."

and, on unauthenticated Experience Cloud pages:

> "A value of `undefined` indicates that the request is sent from the privileged context of the `Guest User` profile since you are unauthenticated."

**Do not build on this.** Reasons, in order of importance:

1. **It is undocumented and unversioned.** Salesforce can and does change the Aura message envelope, the framework UID (`aura.context` `fwuid`), and the action descriptor format at any release. Your app breaks three times a year with no release note and no deprecation window.
2. **It requires a framework session context**, not an OAuth access token. You would be scraping/forging `aura.token` and `fwuid` — i.e. reimplementing a browser session against an endpoint designed to reject exactly that.
3. **It is the exact pattern used in published Salesforce attacks.** Anything that detects it — Salesforce Shield, Event Monitoring, an org security review, a pen test, an ISV security review — will flag it as an attack signature, not as your integration.
4. **It has no support path.** Salesforce Support will close the case.

Treat "call the Aura endpoint" as a **prohibited pattern** in the migration standards doc, and say so explicitly, because someone will find that blog post and propose it as a shortcut that "saves the whole backend workstream."

### 1.3 The one legitimate way `@AuraEnabled` keeps working off-platform: Lightning Out 2.0

There is a supported escape hatch, and it is new enough that it may not be on your radar. **Lightning Out 2.0 went GA in Winter '26.**

LWC Developer Guide, *Use Components Outside Salesforce with Lightning Out 2.0*:

> "Embed custom Lightning web components (LWC) into external, non-Salesforce apps by using Lightning Out 2.0, a special Salesforce app that you create and configure in Setup."

> "Lightning Out 2.0 is built on Lightning Web Runtime (LWR) and encapsulates embedded components in iframes within a shadow DOM. This new approach keeps the components more secure while still allowing for fast and responsive interactions."

> "completely replaces—and isn't an extension of—Lightning Out (beta)"

Auth is via OAuth plus a `frontdoor-url`, per the Salesforce Developers announcement:

> "frontdoor-url establishes the session and authentication context for the embedded LWCs."

**Why this matters to you:** a Lightning Out 2.0-embedded LWC is still running the real Lightning runtime inside an iframe, against a real Salesforce session. **[inference — I could not find an explicit doc statement confirming this]** `@AuraEnabled` Apex and `@wire` adapters should therefore continue to work inside that iframe, because it is the same runtime and the same transport. **Verify this with a spike before relying on it.**

**Why it is not a general answer:**
- The component is in an **iframe with closed shadow DOM**. Communication with your React host page is `window.postMessage()` only. You do not get a React component; you get an embedded island.
- The GA release explicitly notes gaps: "full base component support will follow" and "Aura component compatibility aren't part of this initial release." Unauthenticated access is still roadmap.
- It is the *opposite* of your migration goal. You are trying to leave the platform runtime; this keeps it.

**Where it earns its place:** as a **strangler-fig bridge**. High-complexity, low-value, Apex-heavy components that you do not want to convert in phase 1 can be embedded via Lightning Out 2.0 and left alone, while the rest of the app becomes real React. Budget it as a deliberate tactic for a named subset of the census, not as the default.

---

## 2. THE ACTUAL OPTIONS FOR REACHING APEX LOGIC AND DATA

### 2.1 Comparison matrix

| Option | Endpoint | Re-exposure cost per method | FLS / sharing | Mirrors LDS semantics? | Verdict |
|---|---|---|---|---|---|
| `@AuraEnabled` direct | — | N/A | — | — | **Not available. Do not attempt.** |
| `@InvocableMethod` | `/services/data/vXX/actions/custom/apex/{Name}` | **Low** — additive annotation + wrapper types | Apex rules (§6) | No | **Best default for lift-and-shift of existing Apex** |
| `@RestResource` | `/services/apexrest/{path}` | **Medium** — URL design, verb mapping, request/response types, tests | Apex rules (§6) | No | Best where you want a designed API |
| REST sObject / Query | `/services/data/vXX/sobjects/*`, `/query` | **Zero** — already exists | Enforced (runs as user) | Partially | Use for plain CRUD/read |
| Composite / Composite Graph | `/services/data/vXX/composite*` | Zero | As per subrequests | No | Use to kill request waterfalls |
| **UI API** | `/services/data/vXX/ui-api/*` | **Zero** | **Enforced, plus layouts/picklists** | **Yes — identical** | **Use for anything the shim models on `getRecord`** |
| GraphQL API | `/services/data/vXX/graphql` | Zero | Enforced (OLS + FLS) | Partially (UI API family) | Use to collapse over-fetching |
| Connect REST API | `/services/data/vXX/connect/*` | Zero | Enforced | No | Only for Chatter/Files/Communities features |
| Lightning Out 2.0 | Embedded iframe | Zero (component unchanged) | Platform-native | Yes (it *is* the platform) | Bridge for deferred components |

### 2.2 `@RestResource` / Apex REST — what it costs to add to existing controllers

Apex Developer Guide, *Exposing Apex Classes as REST Web Services*: the `@RestResource` annotation "exposes Apex classes as REST web services, allowing external applications to access your code through REST architecture," served from base URI `/services/apexrest/`. Supported auth per *Introduction to Apex REST*: **"Apex REST supports these authentication mechanisms: OAuth 2.0"** and **"Session ID."** Calls "count against the organization's API governor limits" and "All standard Apex governor limits apply."

**Real cost per existing `@AuraEnabled` method, honestly stated:**

1. You cannot simply re-annotate. `@RestResource` is a **class-level** annotation with a URL mapping; `@HttpGet`/`@HttpPost`/etc. are **method-level** and you get **one method per HTTP verb per class**. An Apex controller with eight `@AuraEnabled` methods does not become one REST class — it becomes either eight classes, or one class with a dispatch parameter (which is an anti-pattern that reviewers will reject).
2. Parameter binding differs. `@AuraEnabled` gets named-parameter deserialisation from the framework. Apex REST binds from URL path, query string, or a JSON body whose shape you must now design.
3. Return types: `@AuraEnabled` returns are serialised by the framework, including `@AuraEnabled` properties on inner classes. For Apex REST you must confirm every returned type serialises cleanly and stably as JSON, and you now own that as a **public contract** — versioning it becomes your problem forever.
4. Error semantics change. `AuraHandledException` is meaningless to an external client. You need HTTP status codes and a documented error body.
5. New tests. Apex REST tests need `RestRequest`/`RestResponse` construction; your existing controller tests do not cover the new surface.
6. **Security re-review is mandatory**, not optional. See §6.

**Estimating rule of thumb [inference]:** budget **0.5–1.5 days per method** for straightforward read methods with simple return types, and **2–4 days** for methods with complex DTOs, DML, or bulk semantics — inclusive of tests, security review, and API documentation. Multiply by the census count of distinct Apex methods, not the count of components.

### 2.3 `@InvocableMethod` + Invocable Actions REST API — the underrated option

REST API Developer Guide, *Invocable Actions Custom*: custom invocable actions are exposed at `/services/data/vXX/actions/custom/apex/{ActionName}` and are available in REST API v32.0 and later. `@InvocableMethod` requires a `public static` method.

**Why this is often the right answer for a migration:**
- It is **additive**, like `@AuraEnabled` was. You annotate the existing method. You do not design URLs, verbs, or a resource model.
- One endpoint shape for everything; your BFF can drive it generically from a registry, which means the codemod can emit call sites mechanically.
- It is a **documented, versioned, supported** API — everything the Aura endpoint is not.

**Constraints you must design around:**
- The invocable signature is **bulk-shaped**: `List<InputWrapper>` in, `List<OutputWrapper>` out. Every method needs input/output wrapper classes with `@InvocableVariable` fields. That is real but mechanical work, and mechanical work is codemod-able.
- Invocable variables support a restricted type set; deeply nested DTOs will not map cleanly and those methods should go to `@RestResource` instead.
- One `@InvocableMethod` per class.
- Semantics are "run an action," not "GET a resource" — everything is a POST. Caching is your BFF's problem.

**Recommendation:** triage the Apex census into (a) simple, wrapper-able → `@InvocableMethod`; (b) complex DTOs or genuine REST resource semantics → `@RestResource`; (c) pure record CRUD that never needed custom Apex → **delete the Apex call and use UI API instead.** Category (c) is usually larger than teams expect and is the single biggest cost saver available.

### 2.4 Standard REST / sObject / Query / Composite

Nothing to expose — these exist already. Key points:

- `/services/data/vXX/sobjects/{Object}/{Id}`, `/query?q=...`, describe resources.
- Runs **as the authenticated user**, so object perms, FLS, and sharing are enforced by the platform. This is the safe default.
- **Composite** (*REST API Developer Guide, Composite*): "Executes a series of REST API requests in a single POST request." Subrequests can chain — output of one feeds the next — and "the entire series counts as just one API call against your limits." This is the fix for the request-waterfall problem you will otherwise create when a component that used three `@wire`s becomes three round trips from ECS.
  - **[unverified]** The commonly cited limit is 25 subrequests per composite call; I did not re-confirm this against the doc in this pass. Confirm before designing around it.
- **Composite Graph** exists for larger dependent graphs with all-or-nothing semantics.

### 2.5 UI API — externally callable, and the key to your shim

**Yes, it is callable externally, and it is the intended use case.** UI API Developer Guide, *Get Started*:

> "Build Salesforce UI for native mobile apps and custom web apps using the same API that Salesforce uses to build Lightning Experience and Salesforce for Android, iOS, and mobile web."

> "You don't have to worry about layouts, picklists, field-level security, or sharing—all you have to do is build an app that users love."

> "Checks field-level security settings, sharing settings, and perms"

**Auth** (*Authentication, Versioning, Limits, ETag, and More*):

> "Like other Salesforce REST APIs, User Interface API uses OAuth 2.0."

and you "create an external client app in Salesforce."

**Versioning:** `GET https://MyDomainName.my.salesforce.com/services/data/v67.0/ui-api`

**Limits:** "The User Interface API uses the Salesforce API limits and the Connect REST API limits." Exceeding them returns **503 Service Unavailable** from all UI API resources.

**Why this is the most important finding for your shim:** your runtime shim mirrors UI API semantics — `getRecord`, RecordRepresentation, field-level `.value`/`.displayValue`. Off-platform, you are not *emulating* UI API, you are **calling the real thing**. The shim's data contract survives the platform move essentially intact. `@wire(getRecord, {recordId, fields})` becomes a BFF call to `/ui-api/records/{id}?fields=...` that returns the same RecordRepresentation your shim already understands. That is a large, unexpected win and it should change how you sequence the work: **UI-API-backed wires port cheaply; Apex-backed wires do not.** Split the census on that line.

**Constraints:**
- *Supported Objects*: "User Interface API supports all custom objects and external objects and many standard objects." **Many, not all.** List views and MRU support narrower subsets still. Check every object in your census against the *All Supported Objects* page — an unsupported object silently forces that component onto a different API and changes its port cost.
- ETag support exists and your BFF should use it for cache revalidation.
- UI API responses are **large** (layout + metadata + data). Over a WAN from ECS this is a real latency and egress cost, unlike in-org LDS. Cache aggressively in the BFF.

### 2.6 GraphQL API

*GraphQL API Developer Guide, What is GraphQL API?*: the schema provides "Concrete representations of your UI API Enabled sObjects" and queries "honor the object-level security and field-Level security of the context user. Therefore, two different users can have two different views of the GraphQL schema based on their access permissions." Available in Enterprise, Performance, Unlimited, and Developer Editions; adheres to the June 2018 GraphQL spec.

- **GA since Winter '23**; in 2026 it is a mature, externally available API at `/services/data/vXX/graphql`.
- **Mutations:** Beta in v59.0–v65.0, **GA in v66.0 and later** (per Salesforce release documentation surfaced in search; the guide's mutation section is current).
- It is in the **UI API family**, so it inherits the "UI API Enabled sObjects" restriction — same object-coverage caveat as §2.5.
- **Best use:** collapsing a screen that made five `@wire` calls into one round trip with exactly the fields you need. This is the strongest antidote to the latency regression that going off-platform otherwise causes.
- **Not** a route to Apex logic. Salesforce GraphQL does not expose Apex.

### 2.7 Connect REST API

`/services/data/vXX/connect/*`. Chatter feeds, files/content, Experience Cloud site features, notifications, managed topics. Runs as the context user with platform security enforced. Relevant only if your components use those features — check the census for `lightning-file-upload`, feed components, or `ConnectApi` usage in Apex. Note that UI API's limits are documented as shared with Connect REST API limits.

### 2.8 BFF on ECS

Not a Salesforce API — an architectural pattern, and the one this document recommends. Full treatment in §3 and §7.

---

## 3. AUTH — PRECISE, SECURITY-CRITICAL

### 3.1 Connected Apps are on the way out — use **External Client Apps**

This is a 2026 fact that will bite you if you follow older tutorials:

- **Spring '26 disabled creation of new Connected Apps by default** across orgs; creation requires Salesforce Support to re-enable it for the org.
- **External Client Apps (ECAs)** are the replacement, created in App Manager, secure-by-default, 2GP-packageable, with legacy flows restricted.
- The UI API guide already instructs you to "create an external client app in Salesforce."
- **Mandatory OAuth security requirements** apply to Connected Apps and ECAs as of **11 May 2026**, with enforcement reported from **25 Jun 2026**.

**Action:** provision an **External Client App**, not a Connected App. If your org still has Connected App creation enabled, do not use it for new work.

*(The Spring '26 Connected App changes and the May/June 2026 enforcement dates come from reputable secondary sources plus Salesforce Help article references; the Salesforce Help pages themselves would not render for direct quotation in this pass. **Confirm in Setup → Release Updates for your org before committing dates to a plan.**)*

### 3.2 Which OAuth flow for which caller

**(a) Browser SPA (React served from ECS, calling Salesforce directly) — NOT RECOMMENDED, see §3.3.**
If you were to do it: **Authorization Code + PKCE** is the only defensible choice. Salesforce supports PKCE on the web server flow — the connected app / ECA setting is **"Require Proof Key for Code Exchange (PKCE)"**, and Salesforce documents that "Client apps running in a browser using a scripting language such as JavaScript can also use this flow." Mobile SDK 11.0+ made Web Server Flow + PKCE the default, which tells you where Salesforce's own posture is.

- The public-client SPA must **not** have a client secret. In connected-app terms this means *not* requiring a secret for the web server flow.
- The IETF requirement is unambiguous: "Browser-based applications that are public clients **MUST** implement the Proof Key for Code Exchange (PKCE) extension when obtaining an access token" (*OAuth 2.0 for Browser-Based Applications*, §6.3.2.1).

**(b) BFF on ECS — RECOMMENDED.**
The BFF is a **confidential client**. Two sub-cases, and the choice matters:

- **User-context BFF (per-user identity preserved):** **Authorization Code + PKCE**, run by the BFF with a client secret, plus **Refresh Token** flow for session continuity. The browser gets an **HttpOnly, Secure, SameSite session cookie**; Salesforce tokens never leave ECS. **This is the recommended pattern**, because per-user tokens are what make platform-side FLS and sharing enforcement do the work for you (§6).
- **Service-context BFF (single integration identity):** **Client Credentials** flow (ECA configured to run as a designated integration user) or **JWT Bearer** flow (certificate-signed assertion, no stored password). Use only for genuinely user-agnostic work — background sync, metadata reads, health checks. **Do not use a service identity to serve user-specific data**, or you have moved the entire authorisation burden into your own code and become a confused deputy (§6.5).

**(c) Deprecated / retiring — do not build on these:**

| Flow | Status in 2026 |
|---|---|
| **Username-Password** | **Retiring.** Already blocked by default in new orgs since Spring '22. Full retirement enforces with **Winter '27**, rolling out by instance. Salesforce Help: *Retirement of OAuth 2.0 Username-Password Flow for Connected Apps (Release Update)*. Recommended replacements: **Client Credentials** or **JWT Bearer**, with the secret in a **Named Credential**. |
| **SOAP `login()`** | Retires **1 June 2027**. |
| **User-Agent / Implicit** | Legacy. Returns tokens in the URL fragment. Universally deprecated by OAuth BCP. Do not use. |

**Because Winter '27 rollout is by instance, your org's actual date is in Setup → Release Updates and on Salesforce Trust for your instance.** Get that date and put it on the programme risk register — if any part of the existing integration estate uses username-password, it dies during your migration window.

### 3.3 Is storing a Salesforce access token in the browser ever acceptable?

**Opinionated answer: No. Not for this application. Do not do it.**

The authoritative source is *OAuth 2.0 for Browser-Based Applications* (IETF OAuth WG, draft-ietf-oauth-browser-based-apps, currently in the RFC Editor queue with intended status **Best Current Practice**; latest revision fetched: **-27, July 2026**). Its architecture guidance:

- **BFF (§6.1)** — "The BFF interacts with the authorization server as a confidential OAuth client... manages OAuth access and refresh tokens... avoiding direct exposure of any tokens to the browser-based application." And the normative recommendation: **"This architecture is strongly recommended for business applications, sensitive applications, and applications that handle personal data."**
- **Token-Mediating Backend (§6.2)** — backend gets tokens, hands access tokens to the browser. "When considering a token-mediating backend architecture, it is strongly recommended to evaluate if adopting a full BFF... is a viable alternative."
- **Browser-based app as public client (§6.3)** — permitted, PKCE mandatory, but explicitly "vulnerable to all attack scenarios" in §5.1.

A Salesforce app is, by definition, "a business application that handles personal data." The spec's strong recommendation lands squarely on you.

**Concrete reasons in Salesforce terms:**
1. A Salesforce access token is a **session-equivalent bearer credential**. Anyone holding it acts as that user against *every* API the ECA is scoped for — not just the endpoints your UI happens to call. XSS anywhere in your React bundle, or in any transitive npm dependency, exfiltrates it.
2. `localStorage`/`sessionStorage` are readable by any script on the origin. In-memory-only is better but does not survive reload and still falls to a supply-chain compromise.
3. **Refresh tokens must never reach the browser.** Salesforce's default refresh token policy is *valid until revoked* — an exfiltrated refresh token is potentially **permanent** unauthorised access until a human notices and revokes it. This is the single worst outcome available in this design space.
4. A browser-held token forces you to open the org's CORS allowlist to your app origin (§4), widening the org's browser-reachable attack surface for every user.

**The recommended pattern, stated plainly:**

> React (browser) → HttpOnly/Secure/SameSite=Lax session cookie → **BFF on ECS** → OAuth tokens held server-side (encrypted, in AWS Secrets Manager / ElastiCache keyed by session) → Salesforce APIs.

The browser never sees a Salesforce token, never learns the org URL, and can only invoke the specific operations the BFF exposes. Add CSRF defence on the BFF (SameSite plus a double-submit or origin check), because you are now cookie-authenticated.

### 3.4 Session, refresh, lifetime, and mid-session expiry

- **Access token lifetime is the session timeout.** Salesforce Help, *Manage Session Policies for a Connected App*: you set when access tokens expire via the **Timeout Value** under Session Policies on the app; otherwise it inherits from the user's profile or the org's Session Settings. There is no independent "token TTL" dial — this surprises people from other IdPs.
- **Expired token behaviour:** the API returns `401` with `INVALID_SESSION_ID` — "Session expired or invalid."
- **Refresh Token Policy** on the app determines refresh validity. Default is **"Refresh token is valid until revoked"** — indefinite unless the user or an admin revokes it. Other options include expiry after N hours/days of inactivity, or immediate expiry.
- **Mid-session expiry handling in the BFF (design requirement, not optional):**
  1. Call Salesforce; on `401 INVALID_SESSION_ID`, do **not** propagate to the browser.
  2. Refresh using the stored refresh token; replay the original request **once**; return the result. The user sees nothing.
  3. If refresh fails (revoked, policy expiry, admin action, password change), invalidate the BFF session cookie and return a `401` with a distinct app-level code, e.g. `REAUTH_REQUIRED`.
  4. React handles exactly one condition — `REAUTH_REQUIRED` → redirect to the BFF's `/login`. **This is the whole benefit: one auth failure mode in the frontend instead of token lifecycle logic in every component.**
  - Serialise concurrent refreshes per session (single-flight/mutex) or a burst of parallel `@wire`-equivalent calls will trigger N simultaneous refreshes and can trip token-reuse protections.
- **Set an explicit, short-ish session timeout for the ECA** rather than inheriting a long org default, and set a **refresh token inactivity expiry** rather than "until revoked." Both are one-line config changes with outsized security value.
- Also plan for **`403 REQUEST_LIMIT_EXCEEDED`** (org API limits) and UI API's **`503`** — the BFF should have per-user rate limiting, backoff, and a cache, otherwise one React render loop burns the org's daily API allocation for everyone.

---

## 4. CORS — can the browser call Salesforce directly?

### 4.1 Yes, mechanically — with setup, and with real limits

Salesforce supports a **CORS allowlist**: Setup → Security → **CORS**, adding origins (the `CorsWhitelistEntry` object; origins are also manageable via Metadata API, so they belong in source control). If a browser makes a cross-origin request from an allowlisted origin, Salesforce returns that origin in `Access-Control-Allow-Origin` along with the other CORS headers. **If the origin is not allowlisted, Salesforce returns HTTP 403.**

**APIs covered by the CORS allowlist** (as documented in *Configure Salesforce CORS Allowlist*, which appears in the REST API, UI API, Bulk API, and Connect REST API guides):

- REST API
- **User Interface API** ← yes, UI API specifically is covered
- Apex REST
- Chatter REST API / Connect REST API
- Bulk API
- Analytics REST API
- Lightning Out
- (Salesforce IoT REST API, in older versions of the list)

*(Direct rendering of the `extend_code_cors.htm` doc page failed repeatedly in this pass — the list above is reconstructed from search-surfaced quotations of those Salesforce doc pages. The dedicated UI API page `uiapi/extend_code_cors.htm` exists, which independently confirms UI API coverage. **Re-verify the exact current list in the doc before treating it as a design constraint.**)*

### 4.2 The limits that matter

1. **CORS does not authenticate anything.** You must still send `Authorization: Bearer <token>` on every request. The allowlist only decides whether the browser is *permitted* to read the response.
2. **OAuth endpoints are not covered.** CORS "does not support requests for unauthenticated resources, including OAuth endpoints." Consequence: **the browser cannot complete the token exchange itself.** Any browser-direct design still needs a server component for the code-for-token exchange — which is most of the argument for the BFF already, so you get the BFF's downsides without its benefits.
3. **Origin-level granularity only.** Allowlisting `https://app.example.com` opens *every* CORS-supported API to script on that origin, scoped only by the user's token. You cannot allowlist "UI API only."
4. **It is an org-wide security setting** requiring admin change management, per environment (dev/UAT/prod all differ), and it is a standing widening of the org's browser attack surface.
5. Preflight `OPTIONS` on every non-simple request adds a round trip; from a browser to a Salesforce pod this is a measurable latency tax on top of the WAN hop you already added by leaving the platform.

### 4.3 Recommendation

**Do not use the CORS allowlist as your primary data path.** Route through the BFF: same-origin (or ECS/ALB-controlled origin) calls from React, server-to-server from ECS to Salesforce, **no CORS involvement at all**, no org-wide setting, no token in the browser.

Keep CORS allowlisting in your pocket for narrow cases — e.g. direct-to-Salesforce file upload/download to avoid streaming large blobs through the BFF, or a Lightning Out 2.0 host page. Even then, allowlist the minimum set of origins and review it quarterly.

### 4.4 CSP and other Salesforce-side restrictions on external origins

- **Your CSP is now yours.** Off-platform you are no longer under Lightning Locker/Lightning Web Security or the platform's CSP. That is freedom and it is also a new obligation: you must author a real CSP for the ECS-served app. If you ever put a Salesforce token in the browser, a strict CSP (`script-src` without `unsafe-inline`, nonce-based) becomes a *load-bearing* control rather than a nice-to-have. With the BFF, it is defence in depth.
- **Salesforce-side CSP still applies to embedded content.** Lightning Out 2.0 renders in an iframe; framing behaviour, `frame-ancestors`, and clickjacking protection settings in Session Settings govern what can embed what. If you use Lightning Out 2.0 or any framed Salesforce content, expect to configure trusted domains for inline frames.
- **Experience Cloud CSP/Trusted Sites** matter only if any part of this stays in a site.
- **My Domain is mandatory** and all API traffic goes to `https://MyDomainName.my.salesforce.com`. Do not hardcode instance URLs — take the `instance_url` from the token response, because it changes on org migration/refresh.

---

## 5. LATENCY AND REQUEST-SHAPE (a consequence people forget)

On-platform, LDS deduplicated, cached, and batched every `@wire`. Off-platform, each becomes an HTTPS call across the internet with an OAuth-authenticated hop and org API limits behind it.

Mitigations, in order of value:
1. **BFF-side caching** with UI API **ETag** revalidation and short TTLs, keyed **per user** (never share cached records across users — see §6.5).
2. **Composite / Composite Graph** to fold a component's several calls into one.
3. **GraphQL** for over-fetching-heavy screens.
4. A **client-side cache in React** (TanStack Query or equivalent) to restore the request-deduplication behaviour teams unconsciously depended on in LDS. This is not optional polish; without it, an app that felt fine on-platform will feel broken.
5. **Watch org API limits.** Every call now counts. LDS calls did not, in the same way. Model expected daily call volume against the org's allocation *before* go-live — this has killed off-platform projects at UAT.

---

## 6. FLS AND SHARING — THE SECURITY GATE (census gate C-4)

### 6.1 What you lose

On-platform, LWC + LDS gave you enforcement for free: UI API checked FLS, sharing, and object perms on every record read/write, and returned only what the user could see. Off-platform, **nothing is automatic**. Enforcement depends entirely on *which API you call* and *how the Apex behind it was written*.

### 6.2 APIs that DO preserve FLS and sharing

These run **as the authenticated user** and the platform enforces object permissions, FLS, and record sharing:

- **UI API** — "Checks field-level security settings, sharing settings, and perms." Strongest option; also filters layout/picklist metadata by access.
- **GraphQL API** — "honor[s] the object-level security and field-Level security of the context user," and the *schema itself* differs per user by access.
- **REST API sObject / Query / Composite** — enforced.
- **Connect REST API** — enforced.

**Precondition for all of these: the token must carry the end user's identity.** A client-credentials/JWT service identity destroys this guarantee (§6.5).

### 6.3 The API that does NOT preserve them by default: Apex

This is where a migration becomes a breach. **And the rules changed in Summer '26.**

Apex Developer Guide, *Enforce Object and Field Permissions* / *Set an Access Mode for Database Operations*:

> "In API version 67.0 and later, Apex runs in user context by default, meaning that the current user's permissions and field-level security (FLS) are enforced during code execution."

> In API version 66.0 and earlier, system mode is the default.

And for Apex REST specifically, *Exposing Data with Apex REST Web Service Methods*:

> "Custom Apex REST web service methods run in user mode by default."
> "In user mode, the current user's object permissions, field-level security, and sharing rules are enforced."

**Read the version gate carefully, because it is the whole risk:**

- The new secure-by-default behaviour is **tied to the API version of the Apex class**.
- **[inference — the docs state the version-gated default but I found no statement that it applies retroactively]** Your existing controllers, compiled at API v58/v61/v64/whatever, **almost certainly still run in system mode**, ignoring FLS and object permissions, and default to their declared sharing (or `without sharing` inheritance) for record access.
- So: a `@AuraEnabled` method written years ago, which was *safe enough* because it was only reachable by an authenticated user inside a locked-down Lightning page with a known record context, becomes an **internet-reachable endpoint returning system-mode data** the moment you re-expose it via `@RestResource` or `@InvocableMethod` without review.

Additional v67.0 changes reported for Summer '26 (**secondary sources — verify against the official Apex release notes before relying on them**): Apex classes without an explicit sharing declaration default to **`with sharing`**, and **`WITH SECURITY_ENFORCED` is removed** in favour of `WITH USER_MODE`.

Enforcement mechanisms available to you:
- `WITH USER_MODE` / `WITH SYSTEM_MODE` on SOQL/SOSL
- `insert as user` / `as system` on DML
- `Database.insert(records, AccessLevel.USER_MODE)` etc.
- `Security.stripInaccessible(...)`
- `Schema.DescribeSObjectResult` / `DescribeFieldResult` explicit checks
- Class-level `with sharing` / `inherited sharing`

### 6.4 Gate C-4 — concrete, blocking checklist

**No Apex method may be exposed to the off-platform app until every line below is satisfied and signed off.** Record the result per method in the census.

For each Apex method being re-exposed:

1. **API version recorded.** What API version is the class at? If **< 67.0**, assume **system mode** and treat every query and DML as unenforced until proven otherwise.
2. **Sharing declared explicitly.** Class must declare `with sharing` or `inherited sharing`. `without sharing` requires a written, named-approver justification in the census row. Never inherit by accident.
3. **FLS enforced explicitly.** Every SOQL uses `WITH USER_MODE`; every DML uses `as user` or `AccessLevel.USER_MODE`; or results pass through `stripInaccessible`. Do **not** rely on the v67 default unless the class has actually been recompiled at v67+ and tested.
4. **Parameters treated as hostile.** Per Salesforce's own guidance for `@AuraEnabled`, "every method that is annotated @AuraEnabled should be treated as a web service interface" and you should "assume that an attacker can call this method with any parameter." That guidance was already true; off-platform it is *literally* true. Validate every input. Bind, never concatenate, in dynamic SOQL. Never accept an object/field name from the client without allowlisting it.
5. **No implicit context.** Any method that assumed a record context supplied by the Lightning page must now authorise the passed `recordId` itself. **This is the most common IDOR in re-exposed Apex** — the component only ever passed a record the user could already see, so the method never checked. Now the client controls the ID.
6. **Negative tests exist.** A test that runs as a **low-privilege user** and asserts that restricted fields are absent and restricted records are inaccessible. A passing test as a sysadmin proves nothing.
7. **Scope minimised on the ECA.** Grant the narrowest OAuth scopes that work. `full` is not an answer.
8. **BFF exposes an allowlist, not a proxy.** The BFF must expose *named operations* mapped to specific Apex actions/endpoints. **It must never be a generic pass-through** that lets the browser name an arbitrary Apex class, SOQL string, or endpoint path — that hands an attacker the entire org API through your credentials.
9. **User-context tokens confirmed** for every user-data path (see §6.5).
10. **Per-user cache keys confirmed.** Any BFF cache must be keyed by user identity. A shared cache leaks one user's sharing-filtered results to another and silently defeats every platform control above.

### 6.5 The confused-deputy trap — say this out loud in the design review

If the BFF authenticates with **client credentials** or **JWT bearer** as a single integration user, then:

- Salesforce enforces FLS and sharing **for the integration user**, not the end user.
- If that integration user is powerful (and it usually is, because otherwise things break), **every end user effectively gets that user's access**.
- **You have moved the entire authorisation model out of Salesforce and into your own React/BFF code**, where a missing `if` becomes a data breach and where none of Salesforce's controls, audit trail, or admin tooling helps you.

**Rule: user-facing data paths use per-user OAuth tokens. Service identities are for background, non-user-specific work only.** If someone proposes a single integration user "to keep it simple," that is the moment to escalate — it converts a UI migration into a bespoke authorisation system that must be maintained forever.

---

## 7. RECOMMENDED ARCHITECTURE

### 7.1 Diagram

```
                        BROWSER (user's machine)
        ┌───────────────────────────────────────────────────┐
        │  React SPA (static assets from CloudFront/S3      │
        │  or served by the ECS task)                       │
        │                                                   │
        │   • NO Salesforce access token                    │
        │   • NO refresh token                              │
        │   • NO org / instance URL                         │
        │   • Holds ONLY: HttpOnly, Secure, SameSite        │
        │     session cookie issued by the BFF              │
        │   • Strict CSP; TanStack Query for dedupe/cache   │
        └───────────────────────┬───────────────────────────┘
                                │  same-origin HTTPS
                                │  (cookie + CSRF token)
                                │  /api/* only
                                ▼
        ┌───────────────────────────────────────────────────┐
        │  ALB  ──►  BFF on AWS ECS (confidential client)   │
        │                                                   │
        │  Auth:                                            │
        │   • /login  → Authorization Code + PKCE           │
        │              (External Client App, w/ secret)     │
        │   • token + refresh token stored SERVER-SIDE,     │
        │     encrypted, keyed by session id                │
        │     (ElastiCache/DynamoDB + KMS; client secret    │
        │     in AWS Secrets Manager)                       │
        │   • 401 INVALID_SESSION_ID → silent refresh →     │
        │     replay once → else REAUTH_REQUIRED            │
        │   • single-flight refresh per session             │
        │                                                   │
        │  API surface: ALLOWLISTED NAMED OPERATIONS ONLY   │
        │   (never a generic Salesforce proxy)              │
        │                                                   │
        │  Per-user cache (ETag-aware) + rate limiting      │
        │  + request collapsing via Composite               │
        └───────────────────────┬───────────────────────────┘
                                │  server-to-server HTTPS
                                │  Authorization: Bearer <per-user token>
                                │  NO CORS INVOLVED
                                ▼
        ┌───────────────────────────────────────────────────┐
        │   Salesforce org  (https://<mydomain>.my.salesforce.com)
        │                                                   │
        │  PREFERRED (platform enforces FLS + sharing):     │
        │   /services/data/v67.0/ui-api/*      ← shim maps  │
        │       records/{id}, object-info, layout,          │
        │       picklist-values  (getRecord semantics)      │
        │   /services/data/v67.0/graphql       ← batch reads│
        │   /services/data/v67.0/composite     ← fan-in     │
        │   /services/data/v67.0/sobjects/*    ← plain CRUD │
        │                                                   │
        │  APEX LOGIC (must pass gate C-4 first):           │
        │   /services/data/v67.0/actions/custom/apex/{Name} │
        │        ← @InvocableMethod   (low-cost default)    │
        │   /services/apexrest/{path}                       │
        │        ← @RestResource      (designed contracts)  │
        │                                                   │
        │  BRIDGE for deferred components:                  │
        │   Lightning Out 2.0 (iframe + closed shadow DOM,  │
        │   frontdoor-url session) — keeps @AuraEnabled     │
        │   working, at the cost of staying on-platform     │
        └───────────────────────────────────────────────────┘

   ✗ NOT USED: browser → Salesforce direct (CORS allowlist)
   ✗ PROHIBITED: /aura or /s/sfsites/aura endpoint scraping
   ✗ PROHIBITED: username-password flow (retires Winter '27)
   ✗ PROHIBITED: single integration user for user-facing data
```

### 7.2 Data-path decision rule (put this in the codemod's triage logic)

```
For each server interaction found in the census:

  is it @wire(getRecord / getObjectInfo / getPicklistValues / getListUi ...)?
      → map DIRECTLY to UI API. Shim contract is preserved. LOW COST.
      → but first: is the sObject "UI API Enabled"? If not, fall through.

  is it @wire(apexMethod) or imperative Apex, but the Apex only does
  plain record CRUD / a simple query?
      → DELETE the Apex. Use UI API / REST / GraphQL. LOW COST + security win.
      → expect this bucket to be larger than the team assumes.

  is it Apex with real business logic, simple-ish parameters and returns?
      → @InvocableMethod + Actions REST API. MEDIUM COST. Gate C-4.

  is it Apex with complex DTOs, or needs true REST resource semantics?
      → @RestResource. HIGH COST. Gate C-4.

  is it Apex that is huge, gnarly, low-value, or high-risk to touch?
      → defer the whole component; embed via Lightning Out 2.0. NO APEX CHANGE.
```

### 7.3 Non-negotiables

1. External Client App, not Connected App.
2. Authorization Code + PKCE, confidential client, tokens server-side only.
3. BFF exposes named operations; never a generic proxy.
4. Per-user tokens for all user-facing data.
5. Gate C-4 signed off per Apex method before exposure.
6. Explicit session timeout and refresh-token inactivity expiry on the ECA.
7. Per-user cache keys, always.

---

## 8. WHAT THIS ADDS TO A PROJECT THAT ONLY PLANNED TO CONVERT UI COMPONENTS

Blunt list. None of this is in a "convert LWC to React" estimate.

**New engineering workstreams**
1. **An Apex re-exposure workstream.** Every `@wire(apexMethod)` and every imperative Apex import needs a new supported endpoint. Sized by *distinct Apex methods*, not components. `@InvocableMethod` wrappers, or `@RestResource` classes, plus new Apex tests for the new surface.
2. **A new backend service (the BFF) that did not exist.** Container, ALB, health checks, deploys, logging, tracing, alerting, on-call. This is a permanent operational asset with a permanent owner.
3. **A full OAuth implementation.** Authorization Code + PKCE, callback handling, encrypted server-side token store, single-flight refresh, session cookies, CSRF defence, logout and revocation.
4. **A caching and request-batching layer.** LDS did this for free. Composite/GraphQL orchestration plus per-user BFF cache plus client-side query cache — otherwise the app is visibly slower than the one you replaced.
5. **API limit engineering.** Volume modelling, per-user rate limiting, backoff for `403 REQUEST_LIMIT_EXCEEDED` and UI API `503`. Previously not your problem.

**New security work**
6. **Gate C-4 security review of every exposed Apex method** — sharing declaration, FLS enforcement, parameter validation, and IDOR review on every `recordId` that used to arrive implicitly from the page. Plus negative tests as a low-privilege user.
7. **A remediation backlog for legacy Apex** that was safe-by-context and is not safe-by-contract. Assume classes below API v67.0 run in system mode.
8. **Threat modelling and pen test** of an internet-facing app holding org credentials. Almost certainly a new compliance requirement.
9. **Secrets management** (client secret, encryption keys) in AWS, with rotation.
10. **CSP authoring and maintenance** for a surface the platform used to police.

**New platform/config work**
11. **External Client App provisioning per environment**, with the May/June 2026 mandatory OAuth security controls satisfied, and scope minimisation.
12. **Session and refresh-token policy configuration** and its change management.
13. **Object-coverage audit against "UI API Enabled" objects.** Any object outside the list forces a different API and re-costs that component.
14. **Migration off username-password flow anywhere in the estate** before your org's Winter '27 date.

**New product/UX work**
15. **A re-authentication UX.** Sessions now expire visibly. Design it, or users lose work.
16. **A degraded/offline story** for API-limit and 503 conditions the platform used to hide.

**Ongoing cost**
17. **Salesforce release-cadence regression testing** three times a year against API version bumps — you now consume versioned APIs from outside and own the upgrade.
18. **Permanent ownership of an authorisation-sensitive backend.** The security surface does not go away after go-live.

**Rough shape [inference]:** for a codebase where a meaningful share of components are Apex-backed, the off-platform data-access programme is plausibly **comparable in size to the UI conversion itself**, and it is on the critical path — no converted component works without it. Sequence the BFF and the first Apex re-exposures *ahead of* bulk component conversion, or you will have a pile of React that cannot load data.

---

## 9. WHAT I COULD NOT VERIFY (be honest about these)

1. **Whether Lightning Out 2.0-embedded LWCs can call `@AuraEnabled` Apex.** Strongly implied (it is the real LWC runtime with a real session) but not stated in the docs I could fetch. **Spike it.**
2. **The exact current CORS-supported API list.** `extend_code_cors.htm` would not render in any of its four guide locations; the list in §4.1 is reconstructed from search-surfaced quotations of those pages. UI API coverage is independently corroborated by the existence of a UI-API-specific CORS page. **Re-verify.**
3. **Whether the v67.0 user-mode default applies retroactively to classes compiled at earlier API versions.** The docs state the version-gated default only. I have assumed **not retroactive**, which is the security-conservative reading. **Confirm before relying on it either way.**
4. **`WITH SECURITY_ENFORCED` removal and `with sharing` default in v67.0** — secondary sources only. **Confirm in the official Apex release notes.**
5. **Composite subrequest limit (commonly cited as 25).** Not re-confirmed in this pass.
6. **Exact Connected App retirement / ECA mandate dates (Spring '26 creation block; 11 May 2026 requirements; 25 Jun 2026 enforcement).** Salesforce Help pages would not render for direct quotation; dates come from reputable secondary sources. **Confirm in Setup → Release Updates for your org.**
7. **Your org's specific Winter '27 username-password enforcement date** — instance-specific, only obtainable from your org's Release Updates and Salesforce Trust.

---

## 10. SOURCES

Fetched and quoted:

- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_annotation_AuraEnabled.htm — AuraEnabled Annotation (Apex Developer Guide)
- https://developer.salesforce.com/docs/atlas.en-us.lightning.meta/lightning/controllers_server_apex_auraenabled_annotation.htm — AuraEnabled Annotation (Lightning Aura Components Developer Guide)
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_rest.htm — Exposing Apex Classes as REST Web Services
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_rest_intro.htm — Introduction to Apex REST (auth mechanisms, governor limits)
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_rest_exposing_data.htm — Exposing Data with Apex REST Web Service Methods (user mode by default; v67.0 change)
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_perms_enforcing.htm — Enforce Object and Field Permissions (v67.0 user-context default)
- https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm — Set an Access Mode for Database Operations
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_get_started.htm — UI API Get Started (FLS/sharing/perms enforcement)
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_get_started_intro.htm — UI API Authentication, Versioning, Limits, ETag (OAuth 2.0, external client app, v67.0, 503)
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/ui_api_get_started_supported_objects.htm — UI API Supported Objects
- https://developer.salesforce.com/docs/platform/graphql/guide/intro-graphql-api.html — GraphQL API (UI API family; OLS/FLS honoured; editions)
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_composite.htm — Composite resource
- https://developer.salesforce.com/docs/atlas.en-us.lightning.meta/lightning/lightning_out.htm — Lightning Out (Beta)
- https://developer.salesforce.com/docs/platform/lwc/guide/lightning-out-intro.html — Lightning Out 2.0 (GA; iframe + shadow DOM; replaces beta)
- https://developer.salesforce.com/blogs/2025/10/lightning-out-2-0-is-now-generally-available-in-winter-26 — Lightning Out 2.0 GA announcement (frontdoor-url; limitations)
- https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps — OAuth 2.0 for Browser-Based Applications (draft -27, July 2026; BFF strongly recommended; PKCE MUST)
- https://appomni.com/ao-labs/lightning-components-a-treatise-on-apex-security-from-an-external-perspective/ — AppOmni Labs, Aura endpoint invocation of @AuraEnabled Apex (evidence for the "reachable but unsupported" nuance)
- https://www.softwareinsights.dev/posts/salesforce-oauth-username-password-flow-retirement-winter-27/ — username-password retirement (Winter '27; SOAP login() 1 Jun 2027)

Referenced via search results but **not directly rendered** (see §9):

- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/extend_code_cors.htm — Configure Salesforce CORS Allowlist (REST API guide)
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/extend_code_cors.htm — Configure Salesforce CORS Allowlist (UI API guide)
- https://developer.salesforce.com/docs/atlas.en-us.chatterapi.meta/chatterapi/intro_cors.htm — Perform Cross-Origin Requests from Web Browsers (Connect REST API guide)
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_corswhitelistentry.htm — CorsWhitelistEntry
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_actions_invocable_custom.htm — Invocable Actions Custom
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_oauth_and_connected_apps.htm — Authorization Through External Client Apps or Connected Apps and OAuth 2.0
- https://help.salesforce.com/s/articleView?id=release-notes.rn_security_unpw_flow_retirement.htm — Retirement of OAuth 2.0 Username-Password Flow (Release Update)
- https://help.salesforce.com/s/articleView?id=release-notes.rn_apex_default_user_mode.htm — Database Operations Run in User Mode by Default, Not System Mode
- https://help.salesforce.com/s/articleView?id=xcloud.connected_app_manage_session_policies.htm — Manage Session Policies for a Connected App
- https://help.salesforce.com/s/articleView?id=sf.connected_app_manage_oauth.htm — Manage OAuth Access Policies for a Connected App
- https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-useragent-flow.html — Mobile SDK OAuth (Web Server Flow + PKCE default from 11.0)
- https://www.salesforce.com/blog/summer-26-release-architect-highlights/ — Summer '26 architect highlights (403 on fetch; v67.0 Apex security changes)
- https://www.salesforceben.com/external-client-vs-connected-apps-comparing-salesforces-next-gen-integration/ — External Client Apps vs Connected Apps
- https://aquivalabs.com/blog/mandatory-security-requirements-for-connected-apps-and-external-client-apps-required-by-may-11-2026/ — May/June 2026 mandatory OAuth controls
