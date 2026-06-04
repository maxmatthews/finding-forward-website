/**
 * Sveltia / Decap CMS GitHub OAuth proxy — Cloudflare Worker.
 *
 * Two routes:
 *   GET /auth      → redirects the user to GitHub's OAuth consent screen
 *   GET /callback  → exchanges the returned code for an access token,
 *                    verifies the GitHub user is on the allowlist,
 *                    then posts the token back to the opener window in the
 *                    `authorization:github:success:{...}` format that
 *                    Sveltia/Decap CMS expects.
 *
 * Env vars (set via `wrangler secret put` or wrangler.toml [vars]):
 *   OAUTH_CLIENT_ID     — GitHub OAuth App client ID  (secret)
 *   OAUTH_CLIENT_SECRET — GitHub OAuth App client sec (secret)
 *   ALLOWED_ORIGIN      — exact origin of the admin site
 *                         (e.g. https://new.findingforwardcounseling.com)
 *   ALLOWED_USERS       — comma-separated lowercase GitHub usernames
 *                         (e.g. "maxmatthews,kevinroche")
 *                         Any user not on this list is denied and their
 *                         freshly-issued token is revoked.
 */

const SCOPES = 'repo,user';
const UA = 'finding-forward-cms-proxy';

const parseAllowlist = (raw) =>
  (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

async function revokeToken(env, token) {
  // GitHub: DELETE /applications/{client_id}/grant — revokes the OAuth
  // App's entire authorization for this user. Uses HTTP Basic with the
  // OAuth App's client_id:client_secret.
  const creds = btoa(`${env.OAUTH_CLIENT_ID}:${env.OAUTH_CLIENT_SECRET}`);
  try {
    await fetch(
      `https://api.github.com/applications/${env.OAUTH_CLIENT_ID}/grant`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${creds}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': UA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: token }),
      }
    );
  } catch {
    /* best-effort; failure is non-fatal */
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/auth') {
      const redirectUri = `${url.origin}/callback`;
      const state = crypto.randomUUID();
      const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('scope', SCOPES);
      authorizeUrl.searchParams.set('state', state);
      return Response.redirect(authorizeUrl.toString(), 302);
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400 });

      let token = null;
      let error = null;

      // 1. Exchange code → access token
      try {
        const tokenRes = await fetch(
          'https://github.com/login/oauth/access_token',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': UA,
            },
            body: JSON.stringify({
              client_id: env.OAUTH_CLIENT_ID,
              client_secret: env.OAUTH_CLIENT_SECRET,
              code,
            }),
          }
        );
        const data = await tokenRes.json();
        if (data.access_token) token = data.access_token;
        else error = data.error_description || data.error || 'no_token';
      } catch (e) {
        error = e?.message || 'fetch_failed';
      }

      // 2. Allowlist check — fetch the user and confirm they're on it
      if (token) {
        const allowed = parseAllowlist(env.ALLOWED_USERS);
        if (allowed.length > 0) {
          let login = null;
          try {
            const userRes = await fetch('https://api.github.com/user', {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': UA,
              },
            });
            const u = await userRes.json();
            login = (u.login || '').toLowerCase();
          } catch {
            /* fall through to denial */
          }

          if (!login || !allowed.includes(login)) {
            // Revoke the token we just minted; nobody should hold it.
            await revokeToken(env, token);
            error = login
              ? `User "${login}" is not authorized for this CMS.`
              : 'Could not verify GitHub user.';
            token = null;
          }
        }
        // If allowed.length === 0, no allowlist enforced (open to anyone
        // who completes OAuth). Treated as misconfiguration — log it.
        else {
          console.warn('ALLOWED_USERS is empty — proxy is open to anyone.');
        }
      }

      const status = token ? 'success' : 'error';
      const content = token
        ? { token, provider: 'github' }
        : { message: error };
      const message = `authorization:github:${status}:${JSON.stringify(content)}`;
      const allowedOrigin = JSON.stringify(env.ALLOWED_ORIGIN || '*');
      const visibleError = token ? '' : (error || 'Authorization failed.');

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${
        token ? 'Authorizing…' : 'Not authorized'
      }</title>
<style>
  body{font-family:system-ui,sans-serif;background:#F1EBDD;color:#1C2620;display:grid;place-items:center;height:100vh;margin:0;padding:24px}
  .box{text-align:center;max-width:420px}
  h1{font-size:18px;margin:0 0 8px;font-weight:500}
  p{margin:0;color:#2F3A33}
  .err{color:#9F4E2F}
</style>
</head><body><div class="box">
${
  token
    ? '<h1>Authorizing…</h1><p>You can close this window.</p>'
    : `<h1 class="err">Not authorized</h1><p>${visibleError.replace(/[<&>]/g, '')}</p>`
}
</div>
<script>
(function () {
  function send(targetWindow) {
    targetWindow.postMessage(${JSON.stringify(message)}, ${allowedOrigin});
  }
  window.addEventListener('message', function (e) {
    if (e.data === 'authorizing:github' && window.opener) send(window.opener);
  });
  if (window.opener) send(window.opener);
  setTimeout(function () { window.close(); }, ${token ? 1000 : 4000});
})();
</script></body></html>`;
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response(
      'finding-forward CMS OAuth proxy — see /worker/README.md',
      { status: 200, headers: { 'Content-Type': 'text/plain' } }
    );
  },
};
