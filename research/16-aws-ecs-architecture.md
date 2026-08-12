# 16 — AWS ECS Deployment Architecture for a React App Consuming Salesforce Data

**Context:** Migrating Salesforce LWC components to React. Target is an existing React app on AWS ECS.
The React side uses a runtime shim `@migration/salesforce-runtime` built on TanStack Query with a
pluggable `transport`. This document decides what `transport` should be in an ECS topology, and what
the surrounding architecture must provide.

**Date:** 12 Aug 2026
**Verification convention:** claims sourced from a fetched URL are unmarked. Reasoning that follows
from those facts but was not directly stated in a source is marked **[inference]**. Where a 2026
number could not be verified, it says so explicitly instead of guessing.

---

## 0. TL;DR — The Recommendation

**Build option (b): React SPA served as static assets, plus a BFF container on ECS that holds all
Salesforce credentials and proxies every Salesforce call.**

The `transport` in `@migration/salesforce-runtime` becomes **an HTTP client that talks only to your
own BFF origin, using an HttpOnly session cookie, and never sees a Salesforce token.** It does not
know Salesforce exists. That is the whole point.

The three decisive facts:

1. Salesforce's browser-direct path (option a) cannot be made credential-safe. CORS explicitly does
   not cover the OAuth endpoints, so the browser can never legitimately obtain a token without a
   server anyway — you end up building a server regardless, just a worse one.
2. Salesforce API limits are a **hard org-wide quota**, not per-user and not per-IP. Enterprise
   Edition starts at 100,000 calls per 24 hours plus per-license increments. Browser-direct means
   every user's every render burns org quota with no chokepoint to defend it. A BFF is the only
   place a server-side cache can exist.
3. SSR (option c) solves credentials too, but buys rendering complexity the migration does not need
   and does not solve the quota problem any better than a BFF does.

---

## 1. SPA vs BFF vs SSR on ECS — The Core Decision

### 1.1 Option (a): Static React on S3/CloudFront calling Salesforce directly from the browser

**Verdict: reject.**

| Axis | Assessment |
|---|---|
| Credential safety | **Fatal.** A public SPA cannot hold a client secret or a JWT signing key. Anything shipped to the browser is public. |
| CORS | Salesforce supports a CORS allowlist for its APIs, but **CORS does not support requests for unauthenticated resources, including the OAuth endpoints.** You must pass an OAuth token with requests that require it. |
| Token refresh | The browser cannot mint the first token (see above). Even with PKCE + a user-context login, you are storing access tokens in `localStorage` (XSS-exfiltratable) or in memory (lost on refresh). |
| Latency | Best case — one hop, browser straight to Salesforce edge. This is its only genuine advantage. |
| Caching | Client-only. No shared cache. N users viewing the same Account = N API calls. |
| Cost | Cheapest infrastructure, most expensive Salesforce quota consumption. |
| Ops complexity | Lowest infra, highest security review burden. |

The CORS point is the one that ends the argument. The Salesforce guidance is explicit that CORS
excludes unauthenticated resources including OAuth endpoints, so the token acquisition step can
never happen in the browser against a confidential client. Teams that push through this end up
either embedding a secret (unacceptable) or standing up a token-minting server — at which point they
have built a worse BFF with the security properties of neither.

There is a second, subtler failure: **[inference]** with browser-direct calls, every component that
the LWC migration produces makes its own Salesforce call from its own user's browser. LWC's
`@wire` adapters were backed by Salesforce's own server-side Lightning Data Service cache, which did
*not* consume the org's REST API quota the way an external REST client does. Moving those same
components to browser-direct REST is a quota profile change of potentially one to two orders of
magnitude, and there is no chokepoint at which to notice or throttle it.

### 1.2 Option (b): React + BFF container on ECS — **RECOMMENDED**

| Axis | Assessment |
|---|---|
| Credential safety | **Best.** The BFF is a confidential OAuth client. It holds the client secret / JWT private key. Tokens never reach the browser. Prevailing guidance is that all tokens should be kept out of the browser to prevent theft and exfiltration, using a BFF, with cookies that are HttpOnly, SameSite, and tightly scoped. |
| CORS | **Eliminated as a problem.** The browser only ever calls your own origin. No Salesforce CORS allowlist entry needed at all. |
| Token refresh | Entirely server-side and invisible to React. With JWT bearer flow there is no refresh token to manage — you just re-mint (see §2.3). |
| Latency | One extra hop (browser → ALB → BFF → Salesforce). **[inference]** Typically +5–20 ms of intra-AWS overhead, which is dominated by the 100–400 ms Salesforce API call itself, and is *net negative* (faster) whenever the BFF cache hits. |
| Caching | **Decisive advantage.** A shared server-side cache is only possible here. See §5. |
| Cost | One more ECS service. At Fargate 2026 rates a 0.5 vCPU / 1 GB task is roughly $17.87/month running 24/7; 1 vCPU / 2 GB roughly $35.74/month. Two tasks for HA is well under $100/month — trivially less than buying additional Salesforce API capacity. |
| Ops complexity | Moderate. You already run ECS, so this is an additional service, not a new platform. |

**Critical implementation warning:** a reverse proxy that forwards an `Authorization` header
containing a bearer token from the browser **is not a BFF** — the token is still reachable by the
browser and you have added a network hop with none of the security benefit. The defining
characteristic of a real BFF is that it acts as a confidential OAuth client, holds the client
secret, and performs the token exchange itself. Do not let this degrade into a dumb proxy.

### 1.3 Option (c): SSR React (Next.js / Remix) on ECS

**Verdict: viable, but not chosen.**

SSR does solve credential safety — the server component fetch runs on the ECS task and can hold
secrets, so on the security axis it ties with the BFF. It also improves first-paint for data-heavy
pages. But:

- **The migration argues against it.** LWC components map naturally to client-side React components
  with a data hook. Introducing a server/client component boundary means every migrated component
  must be classified, and `@migration/salesforce-runtime`'s TanStack Query surface has to work in
  both worlds (`useSuspenseQuery`, hydration boundaries, prefetch-on-server). That is migration
  scope the team did not ask for.
- **It does not solve the quota problem for free.** SSR moves the call server-side but still issues
  one Salesforce call per render unless you *also* add a server-side cache — i.e. you build the BFF
  cache anyway, just inside the SSR process.
- **Operationally heavier on ECS.** SSR tasks are CPU-bound on rendering, so they scale on a
  different signal than an I/O-bound BFF and are more expensive per request. **[inference]**

**When to revisit:** if SEO or cold first-paint on public-facing pages becomes a hard requirement.
The recommended architecture below does not preclude it — the BFF stays useful under an SSR
frontend, because the SSR server should call the BFF rather than Salesforce directly, preserving the
single cache and single credential holder.

### 1.4 Defence of the recommendation

The BFF wins because it is the **only option that puts a chokepoint between an unbounded number of
React components and a bounded, org-wide, non-renewable resource.** Salesforce's daily API limit is
a soft limit that tolerates temporary overage, but persistent overage triggers a hard protection
limit that returns **HTTP 403 `REQUEST_LIMIT_EXCEEDED`** — and that failure is org-wide, meaning your
React migration can take down unrelated integrations and internal Salesforce users. That is a blast
radius that justifies a service you have to operate.

Credential safety is the headline reason, but quota control is the reason that survives contact with
production.

---

## 2. Secrets and Credentials on ECS

### 2.1 Where secrets live

Both AWS Secrets Manager and SSM Parameter Store are managed key-value stores that encrypt with KMS
and both integrate natively with ECS task definitions. AWS's own guidance: **Secrets Manager
additionally provides automatic rotation, random secret generation, and cross-account sharing — use
it when you want those; otherwise use encrypted Parameter Store parameters.**

Recommended split for this workload:

| Item | Store | Why |
|---|---|---|
| Salesforce connected-app **client secret** | Secrets Manager | Rotatable, high value |
| Salesforce **JWT private key** (RSA, for JWT bearer flow) | Secrets Manager | Highest-value item in the system |
| Session **cookie signing/encryption key** | Secrets Manager | Rotatable, compromise = session forgery |
| Salesforce **login URL**, API version, connected-app **client ID (consumer key)** | Parameter Store (String) | Not secret, changes rarely, cheaper |
| Cache TTLs, feature flags | Parameter Store | Config, not secrets |

### 2.2 How they reach the container — and the anti-patterns

**Correct:** use the `secrets` container-definition parameter with `valueFrom` pointing at a Secrets
Manager ARN or SSM parameter. The **task execution role** (not the task role) needs
`secretsmanager:GetSecretValue` and `ssm:GetParameters` — this is the single most common
misconfiguration, because people attach the permission to the task role and the task fails to start.

**Anti-pattern 1 — plaintext in `environment`.** Values placed in the `environment` block of a task
definition are stored in the task definition itself and are readable by anyone with
`ecs:DescribeTaskDefinition` and visible in the console. AWS explicitly warns of "an elevated risk of
data leakage with environment variables," noting values can leak in logs and be revealed by
`docker inspect`.

**Anti-pattern 2 — baked into the image.** A secret in a Docker layer is permanent (layers are
immutable and readable by anyone who can pull the image) and is replicated into ECR, into every
cache, and into any downstream registry. Never `COPY` a `.env` or a `.pem` into an image, and never
pass one via `--build-arg` (build args are recorded in image history).

**Anti-pattern 3 — a long-lived Salesforce username/password + security token.** This is not
rotatable in any automated way and ties your integration's fate to a human user record.

**Higher-assurance alternatives AWS recommends**, if `secrets`-as-env-var is judged insufficient:

- Store the secret in an **encrypted S3 bucket** and read it at runtime under a task role. This
  "prevents the values of environment variables from inadvertently leaking in logs and getting
  revealed when running `docker inspect`."
- **Sidecar-to-volume:** a sidecar reads from Secrets Manager, writes to a shared volume, and exits
  before the app container starts (via ECS container ordering); the app reads the file. The volume
  is scoped to the task and deleted when the task stops. On Fargate, volume storage is automatically
  encrypted with a service-managed key.

**[inference]** For the JWT private key specifically, prefer the sidecar-to-volume or
fetch-at-runtime-via-SDK approach over `secrets`-as-env-var. A PEM in an environment variable is
exactly the kind of value that ends up in a crash dump or an error-reporting payload.

### 2.3 Rotation — the ECS gotcha

**ECS injects secrets at task startup only.** AWS states this plainly: "If your secret changes, you
must force a new deployment or launch a new task to retrieve the latest secret value." Rotating a
secret in Secrets Manager **does not update running containers** — the running container still holds
the old value.

Consequences and the fix:

- Wire the Secrets Manager rotation event (EventBridge on rotation success) to an automation that
  calls `UpdateService --force-new-deployment`. Without this, rotation silently does nothing until
  your next deploy, and you get an outage at an unpredictable later time when the old credential is
  finally invalidated. **[inference]**
- **Or** — preferred for this workload — **have the BFF read the secret at runtime via the AWS SDK
  using the task role, with a short in-process TTL** (e.g. re-read every 5–15 minutes, plus an
  immediate re-read on any Salesforce 401). This makes rotation a non-event and removes the forced
  redeploy entirely. It also keeps the secret out of the process environment. **[inference]**

**Salesforce-side rotation specifics:** the JWT bearer flow signs with an X509 certificate's private
key and the connected app verifies with the matching certificate; Salesforce only supports the Java
Keystore (JKS) format for importing private key pairs into an org. Certificate rotation therefore
requires a coordinated two-step: upload the new certificate to the connected app, deploy the BFF
with the new key, then retire the old. **[inference]** Plan for an overlap window — treat this as a
scheduled change, not an automated one, because the Salesforce side is not API-rotatable in the way
Secrets Manager is.

### 2.4 IAM roles — the two-role rule

| Role | Used by | Grants needed here |
|---|---|---|
| **Task execution role** | The ECS agent, before your container runs | `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`, `logs:CreateLogStream`/`PutLogEvents`, and `secretsmanager:GetSecretValue` / `ssm:GetParameters` for `valueFrom` resolution |
| **Task role** | Your application code, at runtime | Runtime AWS access: Secrets Manager reads if fetching at runtime (§2.3), ElastiCache/DynamoDB for the cache, `xray:PutTraceSegments` |

Scope both with resource-level ARNs. Do not grant `secretsmanager:GetSecretValue` on `*`.

---

## 3. ECS Specifics (2026)

### 3.1 Fargate vs EC2

**Recommendation: Fargate.**

2026 Fargate pricing is **$0.04048 per vCPU-hour and $0.004445 per GB-hour**, making a 1 vCPU / 2 GB
task about **$35.74/month** at 24/7 and a 0.5 vCPU / 1 GB task about **$17.87/month**. EC2 launch
type is commonly cited as 50–70% cheaper at steady state, because you pay for instances regardless
of task count and can apply Reserved Instances or Savings Plans. The crossover rule of thumb: if you
keep instances 70–85% full around the clock, EC2 wins per unit of work; Fargate wins for bursty,
variable task counts.

For a BFF fronting Salesforce, Fargate is right because:

- The workload is **I/O-bound and bursty** — it tracks human working hours, which is precisely the
  Fargate-favourable shape. **[inference]**
- The absolute numbers are small. Even 4 tasks at 1 vCPU / 2 GB is ~$143/month. Optimising this is
  not worth the operational cost of managing an EC2 capacity provider. **[inference]**
- No host to patch, which materially reduces the attack surface of the one container in your estate
  that holds Salesforce credentials. **[inference]**

**Revisit if** sustained task count exceeds roughly 10–15 always-on tasks. **[inference]** Also
consider **Graviton/ARM64** Fargate for the price/performance improvement — **[inference]** verify
the current ARM64 Fargate discount against the AWS Fargate pricing page before budgeting; the exact
2026 ARM64 differential was not verified for this document.

### 3.2 Container image — multi-stage Dockerfile for a Vite React app

Two separable questions: how to build, and what serves the static assets.

**nginx vs `node serve`:** **use nginx** (or, in the recommended architecture, let the BFF's own
static middleware serve them — see §3.3). nginx is a purpose-built static file server with correct
caching headers, gzip/brotli, and a tiny memory footprint; `serve`/`http-server` are development
conveniences that carry a full Node runtime and its CVE surface to serve files off disk.
**[inference]** The one thing nginx must be configured for that catches people out is the SPA
history fallback (`try_files ... /index.html`).

```dockerfile
# ---------- Stage 1: build the Vite SPA ----------
FROM public.ecr.aws/docker/library/node:22-alpine AS spa-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# NOTE: only VITE_-prefixed vars are inlined into the bundle, and they are PUBLIC.
# Never pass a Salesforce secret here — it would be baked into the JS.
ARG VITE_API_BASE_URL=/api
RUN npm run build            # -> /app/dist

# ---------- Stage 2: build the BFF ----------
FROM public.ecr.aws/docker/library/node:22-alpine AS bff-build
WORKDIR /bff
COPY bff/package.json bff/package-lock.json ./
RUN npm ci
COPY bff/ .
RUN npm run build && npm prune --omit=dev

# ---------- Stage 3: runtime ----------
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /srv
COPY --from=bff-build /bff/node_modules ./node_modules
COPY --from=bff-build /bff/dist         ./dist
COPY --from=spa-build /app/dist         ./public
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /srv
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
```

Key points: no secret is ever `COPY`d or passed as `ARG`; the final stage carries no build
toolchain; the container runs as a non-root user. **[inference]** If you prefer nginx for statics,
split into two containers in the same task definition (nginx + BFF) rather than putting nginx in
front of the BFF in a separate service — keeps the hop count down.

### 3.3 Serving statics: CloudFront vs from the BFF task

**Recommended: CloudFront in front, with two origins.**

- `/` and `/assets/*` → **S3 origin** (the built Vite output), cached aggressively. Vite emits
  content-hashed filenames, so `/assets/*` can be `Cache-Control: public, max-age=31536000, immutable`
  and `index.html` must be `no-cache`. **[inference]**
- `/api/*` → **ALB origin** (the BFF), cache disabled or very short, with cookies and the relevant
  headers forwarded.

**Why single-origin matters:** serving the SPA and the API under **one public origin** means the
session cookie is first-party and `SameSite=Strict` is achievable, and there is no browser CORS
preflight on your own API. **[inference]** This is a real simplification, not just aesthetics — it
is the reason the `transport` needs no CORS handling at all.

The simpler variant (statics served by the BFF task itself, per the Dockerfile above) is fine for
internal apps and keeps deployment atomic — SPA and BFF version-lock together, which eliminates a
whole class of "new JS calling old API" bugs. **[inference]** Choose it if the app is internal;
choose CloudFront+S3 if asset traffic is significant or users are geographically dispersed.

### 3.4 ALB routing and health checks

- One ALB, HTTPS listener (ACM cert), HTTP→HTTPS redirect.
- Path rule `/api/*` → BFF target group (`target-type: ip` for Fargate).
- **Health check must be a dedicated liveness endpoint, not `/`.** Use `/healthz` returning 200 with
  no dependency checks. **Do not make the health check call Salesforce** — a Salesforce outage or a
  quota exhaustion would then fail health checks, kill every task, and turn a degraded-read incident
  into a total outage. **[inference]** Expose Salesforce reachability on a separate `/readyz` that
  monitoring scrapes but the ALB does not.
- Set **deregistration delay** to slightly above your p99 Salesforce call latency (e.g. 30 s) so
  in-flight proxied requests drain rather than being cut. **[inference]**
- ALB idle timeout must exceed your BFF's upstream timeout to Salesforce. Note Salesforce's own
  timeout for REST/SOAP calls (other than queries) is **10 minutes** — you should *not* wait that
  long; set an aggressive BFF-side timeout (e.g. 10–15 s) and fail fast. **[inference]**

### 3.5 Deployments

**The 2026 answer is different from the 2023 answer.** In **July 2025 ECS launched built-in
blue/green deployments**, with deployment lifecycle hooks that let you test new versions in
production, a configurable **bake time** after traffic shifts, and rollback without downtime if a
regression is detected. It integrates with **CloudWatch Alarms and the ECS deployment circuit
breaker** for automatic failure detection, and works with ALB, NLB, or ECS Service Connect. In
**October 2025** ECS added **canary and linear** strategies, reaching feature parity with CodeDeploy.

**Recommendation:** use **ECS native blue/green**, not CodeDeploy. CodeDeploy remains supported and
is the right answer only if you have existing CodeDeploy tooling to preserve. The native path removes
a whole service from the architecture.

Use a lifecycle hook to run a **post-deploy smoke test that performs one real authenticated
Salesforce call** through the green tasks before shifting traffic. This is the single highest-value
hook for this system — it catches expired certificates, rotated secrets that didn't propagate, and
IP-allowlist regressions before any user sees them. **[inference]**

**Gotcha:** the `ALBRequestCountPerTarget` metric for target-tracking scaling policies is **not
supported for the blue/green deployment type.** If you adopt blue/green you must scale on CPU or
memory, or use step scaling on a custom metric. Plan for this — it directly contradicts the "scale
web services on request count" default advice below.

### 3.6 Autoscaling signals

Available target-tracking metrics are `ECSServiceAverageCPUUtilization`,
`ECSServiceAverageMemoryUtilization`, and `ALBRequestCountPerTarget`. For request-driven APIs,
`ALBRequestCountPerTarget` is generally preferred because it responds to load before CPU saturates;
CPU is the safer default for compute-bound services; memory should only be used when the service is
known to be memory-bound, and then paired with another policy so the service can still scale in.

Practical settings: CPU target ~50% (80% leaves too little headroom because new tasks are not ready
by the time CPU spikes), scale-out cooldown ~60 s, scale-in cooldown ~300 s, and conservative
scale-in.

**For this BFF specifically:** it is I/O-bound waiting on Salesforce, so **CPU is a poor proxy for
load** — the service can be saturated on in-flight requests at 20% CPU. **[inference]** Given the
blue/green restriction above, the right answer is a **custom CloudWatch metric of in-flight upstream
requests (or Salesforce call latency p95) with a step-scaling policy**, rather than target-tracking
on CPU. **[inference]**

**Do not autoscale aggressively on Salesforce latency alone** — if Salesforce is slow, adding tasks
adds concurrent load to Salesforce and makes it worse. Cap `maxCapacity` deliberately, and remember
the concurrency ceiling in §5.2. **[inference]**

---

## 4. Networking and Egress

### 4.1 Topology

BFF tasks run in **private subnets**. Egress to Salesforce (public internet) goes via **NAT
Gateway** in public subnets. ALB sits in public subnets.

### 4.2 NAT Gateway cost

2026 pricing: **$0.045 per NAT gateway-hour** (~$32.40/month per gateway) plus **$0.045 per GB**
data processing, applied to all traffic in both directions regardless of destination. For
internet-bound traffic you also pay standard egress (~$0.09/GB), giving a frequently-cited **true
cost of ~$0.135/GB**. Rates vary by region — US East is the cheapest baseline and Asia Pacific /
South America can be 2× or more.

**[inference]** For a Salesforce BFF this is unlikely to dominate. JSON API responses are small; even
100 GB/month of Salesforce traffic is ~$13.50 in data charges. The **fixed** cost matters more:
running NAT gateways in 3 AZs for HA is ~$97/month before a byte moves. For a non-latency-critical
internal app, **one NAT gateway in one AZ** is a defensible cost/availability tradeoff — but it
makes that AZ a single point of failure for all Salesforce connectivity, so decide explicitly rather
than by default.

**The real NAT cost risk is not Salesforce traffic** — it is AWS API traffic (ECR image pulls,
Secrets Manager, CloudWatch Logs) being routed through NAT. Which leads to:

### 4.3 VPC endpoints

**Add VPC endpoints for the AWS services the task uses**, which keeps that traffic off the NAT
gateway entirely:

- `com.amazonaws.<region>.ecr.api` and `.ecr.dkr` (interface) — image pulls
- `com.amazonaws.<region>.s3` (**gateway** endpoint, free) — ECR layers live in S3, and this is
  where most image-pull bytes actually go
- `com.amazonaws.<region>.secretsmanager` (interface)
- `com.amazonaws.<region>.logs` (interface)
- `com.amazonaws.<region>.ssm` (interface) if using Parameter Store or ECS Exec

**[inference]** Interface endpoints have their own hourly + per-GB charge, so this is a
cost-optimisation with a crossover point, not a free win — but the S3 gateway endpoint is free and
should always be present. The security argument is independent and stronger: secrets retrieval
should not traverse a NAT gateway to a public endpoint.

**There is no VPC endpoint for Salesforce.** Salesforce API traffic must go via NAT (or via an
egress proxy / Transit Gateway with a centralised NAT, if the org has one). **[inference]**

### 4.4 Salesforce IP allowlisting

Salesforce restricts by IP in three separate places, and they behave differently:

1. **Org-wide Network Access (Trusted IP Ranges)** — Setup → Network Access. IPs here are trusted for
   all users; logins from outside may face additional verification challenges rather than outright
   denial.
2. **Profile-level Login IP Ranges** — restricts which IPs users (and API integrations running as
   those users) can log in from. This is the *hard* block.
3. **Connected app IP relaxation** — a connected app set to **"Enforce IP restrictions"** can only
   make API calls from IPs in the org's Trusted IP Ranges; set to **"Relax IP restrictions"**, any IP
   is allowed.

**What this means for ECS:** serverless and NAT-based integrations often lack a predictable source
IP, so you must pin one. **Allocate Elastic IPs to your NAT gateways** and give the Salesforce admin
that fixed set. Then:

- Add the EIPs to the org's Trusted IP Ranges and/or the integration user's profile Login IP Ranges.
- Set the connected app to **Enforce IP restrictions**. **[inference]** This is the correct posture:
  it means a stolen client secret is useless from outside your VPC, which is a genuine second factor
  on the credential and directly compensates for the risk in §2.
- **Document the EIPs as production-critical.** They must not be released, and adding an AZ later
  means a new EIP and a Salesforce change request. **[inference]** This is a common outage cause —
  a NAT gateway recreated by Terraform without a pinned EIP silently breaks all Salesforce calls.

### 4.5 Do Salesforce rate limits apply per-IP when many tasks share a NAT?

**No — and this matters, in both directions.**

The Salesforce API limits documentation specifies limits per org (24-hour request allocation) and
concurrency limits for long-running requests, and **does not specify any per-user or per-IP limits**
for the platform API request allocation.

So:

- **Good news:** many ECS tasks sharing one NAT IP will not trip a per-IP throttle for the daily
  request allocation, because there isn't one. Horizontal scaling of the BFF does not create an
  artificial IP-level bottleneck for that limit.
- **Bad news, and it is the more important half:** because the quota is **org-wide**, adding tasks
  does not add capacity. Ten BFF tasks share exactly the same 24-hour allocation as one. Scaling out
  makes you exhaust the org quota *faster*, not serve more users. **[inference]** The only lever that
  actually adds capacity is caching and call-coalescing (§5).
- **Caveat:** whether Salesforce applies undocumented edge-level or WAF-level per-IP protections
  distinct from the published API limits **could not be verified** from public documentation. Treat
  "no per-IP limit" as true for the documented request allocation, and do not design a system that
  depends on unbounded per-IP request rates. **[inference]**

---

## 5. Caching and API Limits

### 5.1 The 2026 limits (verified)

**Total API requests per 24 hours** (rolling window, not calendar day — older calls drop out of the
window as time passes):

| Edition | Allocation |
|---|---|
| Developer Edition | **15,000** total calls / 24 h |
| **Enterprise** and Professional (with API access) | **100,000** base **+ per-license**: 1,000 per Salesforce license; 1,000 per Salesforce Platform license; 200 per Lightning Platform – One App license |
| **Unlimited / Performance** | **100,000** base **+** 5,000 per Salesforce license; 5,000 per Salesforce Platform license; 5,000 per Lightning Platform Plus member |
| Full Sandbox | **5,000,000** total calls / 24 h |
| External Identity add-ons (Enterprise/Prof.) | 70,000 per 25k license; 750,000 per 250k license; 4,000,000 per 1M license |

Worked example: an Enterprise org with 50 Salesforce licenses gets 100,000 + 50,000 = **150,000
calls / 24 h**.

**Concurrent long-running requests** (requests running 20 seconds or longer):

| Org type | Limit |
|---|---|
| Developer Edition and Trial orgs | **5** concurrent |
| Production orgs and Sandboxes | **25** concurrent |

**Other verified limits:** REST/SOAP call timeout is **10 minutes** (except queries); combined
request header + URI size max **16,384 bytes**.

**Enforcement:** the daily limit is a **soft limit** — temporary overage is tolerated and requests
continue processing if safe. Persistent overage triggers a **hard protection limit returning HTTP
403 with `REQUEST_LIMIT_EXCEEDED`**. Additional calls can be purchased in increments from 200 to
10,000 daily.

**Monitoring:** Salesforce exposes usage via (a) the **`Sforce-Limit-Info` response header** on REST
and SOAP calls, showing current usage and limit; (b) the **`/services/data/vXX.0/limits`** REST
endpoint returning max and remaining allocations; (c) Setup → Company Information ("API Requests,
Last 24") and System Overview; (d) configurable email notifications at **50%, 80%, 90%** thresholds.

**Not verified:** a per-org limit on *concurrent* short requests (under 20 s), and any Bulk API 2.0
daily batch limits for 2026. Do not assume numbers for these — check the current
`salesforce_app_limits_cheatsheet` before relying on them.

### 5.2 What the BFF must do

**(1) Read the `Sforce-Limit-Info` header on every response and export it as a metric.** This is
non-negotiable and cheap: parse it, emit a CloudWatch metric of percent-consumed, and alarm at 60%
/ 80%. Quota exhaustion must never be a surprise. **[inference]**

**(2) Shared server-side cache — this is the entire justification for the BFF.** With a per-browser
cache only, N users viewing the same record cost N calls; with a shared cache they cost 1.
**[inference]** Use **ElastiCache (Valkey/Redis)** rather than in-process memory, because in-process
caching gives you a hit rate that degrades linearly with task count and evaporates on every deploy.

Suggested TTL tiers **[inference]**:

| Data class | Example | TTL |
|---|---|---|
| Metadata / describe | `sobjects/Account/describe`, picklist values, record types | 1–24 h |
| Reference data | Products, price books, config objects | 15–60 min |
| Transactional reads | Account, Contact, Opportunity records | 30–120 s |
| User-specific | Current user context, permissions | Session lifetime |
| Writes | — | Never cached; invalidate related keys on success |

**Object describes are the biggest easy win.** LWC's `@wire(getObjectInfo)` / `getPicklistValues`
patterns are extremely common and the underlying data changes on the order of *deployments*, not
seconds. Caching these for hours converts a large fraction of migrated-component traffic to zero
API calls. **[inference]**

**(3) Request coalescing (single-flight).** Cache TTL alone does not prevent a thundering herd: when
a hot key expires, every concurrent request misses simultaneously and all of them call Salesforce.
The BFF must ensure that **at most one upstream call per cache key is in flight**, with the others
awaiting its result. **[inference]** This is what protects the 25-concurrent-long-running-request
ceiling, which is a much lower and much easier ceiling to hit than 100,000/day.

**(4) Batch with Composite / sObject Collections.** An entire composite call counts as **1 API call**
against daily limits, and sObject Collections likewise reduce round-trips with the whole request
counting as a single call. Constraints: Composite API caps at **25 subrequests** (max 5
queries/collections); sObject Collections support up to **200 records**. Governor limits (100 SOQL,
150 DML, 10,000 ms CPU) apply **cumulatively across all subrequests**, and exceeding any one aborts
the entire request.

**[inference]** This is the highest-leverage optimisation available and it maps beautifully onto the
LWC migration: a page that had 6 `@wire` adapters becomes 6 React hooks issuing 6 BFF calls, which
the BFF batches into **1** Salesforce call. Implement a short (5–20 ms) collection window in the BFF
that gathers concurrent per-request reads and flushes them as one composite call. Combined with
caching this is plausibly a 10–20× reduction versus browser-direct. Note the cumulative-governor
caveat: do not batch blindly, and keep a fallback to individual calls when a composite request is
rejected.

**(5) Circuit breaker on quota.** When consumed quota crosses a threshold (say 90%), the BFF should
degrade deliberately — serve stale cache, reject low-priority background refreshes, and surface a
clear "data may be stale" signal — rather than letting the org hit `REQUEST_LIMIT_EXCEEDED` and
breaking unrelated integrations. **[inference]**

### 5.3 Where TanStack Query helps, and where it cannot

**TanStack Query genuinely provides**, in the browser:

- **Automatic deduplication** — concurrent requests for the same query key are deduplicated into one
  network request.
- **`staleTime`** — the period data is considered fresh, suppressing refetch; this directly controls
  the number of network requests.
- **`gcTime`** (renamed from `cacheTime` in v4) — how long inactive cache data is held in memory.
- Background refetch, retry, and error recovery.

**What it cannot do, structurally:**

| Limitation | Consequence |
|---|---|
| Cache is **per browser tab** | 500 users viewing the same dashboard = 500 cache misses = 500 upstream calls |
| Cache **dies on hard refresh / tab close** | Every session start is a cold cache |
| **No cross-user visibility** | Cannot coalesce across users; cannot enforce an org-wide budget |
| **Cannot enforce a global limit** | Nothing client-side can stop the 100,000th call |
| Deduplication is **per QueryClient instance** | Scope is one tab, not the fleet |

**Therefore: two-layer caching is mandatory, and the layers do different jobs.**

- **TanStack Query (client)** optimises *this user's* experience: instant back-navigation, no
  refetch-on-remount, snappy interactions. It reduces BFF load.
- **BFF cache (server)** optimises *the org's quota*: cross-user reuse, coalescing, batching, and a
  hard budget. It reduces Salesforce load.

Configure them coherently **[inference]**: set client `staleTime` at or below the server TTL for the
same resource, so the client does not serve data older than the server considers valid. For
long-TTL metadata (describes, picklists), set a long client `staleTime` too (e.g. 1 h) — there is no
reason to even hit the BFF. Set `gcTime` above `staleTime` so navigating away and back is free.

### 5.4 What the `transport` interface must implement

Given this topology, the `transport` in `@migration/salesforce-runtime` is **a same-origin HTTP
client to the BFF**. It must:

**Must do:**

1. **Call only your own origin** — `/api/sf/*`. It must never hold a Salesforce URL, instance URL,
   client ID, or token. Types should not even model a token.
2. **Send `credentials: 'same-origin'`** so the HttpOnly session cookie travels. No `Authorization`
   header is ever set by the client.
3. **Handle 401 as "session expired"** — trigger a re-login redirect to the BFF's login route. It
   must **not** attempt any token refresh; refresh is the BFF's job and is invisible here.
4. **Propagate a correlation ID** — generate or forward `traceparent` (W3C) on every request so
   browser → BFF → Salesforce is one trace (§6).
5. **Surface `Retry-After` and quota-pressure signals** — when the BFF returns 429 or a
   degraded/stale marker, the transport must expose that to TanStack Query so it can back off rather
   than hammer. Map BFF quota-circuit-breaker responses to a distinct error type the UI can render
   as "showing cached data."
6. **Support request batching hints** — expose an optional batch/collection API so multiple hooks
   mounting in the same tick can be flushed to one BFF call, feeding the BFF's composite batching
   (§5.2.4). **[inference]** This is where the LWC-to-React `@wire` fan-out is tamed.
7. **Carry an abort signal** from TanStack Query through to `fetch`, so unmounted components stop
   consuming BFF (and therefore Salesforce) capacity.
8. **Normalise errors** into a stable shape (`{ kind, message, sfErrorCode?, correlationId }`) so
   migrated LWC error-handling paths map cleanly, and so `sfErrorCode` is available for
   `REQUEST_LIMIT_EXCEEDED` special-casing.

**Must NOT do:**

- Hold, store, read, or refresh any Salesforce token.
- Know the Salesforce instance URL or API version.
- Perform SOQL string construction client-side — the BFF should expose intent-shaped endpoints
  (`GET /api/sf/record/:type/:id`, `POST /api/sf/query/:namedQuery`) so that arbitrary SOQL cannot be
  injected from the browser. **[inference]** Passing raw SOQL through a BFF re-creates the security
  hole the BFF exists to close.
- Retry aggressively on 5xx without jitter — a coordinated retry storm across users can exhaust
  quota faster than the original load.

**[inference]** The clean consequence: `transport` becomes trivially mockable in tests (it is just
`fetch` to your own API), and swapping it for a direct-to-Salesforce implementation during local
development against a scratch org remains possible without any component changes. That is the payoff
of making it pluggable.

---

## 6. Observability

### 6.1 Tracing React → BFF → Salesforce

Use **OpenTelemetry**, exported via an **ADOT (AWS Distro for OpenTelemetry) Collector**, which on
ECS runs either as a **sidecar container in the task** or as a standalone service in the cluster.

**The propagation gotcha:** AWS X-Ray uses its own trace header format (`X-Amzn-Trace-Id`), while
OpenTelemetry uses **W3C Trace Context** (`traceparent` / `tracestate`). To have instrumentation
continue traces rather than start new ones, you must configure propagation explicitly. For
JavaScript specifically, to send trace data to X-Ray via the ADOT Collector you must configure the
**X-Ray ID generator, the X-Ray propagator, and the collector gRPC exporter** on the global tracer
provider. Note also that OTel trace IDs are 32 hex chars (128 bits) while X-Ray trace IDs embed a
32-bit timestamp plus 96 bits of random data — hence the custom ID generator.

**Recommended span structure [inference]:**

```
[browser] page interaction
  └─ [browser] http GET /api/sf/record/Account/001xx
       └─ [bff] handler: getAccount            (attrs: cache.hit, sf.object=Account)
            ├─ [bff] cache.get (valkey)
            └─ [bff] salesforce.request        (attrs: sf.api=composite,
                                                sf.subrequests=4, sf.api_version=v6x.0,
                                                sf.limit.pct_used=41,
                                                http.status_code, sf.error_code)
```

Instrument the browser with OTel web (fetch instrumentation auto-injects `traceparent`), and ensure
the ALB and BFF do not strip that header. **[inference]** The single most valuable span attribute is
`cache.hit` — it turns "is our caching working" from a debate into a dashboard.

### 6.2 Correlating Salesforce errors

**[inference]** Build correlation on three keys:

1. **`traceparent` / trace ID** — end-to-end, browser to Salesforce call.
2. **Salesforce error code** (`errorCode` in the REST error body, e.g. `REQUEST_LIMIT_EXCEEDED`,
   `INVALID_SESSION_ID`, `MALFORMED_QUERY`) — log as a structured, low-cardinality field so you can
   alarm per code. `INVALID_SESSION_ID` spiking means your token/credential path is broken;
   `REQUEST_LIMIT_EXCEEDED` means quota.
3. **Salesforce API request identifier** — where Salesforce returns a request/tracking id on a
   response, capture it verbatim; it is what Salesforce Support will ask for. The exact 2026 header
   name **could not be verified** for this document — inspect a live response and confirm before
   building parsing around a specific name.

Also log the parsed `Sforce-Limit-Info` values alongside every Salesforce span so that when an
incident happens you can see quota state at the moment of failure, not just at scrape time.

### 6.3 What to log — and what must never be logged

**Log (structured JSON to CloudWatch Logs):**

- Trace/span IDs, correlation ID
- Route, HTTP method, status code, duration
- `cache.hit` / `cache.miss`, cache key **shape** (e.g. `account:{id}`) — not necessarily the value
- Salesforce object type, operation, API resource, subrequest count
- Salesforce `errorCode` and `message` (see caveat below)
- Quota percent consumed from `Sforce-Limit-Info`
- A **user identifier that is opaque** — an internal user ID or hashed subject, not an email

**NEVER log:**

| Item | Why |
|---|---|
| Access tokens, refresh tokens, JWT assertions, session IDs | Log access = full impersonation. Note `INVALID_SESSION_ID` error paths are exactly where people accidentally log the session. |
| Client secret, JWT private key, cookie signing key | Obvious, but check error/crash handlers — these dump `process.env`. |
| Full `Authorization` / `Cookie` headers | Redact at the logging middleware, allowlist headers rather than denylist. |
| Salesforce **record field values** | Contacts, Leads, Cases and Opportunities are PII/commercially sensitive by default. Log record *IDs* and object *types*, never `Contact.Email` or `Case.Description`. |
| Full SOQL query text with literal values | `WHERE Email = 'x@y.com'` is PII in a log line. Log the named query and a parameter *hash*. |
| Full Salesforce response bodies | The most common accidental PII leak — a "debug" logger left on. |
| Salesforce error `message` **unfiltered** | Salesforce error messages sometimes echo the offending field value. Allowlist `errorCode`; treat `message` as potentially tainted and either redact or restrict to non-production. **[inference]** |

**[inference]** Enforce this mechanically, not by convention: a serialiser with a redaction
allowlist, plus a CI check that fails on raw `console.log(response)` in the Salesforce client module.
Set CloudWatch log group retention deliberately (e.g. 30 days for app logs) — indefinite retention of
logs that may contain incidental PII is a compliance liability. Consider CloudWatch Logs data
protection policies to auto-mask detected PII patterns as a backstop.

---

## 7. The Recommended Architecture

### 7.1 Diagram

```
                                  ┌──────────────────────────────────────┐
                                  │             Browser                  │
                                  │  React SPA (migrated LWC components) │
                                  │  @migration/salesforce-runtime       │
                                  │    └─ TanStack Query (client cache)  │
                                  │         └─ transport = fetch()       │
                                  │              same-origin, HttpOnly   │
                                  │              cookie, traceparent     │
                                  └──────────────┬───────────────────────┘
                                                 │ HTTPS  (NO Salesforce token, ever)
                                  ┌──────────────▼───────────────────────┐
                                  │            CloudFront                │
                                  │  /assets/* → S3 (immutable, 1y)      │
                                  │  /index.html → S3 (no-cache)         │
                                  │  /api/*      → ALB (no cache)        │
                                  └──────┬────────────────────┬──────────┘
                                         │                    │
                              ┌──────────▼─────┐    ┌─────────▼──────────────┐
                              │  S3 (Vite dist)│    │  ALB (public subnets)  │
                              │  static assets │    │  HTTPS, ACM cert       │
                              └────────────────┘    │  /api/* → BFF TG (ip)  │
                                                    │  hc: /healthz          │
                                                    └─────────┬──────────────┘
     ══════════════════════════════════════════════════════════│═══ VPC ═══════════
                                                    ┌──────────▼──────────────────┐
                                                    │ ECS Service: sf-bff         │
                                                    │ Fargate · private subnets   │
                                                    │ ECS native blue/green       │
                                                    │ ┌─────────────────────────┐ │
                                                    │ │ container: bff (Node)   │ │
                                                    │ │  · confidential OAuth   │ │
                                                    │ │    client (JWT bearer)  │ │
                                                    │ │  · session cookie mgmt  │ │
                                                    │ │  · single-flight coalesce││
                                                    │ │  · composite batching   │ │
                                                    │ │  · quota circuit breaker│ │
                                                    │ ├─────────────────────────┤ │
                                                    │ │ sidecar: aws-otel-      │ │
                                                    │ │          collector      │ │
                                                    │ └─────────────────────────┘ │
                                                    │ taskRole / execRole (split) │
                                                    └───┬──────────┬──────────┬───┘
                                      ┌─────────────────┘          │          └──────────────┐
                            ┌─────────▼──────────┐    ┌────────────▼─────────┐   ┌───────────▼────────┐
                            │ ElastiCache        │    │ VPC Endpoints        │   │ NAT Gateway        │
                            │ (Valkey/Redis)     │    │ secretsmanager, logs │   │ + pinned Elastic IP│
                            │ shared cache,      │    │ ecr.api/dkr, s3(gw)  │   │ (allowlisted in SF)│
                            │ single-flight locks│    │ → keeps AWS traffic  │   └───────────┬────────┘
                            └────────────────────┘    │   off the NAT        │               │
                                                      └──────────────────────┘               │
                            ┌────────────────────┐                                           │
                            │ Secrets Manager    │◄── runtime fetch (task role, short TTL)    │
                            │ · SF client secret │                                           │
                            │ · JWT private key  │                     ═══════════════════════│═══ internet
                            │ · cookie sign key  │                                ┌───────────▼────────┐
                            └────────────────────┘                                │    Salesforce      │
                                                                                  │ · REST / Composite │
                            ┌────────────────────┐                                │ · Connected App    │
                            │ CloudWatch + X-Ray │                                │   ENFORCE IP restr.│
                            │ traces, quota metric│                               │ · org quota        │
                            └────────────────────┘                                └────────────────────┘
```

**Trust boundary:** the Salesforce credential never crosses left of the ECS service box. The browser
holds only an opaque, HttpOnly, SameSite session cookie scoped to your own origin.

### 7.2 Task definition sketch

```jsonc
{
  "family": "sf-bff",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "runtimePlatform": { "cpuArchitecture": "ARM64", "operatingSystemFamily": "LINUX" },

  // Two distinct roles — the #1 source of "task won't start" bugs.
  "executionRoleArn": "arn:aws:iam::<acct>:role/sf-bff-exec",   // pulls image, resolves valueFrom, writes logs
  "taskRoleArn":      "arn:aws:iam::<acct>:role/sf-bff-task",   // app runtime: secrets fetch, elasticache, xray

  "containerDefinitions": [
    {
      "name": "bff",
      "image": "<acct>.dkr.ecr.<region>.amazonaws.com/sf-bff:<immutable-sha>",
      "essential": true,
      "portMappings": [{ "containerPort": 8080, "protocol": "tcp", "name": "http" }],

      // Non-secret config ONLY. Anything here is readable via DescribeTaskDefinition
      // and visible in the console. No credentials.
      "environment": [
        { "name": "NODE_ENV",            "value": "production" },
        { "name": "SF_LOGIN_URL",        "value": "https://login.salesforce.com" },
        { "name": "SF_API_VERSION",      "value": "v64.0" },   // verify current version
        { "name": "CACHE_TTL_DESCRIBE",  "value": "3600" },
        { "name": "CACHE_TTL_RECORD",    "value": "60" },
        { "name": "SF_QUOTA_BREAK_PCT",  "value": "90" },
        { "name": "OTEL_EXPORTER_OTLP_ENDPOINT", "value": "http://localhost:4317" },
        { "name": "OTEL_SERVICE_NAME",   "value": "sf-bff" },
        { "name": "OTEL_PROPAGATORS",    "value": "tracecontext,xray" }
      ],

      // Injected at task START ONLY. Rotation does NOT reach a running container —
      // see §2.3. Prefer runtime SDK fetch for SF_JWT_PRIVATE_KEY.
      "secrets": [
        { "name": "SF_CLIENT_ID",     "valueFrom": "arn:aws:ssm:<region>:<acct>:parameter/sf-bff/client-id" },
        { "name": "SF_CLIENT_SECRET", "valueFrom": "arn:aws:secretsmanager:<region>:<acct>:secret:sf-bff/client-secret" },
        { "name": "SESSION_SIGN_KEY", "valueFrom": "arn:aws:secretsmanager:<region>:<acct>:secret:sf-bff/session-key" }
        // SF_JWT_PRIVATE_KEY: intentionally absent — fetched at runtime via task role
        // so rotation needs no redeploy and the PEM never sits in the environment.
      ],

      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
        "interval": 30, "timeout": 5, "retries": 3, "startPeriod": 20
      },

      "readonlyRootFilesystem": true,
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sf-bff",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "bff"
        }
      },
      "dependsOn": [{ "containerName": "aws-otel-collector", "condition": "START" }]
    },
    {
      "name": "aws-otel-collector",
      "image": "public.ecr.aws/aws-observability/aws-otel-collector:latest",
      "essential": false,
      "command": ["--config=/etc/ecs/ecs-default-config.yaml"],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/sf-bff-otel",
          "awslogs-region": "<region>",
          "awslogs-stream-prefix": "otel"
        }
      }
    }
  ]
}
```

**[inference]** `SF_API_VERSION` is shown as a placeholder — confirm the current GA API version at
build time rather than trusting a value in a document. Pin the image by immutable digest/SHA, never
`:latest`, so blue/green rollback is deterministic.

### 7.3 Implementation order

1. **Stand up the BFF with JWT bearer auth and a single passthrough endpoint.** Prove the credential
   path, the NAT EIP allowlist, and the connected-app IP enforcement end to end. Everything else is
   worthless until this is solid.
2. **Add the session cookie layer** and confirm no token reaches the browser (verify in devtools).
3. **Implement `transport`** against this minimal BFF; migrate one LWC component as a vertical slice.
4. **Add `Sforce-Limit-Info` parsing + CloudWatch metric + alarms.** Do this *before* scaling
   migration, so you have a quota baseline from real traffic.
5. **Add ElastiCache + TTL tiers + single-flight.** Measure the change in quota consumption.
6. **Add composite batching.** Measure again.
7. **Then** migrate components in bulk.

Steps 4–6 before bulk migration is the important sequencing claim: quota problems discovered after
80 components are migrated are far more expensive to fix than the architecture that prevents them.
**[inference]**

---

## 8. Open Items to Verify Before Building

These could not be confirmed from public documentation and should be checked against a live org or
the current AWS console rather than assumed:

- Salesforce **concurrent request limit for short (<20 s) requests**, if any distinct from the
  documented 25 concurrent long-running requests.
- **Bulk API 2.0** daily batch/record limits for 2026.
- The exact **Salesforce request-tracking response header name** for support correlation (§6.2).
- Whether Salesforce applies **undocumented edge/WAF per-IP throttles** distinct from the published
  API request allocation (§4.5).
- Current **ARM64/Graviton Fargate price differential** (§3.1).
- Current **GA Salesforce API version** for `SF_API_VERSION`.
- Whether your org's edition/licence mix yields the allocation you assume — read
  `/services/data/vXX.0/limits` on the actual org rather than computing it from the table.

---

## Sources

All URLs below were fetched or returned as search results during this research.

**Salesforce — API limits and monitoring**
- https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm
- https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage
- https://help.salesforce.com/s/articleView?id=002888831&language=en_US&type=1
- https://forcenaut.com/blog/salesforce-api-limits-guide/
- https://blog.coupler.io/salesforce-api-limits/
- https://coefficient.io/salesforce-api/salesforce-api-rate-limits
- https://www.stacksync.com/blog/bypass-salesforce-api-limits-real-time-bi-directional-sync

**Salesforce — Composite API / batching**
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_sobjects_collections.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/requests_composite_batch.htm
- https://www.apexhours.com/salesforce-composite-resources/
- https://thesalesforcedev.in/2025/10/26/understanding-salesforce-composite-api-a-complete-guide-with-examples/
- https://knowledgelib.io/business/erp-integration/salesforce-composite-api-capabilities/2026

**Salesforce — CORS**
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/extend_code_cors.htm *(fetched; page is JS-rendered and returned only navigation — CORS facts cited come from the search-result summaries below)*
- https://developer.salesforce.com/docs/atlas.en-us.chatterapi.meta/chatterapi/intro_cors.htm *(fetched; same limitation)*
- https://help.salesforce.com/s/articleView?id=sf.extend_code_cors.htm&language=en_US&type=5 *(fetched; same limitation)*
- https://developer.salesforce.com/docs/atlas.en-us.uiapi.meta/uiapi/extend_code_cors.htm

**Salesforce — OAuth JWT bearer flow**
- https://help.salesforce.com/s/articleView?language=en_US&id=remoteaccess_oauth_jwt_flow.htm
- https://www.apexhours.com/salesforce-oauth-2-0-jwt-bearer-flow/
- https://www.jeffdouglas.com/2023/11/23/salesforce-jwt-bearer-flow/
- https://mannharleen.github.io/2020-03-03-salesforce-jwt/

**Salesforce — IP allowlisting**
- https://help.salesforce.com/s/articleView?id=xcloud.shr_configure_trusted_ip_ranges_for_a_connected_app_trusted_ip_ranges_for_a_connected_app.htm&language=en_US&type=5
- https://help.salesforce.com/s/articleView?id=xcloud.connected_app_edit_ip_ranges.htm&language=en_US&type=5
- https://www.quotaguard.com/blog/salesforce-api-ip-whitelisting-trusted-ranges
- https://devcenter.heroku.com/articles/establish-trust-private-space-and-salesforce

**BFF pattern and SPA token safety**
- https://auth0.com/blog/the-backend-for-frontend-pattern-bff/
- https://auth0.com/blog/things-developers-get-wrong-about-the-backend-for-frontend-pattern/
- https://curity.io/resources/learn/spa-best-practices/
- https://fusionauth.io/blog/backend-for-frontend
- https://docs.abblix.com/docs/react-spa-bff-guide
- https://github.com/gary-archer/oauth.blog/blob/master/public/posts/spa-back-end-for-front-end.mdx

**AWS — ECS secrets**
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/specifying-sensitive-data.html
- https://repost.aws/knowledge-center/ecs-data-security-container-task
- https://repost.aws/questions/QUKmWo-l06SFei_zv2_T2KpQ/best-practices-for-managing-secrets-in-ecs-environment
- https://cloudkiln.com/blog/ecs-secrets-management
- https://oneuptime.com/blog/post/2026-02-12-pass-secrets-ecs-tasks-secrets-manager/view
- https://oneuptime.com/blog/post/2026-02-12-ecs-parameter-store-configuration/view
- https://github.com/aws-samples/aws-secret-sidecar-injector/blob/master/ecs-task-def/task-def.json

**AWS — ECS Fargate vs EC2**
- https://towardsthecloud.com/blog/amazon-ecs-vs-aws-fargate
- https://leanopstech.com/blog/aws-ecs-fargate-pricing-2026/
- https://oneuptime.com/blog/post/2026-02-12-choose-ecs-fargate-ec2/view
- https://aws.amazon.com/blogs/containers/theoretical-cost-optimization-by-amazon-ecs-launch-type-fargate-vs-ec2/
- https://www.braincuber.com/blog/aws-fargate-vs-ec2-ecs-when-each-costs-less

**AWS — ECS deployments**
- https://aws.amazon.com/about-aws/whats-new/2025/07/amazon-ecs-built-in-blue-green-deployments/
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-bluegreen.html
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/migrate-code-deploy-to-ecs-rolling.html
- https://aws.amazon.com/blogs/devops/choosing-between-amazon-ecs-blue-green-native-or-aws-codedeploy-in-aws-cdk
- https://dev.to/aws-builders/ecs-native-bluegreen-is-here-with-strong-hooks-and-dark-canary-8ff

**AWS — ECS autoscaling**
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-autoscaling-targettracking.html
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/target-tracking-create-policy.html
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/capacity-autoscaling-best-practice.html
- https://fortem.dev/blog/ecs-fargate-autoscaling/
- https://oneuptime.com/blog/post/2026-02-12-ecs-service-auto-scaling/view

**AWS — NAT gateway / networking cost**
- https://spendark.com/blog/aws-nat-gateway-pricing/
- https://cloudpipelines.com/guides/aws-nat-gateway-pricing-2026/
- https://costgoat.com/pricing/aws-nat-gateway
- https://cloudburn.io/blog/aws-nat-gateway-pricing
- https://www.wring.co/blog/aws-nat-gateway-pricing-guide
- https://enforza.io/aws-nat-gateway-cost/

**Observability**
- https://aws-otel.github.io/docs/adot-collector-using-ecs/
- https://aws-otel.github.io/docs/getting-started/js-sdk/trace-manual-instr/
- https://docs.aws.amazon.com/AmazonECS/latest/developerguide/trace-data.html
- https://oneuptime.com/blog/post/2026-02-06-context-propagation-aws-xray-format/view
- https://oneuptime.com/blog/post/2026-01-30-opentelemetry-xray-propagation/view
- https://aws.amazon.com/blogs/opensource/migrating-x-ray-tracing-to-aws-distro-for-opentelemetry/
- https://grafana.com/docs/alloy/latest/collect/ecs-opentelemetry-data/

**TanStack Query**
- https://tanstack.com/query/v5/docs/framework/react/guides/caching
- https://tanstack.com/query/v5/docs/framework/react/guides/ssr
- https://tomodahinata.com/en/blog/tanstack-query
- https://blog.codercops.com/blog/tanstack-query-server-state-2026
- https://www.telerik.com/blogs/caching-tanstack-query
