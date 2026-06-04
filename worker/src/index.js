/**
 * Sveltia / Decap CMS GitHub OAuth proxy — Cloudflare Worker.
 *
 * Two routes:
 *   GET /auth      → redirects the user to GitHub's OAuth consent screen
 *   GET /callback  → exchanges the returned code for an access token,
 *                    then posts it back to the opener window in the
 *                    `authorization:github:success:{...}` format that
 *                    Sveltia/Decap CMS expects.
 *
 * Env vars (set via `wrangler secret put` or the dashboard):
 *   OAUTH_CLIENT_ID     — GitHub OAuth App client ID
 *   OAUTH_CLIENT_SECRET — GitHub OAuth App client secret
 *   ALLOWED_ORIGIN      — full origin of the admin site
 *                         (e.g. https://new.findingforwardcounseling.com)
 */

const SCOPES = 'repo,user';

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

      let token, error;
      try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'finding-forward-cms-proxy',
          },
          body: JSON.stringify({
            client_id: env.OAUTH_CLIENT_ID,
            client_secret: env.OAUTH_CLIENT_SECRET,
            code,
          }),
        });
        const data = await tokenRes.json();
        if (data.access_token) token = data.access_token;
        else error = data.error_description || data.error || 'no_token';
      } catch (e) {
        error = e?.message || 'fetch_failed';
      }

      const status = token ? 'success' : 'error';
      const content = token
        ? { token, provider: 'github' }
        : { message: error };
      const message = `authorization:github:${status}:${JSON.stringify(content)}`;
      const allowedOrigin = JSON.stringify(env.ALLOWED_ORIGIN || '*');

      const html = `<!doctype html><html><head><title>Authorizing…</title>
<style>body{font-family:system-ui,sans-serif;background:#F1EBDD;color:#1C2620;display:grid;place-items:center;height:100vh;margin:0}.box{text-align:center}</style>
</head><body><div class="box"><p>Authorizing… you can close this window.</p></div>
<script>
(function () {
  function send(targetWindow) {
    targetWindow.postMessage(${JSON.stringify(message)}, ${allowedOrigin});
  }
  window.addEventListener('message', function (e) {
    if (e.data === 'authorizing:github' && window.opener) send(window.opener);
  });
  if (window.opener) send(window.opener);
  setTimeout(function () { window.close(); }, 1000);
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
