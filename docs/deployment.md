# Deployment and Cloudflare Access setup

Hosting steps for the personal briefing Worker, split into what must be done in
the Cloudflare dashboard and what the repository commands do. The daily trigger
is deliberately out of scope (see `docs/implementation-plan.md`, Increment 6).

## Readiness prerequisites

| Requirement                                     | Why                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare account with a **Workers Paid** plan | Containers and Workflows are paid-plan features; Durable Object SQLite usage is billed on top |
| A zone you control in the same account          | Access applications bind to a `subdomain.zone` hostname                                       |
| Zero Trust enabled (free tier)                  | Covers up to 50 seats; one user is free                                                       |
| `npx wrangler login` completed                  | Non-interactive deploys can use a scoped API token instead                                    |
| **Docker Desktop running**                      | `wrangler deploy` builds the SearXNG container image locally and pushes it during deploy      |
| Node 24.x                                       | `npm run check` and the build                                                                 |

## Order of operations (and why)

Do the code work first, deploy second, and attach Access last:

1. **Land the fail-closed auth code** (Increment 6, phase P2). Until Access exists
   every request is rejected — a Worker that refuses requests without a valid
   Access JWT cannot be abused even if someone finds the hostname.
2. **Deploy** with a custom domain route.
3. **Create the Access application.** The app immediately starts issuing tokens,
   so the browser can then authenticate.

This ordering is what makes the setup safe: there is no window in which the API
is reachable and unauthenticated. Creating the Access application before the
Worker exists also works if the dashboard accepts the hostname, but it is not
required.

## Manual steps (Cloudflare dashboard)

Record each value as you go; the last section lists what the code needs.

### 1. Choose the hostname

Pick the hostname the app will live at, for example `briefing.example.com`. The
whole hostname is protected, so static assets, `/api/*`, and `/agents/*` all sit
behind Access.

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

1. **Access controls → Applications → Create new application → Self-hosted**.
2. Name it, for example `Personal Briefing`.
3. Set the public hostname to the subdomain and zone chosen in step 1.
4. Set **Session duration** deliberately — WebSocket connections are validated
   only at the handshake, so this value decides how long a chat socket can stay
   open before the client must reconnect and authenticate again. A few hours to a
   day is reasonable for a personal app.
5. Leave the default of protecting all paths rather than scoping to `/api/*`.
6. Save, then open the application's **Overview** and copy the
   **Application Audience (AUD) Tag** — a 32-character value the Worker must check.

### 5. Add the allow policy

1. In the application, create a policy named for example `Owner`.
2. **Action: Allow**, and add an **Include** rule of type **Emails** with your
   address. Do not use a broad rule such as every address in a domain unless that
   is genuinely intended — this is the only gate in front of the app.

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
# 1. Confirm the account and zone
npx wrangler whoami

# 2. Store the container's runtime secret (never in source control)
npx wrangler secret put SEARXNG_SECRET

# 3. Validate the deployment without publishing anything
npm run build
npx wrangler deploy --dry-run --config wrangler.jsonc

# 4. Deploy
npx wrangler deploy --config wrangler.jsonc
```

`--config wrangler.jsonc` is required. The Vite plugin redirects Wrangler to a
generated `dist/<worker>/wrangler.json`, where the assets directory is rewritten
relative to that file but the container's Dockerfile path is not, so a plain
`npx wrangler deploy` aborts on a missing `dist/…/infra/searxng/Dockerfile`.

Add the hostname to `wrangler.jsonc` as a custom domain route before deploying,
and do **not** set `SEARXNG_BASE_URL` in deployment — when present, the Worker
uses it instead of the private container binding.

## Post-deploy verification

1. An unauthenticated `curl https://<hostname>/api/health` returns a rejection
   (401 or an Access redirect), never `{"status":"ok"}`.
2. A browser visit shows the Access login, and after signing in the app loads.
3. The chat screen answers a follow-up — this proves the WebSocket route works
   with Access and the retained evidence is present.
4. `/api/inspection` and the preferences diagnostic return 404 in deployment;
   both are local-only bindings.
5. One manual generation publishes an edition **and its duration is recorded**:
   the container sleeps after 10 minutes, so the first search after an idle
   period pays a cold start inside the Workflow's 10-minute collection step.
6. Engine coverage is measured from the hosted container: which engines respond,
   how many results carry dates, and whether the egress IP is treated differently
   than localhost. This is the main unknown for hosted briefing quality.

## Values the Worker configuration needs

| Value              | Where it comes from                                     | Purpose                                                                      |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Team domain        | Zero Trust team domain                                  | JWT issuer and JWKS base URL                                                 |
| AUD tag            | Access application overview                             | Audience claim check                                                         |
| Allowed identities | The email (and service-token client ids) you authorised | Defence in depth beyond the Access policy                                    |
| Hostname           | The custom domain you chose                             | Worker route and Access application                                          |
| `SEARXNG_SECRET`   | Generate a long random value                            | Container runtime secret; local Docker keeps its own in `infra/searxng/.env` |

## Current limitations

- The app is single-user by design: every authenticated identity maps to one
  owner and one Durable Object. Per-user agents and storage are future scope
  (DEPLOY-03 in `docs/data-pipeline.md`).
- No deletion path exists yet for briefings, retained evidence, or chat history
  (STORE-01).
- The daily schedule is not implemented; runs are manual (SCHED-01).
- Hosted usage has not been measured against the USD 10–20/month target (COST-01).
