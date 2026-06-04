# `ff-cms-auth` — Cloudflare Worker for Sveltia CMS

This tiny Worker handles the GitHub OAuth handshake that lets the Sveltia
CMS editor (mounted at https://new.findingforwardcounseling.com/admin/) write
to the GitHub repo. GitHub Pages can't do server-side OAuth, so we offload it
to one free Cloudflare Worker.

## Deploy (one-time, ~10 minutes)

### 1. Create a GitHub OAuth App

GitHub → Settings → Developer settings → **OAuth Apps** → "New OAuth App".

- **Application name:** `Finding Forward CMS`
- **Homepage URL:** `https://new.findingforwardcounseling.com`
- **Authorization callback URL:**
  `https://ff-cms-auth.<your-cf-subdomain>.workers.dev/callback`
  (Provisional — you'll get the real Worker URL in step 3. You can edit this
  callback URL afterwards.)

Save. Copy the **Client ID**. Click "Generate a new client secret" and copy
that too (it's shown once).

### 2. Install Wrangler + sign in to Cloudflare

```bash
cd worker
npm install
npx wrangler login   # opens a browser
```

### 3. Deploy

```bash
npx wrangler deploy
```

The output prints your Worker URL, e.g.
`https://ff-cms-auth.maxmatthews.workers.dev`.

### 4. Save the OAuth credentials as secrets

```bash
npx wrangler secret put OAUTH_CLIENT_ID
# paste the Client ID, press Enter
npx wrangler secret put OAUTH_CLIENT_SECRET
# paste the Client Secret, press Enter
```

### 5. Fix the GitHub OAuth App callback URL

Back in GitHub → your OAuth App → set the callback URL to the real Worker URL
from step 3, followed by `/callback`. Save.

### 6. Update the CMS config to point at the Worker

Edit `public/admin/config.yml` in the main repo: replace
`https://ff-cms-auth.YOUR-CF-SUBDOMAIN.workers.dev` with the real Worker URL
from step 3 (without trailing slash). Commit + push.

### 7. Try it

Visit `https://new.findingforwardcounseling.com/admin/`. Click **Login with
GitHub**. You should be redirected to GitHub, then bounced back to the editor
with full access to write posts.

## How it works

- `GET /auth` — bounces the user to GitHub's OAuth consent screen with
  `scope=repo,user` and the right callback.
- `GET /callback` — exchanges the returned `code` for an access token, then
  posts it back to the parent (CMS) window via `postMessage` in the format
  Sveltia/Decap expects: `authorization:github:success:{token, provider}`.

The Worker stores no state, has no database, and costs $0 on Cloudflare's free
tier (100k requests/day, more than enough for one author).

## Updating / rolling secrets

To rotate the OAuth secret, regenerate it in GitHub, then re-run
`npx wrangler secret put OAUTH_CLIENT_SECRET`.

To redeploy after editing `src/index.js`, just run `npx wrangler deploy`.
