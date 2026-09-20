# Deployment and Cloudflare Access setup

Hosting steps for the personal briefing Worker, split into what must be done in
the Cloudflare dashboard and what the repository commands do. The daily trigger
is deliberately out of scope (see `docs/implementation-plan.md`, Increment 6).

## Readiness prerequisites

| Requirement                                                                                                              | Why                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Cloudflare account on the **Workers Free** plan                                                                          | Nothing in this deployment needs a paid feature: Durable Objects with SQLite and Workflows run on Free |
| **Zero Trust enabled** with a team domain                                                                                | Its JWT is the only thing that admits a request; configured as `briefing-agent.cloudflareaccess.com`   |
| A hostname — the free `<worker>.<account>.workers.dev` address (no zone needed) or a custom domain in a zone you control | Access protects the hostname the app is served from                                                    |
| `npx wrangler login` completed                                                                                           | Non-interactive deploys can use a scoped API token instead                                             |
| Node 24.x                                                                                                                | `npm run check` and the build                                                                          |

No paid plan is required because **SearXNG is not deployed**. Collection runs the
decoded Google News RSS channel plus GDELT, so the deployment contains no
container and no container secret. The private-container SearXNG path is parked:
`infra/searxng/` stays for local Docker verification through the
`SEARXNG_BASE_URL` override, and re-enabling it means restoring the container
binding and the paid plan, not rewriting code.

## Order of operations (and why)

The auth code is already in place, so the remaining order is deploy, then attach
Access:

1. **Deploy** with a hostname: `workers.dev` or a custom domain route. The Worker
   refuses every request that lacks a valid Access JWT, so this is safe even
   before Access exists.
2. **Create the Access application** and its allow policy.
3. **Set `ACCESS_AUD`** to the application's AUD tag and redeploy the
   configuration. Until that value exists every request is rejected with 401 —
   that is the fail-closed behaviour, not a fault.

This ordering is what makes the setup safe: there is no window in which the API
is reachable and unauthenticated. Creating the Access application before the
Worker exists also works if the dashboard accepts the hostname, but it is not
required.

## Manual steps (Cloudflare dashboard)

Record each value as you go; the last section lists what the code needs.

### 1. Choose the hostname

Two options; both are protected identically by Access, and switching later only
means repointing the Access application and updating the AUD tag in the Worker
configuration.

**Option A — the free `workers.dev` address (no domain or zone required).**
Register the account's `workers.dev` subdomain once, then the app lives at
`<worker-name>.<account-subdomain>.workers.dev`. Set `workers_dev` to `true` in
`wrangler.jsonc` (it is currently `false`, which is what keeps the Worker
unreachable today) and leave `preview_urls` as `false`: preview URLs are a
separate surface that is easy to forget, and if they are ever enabled they must
be protected too.

**Option B — a custom domain.** Add `briefing.example.com` as a custom domain
route in `wrangler.jsonc`, which requires a zone in the same account.

Whichever you choose, the whole hostname sits behind Access, so static assets,
`/api/*`, and `/agents/*` are all covered.

### 2. Enable Zero Trust and set the team domain

1. Open the [Zero Trust dashboard](https://one.dash.cloudflare.com/).
2. Complete the first-run organisation setup (any name; the plan stays free).
3. Go to **Settings → Custom Pages / Team domain** and note the team domain, which
   looks like `<team-name>.cloudflareaccess.com`. This is the JWT issuer, and the
   certificate endpoint is
   `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/certs`.

### 3. Add a login method

1. **Settings → Authentication → Login methods → Add new**.
2. **One-time PIN** is enough for a single user and needs no external provider.
3. Optionally link Google, GitHub, or another IdP instead; note that Access
   authorises by the identity claims it receives either way.

### 4. Create the Access application

An Access application must exist before anything can authenticate — Zero Trust
has no way to admit a request without one. There are two routes, and they differ
in whether the Worker has to exist first.

**Route 1 — account-level, works before deploying.** In the Zero Trust dashboard
open **Workers & Pages** and enable the **Protect all Workers** card, choosing
**All traffic**. This turns on Access for the account's `workers.dev` workers and
creates the application for you, so it is the quickest way to unblock a
deployment that does not exist yet. The trade-off is breadth: it covers every
Worker and preview URL in the account, not just this one. Previews should stay
unprotected here only because `preview_urls` is `false` for this Worker.

**Route 2 — per-Worker, needs the Worker deployed first.** Once the Worker
exists, open **Workers & Pages → your Worker → Settings → Domains & Routes** (or
its **Access** tab) and enable **Protect with Access** for **production**. This
creates a narrower, single-Worker application.

Either route lands in the same place: an application under **Zero Trust → Access
controls → Applications**. Open it, add the allow policy from step 5 if it was
not created with one, and copy its **Application Audience (AUD) Tag** — a
32-character value the Worker checks. Without that tag in `ACCESS_AUD` the Worker
rejects every request by design.

**For a custom domain (Option B),** create it directly:

1. **Access controls → Applications → Create new application → Self-hosted**.
2. Name it, for example `Personal Briefing`.
3. Set the public hostname to the subdomain and zone chosen in step 1.
4. Set **Session duration** deliberately — WebSocket connections are validated
   only at the handshake, so this value decides how long a chat socket can stay
   open before the client must reconnect and authenticate again. A few hours to a
   day is reasonable for a personal app.
5. Leave the default of protecting all paths rather than scoping to `/api/*`.
6. Save, then open the application's **Overview** and copy the
   **Application Audience (AUD) Tag** — a 32-character value the Worker checks.

Do not rely on `ctx.access.getIdentity()` for this Worker. Cloudflare exposes an
Access identity to Worker code, but with **Static Assets** an internal router sits
in front of the script and does not pass that context through, which is exactly
this app's shape. The Worker therefore verifies the Access JWT itself, and
`ctx.access` may be tested later as an optional fast path, never as the only
check.

### 5. Add the allow policy

The policy decides which identity may sign in, and the dashboard offers two shapes:

- **Cloudflare account members.** Works immediately with no domain and no identity
  provider: the login is the Cloudflare account itself. Anyone you later add to the
  account inherits access, so if that matters, pin the exact identity with the
  `ACCESS_ALLOWED_IDENTITIES` binding — account membership alone then stops being
  sufficient.
- **An email domain.** Requires a domain added and verified in the account, so it is
  not available for a `workers.dev`-only setup. Once a domain exists it is the better
  long-term choice, covering every address at that domain without per-person edits.

Either way: **Action: Allow**, and do not add a broader rule than you intend, because
this is the only gate in front of the app. A service token, if you create one, needs
its own **Include → Service Token** rule.

### 6. (Optional) Create a service token for scripted access

Only needed to drive the hosted API from scripts (`npm run evaluate:briefing-run`,
a hosted generate call) without a browser session.

1. **Access controls → Service Auth → Service tokens → Create service token.**
2. Note the **Client ID** and **Client Secret** once; the secret is not shown
   again.
3. Add a policy to the application that allows that service token
   (**Include → Service Token**), otherwise the token is rejected.

Scripts then send `CF-Access-Client-Id` and `CF-Access-Client-Secret`. Be aware
that a service-token JWT carries an **empty `sub`**; the identity lives in
`common_name` and `service_token_id`.

## Repository steps (commands)

Run these from the repository root once the auth code and hostname are settled.

```sh
# 1. Confirm the account
npx wrangler whoami

# 2. Validate the deployment without publishing anything
npm run build
npx wrangler deploy --dry-run --config wrangler.jsonc

# 3. Deploy
npx wrangler deploy --config wrangler.jsonc
```

`--config wrangler.jsonc` is required. The Vite plugin redirects Wrangler to a
generated `dist/<worker>/wrangler.json`, where the assets directory is rewritten
relative to that file but other relative paths are not, so a plain
`npx wrangler deploy` fails on a missing file.

Before deploying, settle the hostname in `wrangler.jsonc`: either set
`workers_dev` to `true` for the free `workers.dev` address, or add the custom
domain route.

## Post-deploy verification

1. An unauthenticated `curl https://<hostname>/api/health` returns a rejection
   (401 or an Access redirect), never `{"status":"ok"}`.
2. A browser visit shows the Access login, and after signing in the app loads.
3. The chat screen answers a follow-up — this proves the WebSocket route works
   with Access and the retained evidence is present.
4. `/api/inspection` and the preferences diagnostic return 404 in deployment;
   both are local-only bindings.
5. One manual generation publishes an edition and its duration is recorded. With
   no container there is no cold start to pay, so this measures only search,
   article retrieval, and the model call.
6. Engine coverage is measured from the hosted Worker: which of the Google News
   RSS and GDELT channels respond, how many results carry publication dates, and
   whether the hosting egress IP is treated differently than localhost. This is
   the main unknown for hosted briefing quality.

## Values the Worker configuration needs

| Value              | Where it comes from                                                                  | Purpose                                                         |
| ------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Team domain        | Zero Trust team domain — `briefing-agent.cloudflareaccess.com` is already configured | JWT issuer and JWKS base URL                                    |
| AUD tag            | The Access application's overview page — **still needed**                            | Audience claim check; every request is rejected until it is set |
| Allowed identities | The email (and any service-token client ids) you authorised                          | Defence in depth beyond the Access policy                       |
| Hostname           | `workers.dev` or the custom domain you chose                                         | Worker route and Access application                             |

## Current limitations

- The app is single-user by design: every authenticated identity maps to one
  owner and one Durable Object. Per-user agents and storage are future scope
  (DEPLOY-03 in `docs/data-pipeline.md`).
- No deletion path exists yet for briefings, retained evidence, or chat history
  (STORE-01).
- The daily schedule is not implemented; runs are manual (SCHED-01).
- Hosted usage has not been measured against the USD 10–20/month target (COST-01).
