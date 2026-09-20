/**
 * PVOutput CORS proxy for the pv-dashboard GitHub Pages site.
 *
 * Why a Worker? PVOutput.org does not send `Access-Control-Allow-Origin`
 * headers, so a browser hosted on GitHub Pages cannot call the API directly.
 * Public CORS proxies are unreliable (rate limits, blocked origins, dead
 * services). This worker:
 *
 *   1. Adds the required CORS headers.
 *   2. Injects the PVOutput API key SERVER-SIDE from the worker secret
 *      `PVOUTPUT_API_KEY`, so the key is never exposed in the frontend.
 *   3. Forwards every request to https://pvoutput.org/service/r2/<endpoint>.
 *
 * Deploy (see README):
 *   npx wrangler deploy
 *   npx wrangler secret put PVOUTPUT_API_KEY
 *
 * Health check:  GET /  or  GET /health
 * Data request:  GET /getstatus.jsp?sid=12345&h=1&limit=288
 */

const PVOUTPUT_BASE = "https://pvoutput.org/service/r2/";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    // Health endpoint – useful for debugging (see README)
    if (url.pathname === "/" || url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "pvoutput-proxy",
        keyConfigured: Boolean(env.PVOUTPUT_API_KEY)
      });
    }

    if (!env.PVOUTPUT_API_KEY) {
      return jsonResponse(
        { error: "Worker secret PVOUTPUT_API_KEY is not configured. Run: npx wrangler secret put PVOUTPUT_API_KEY" },
        500
      );
    }

    // Path after the leading slash is the PVOutput endpoint, e.g. getstatus.jsp
    const endpoint = url.pathname.replace(/^\/+/, "");
    if (!/^[a-z0-9_]+\.jsp$/i.test(endpoint)) {
      return jsonResponse({ error: `Invalid endpoint: '${endpoint}'` }, 400);
    }

    const target = new URL(PVOUTPUT_BASE + endpoint);

    // Forward all query params EXCEPT 'key' – the key is injected from the
    // worker secret so it never appears in browser network traffic.
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() !== "key") {
        target.searchParams.set(key, value);
      }
    }
    target.searchParams.set("key", env.PVOUTPUT_API_KEY);

    // Optional fallback: if the caller did not send a sid, use the worker
    // secret PVOUTPUT_SYSTEM_ID (set with: npx wrangler secret put PVOUTPUT_SYSTEM_ID).
    if (!target.searchParams.has("sid") && env.PVOUTPUT_SYSTEM_ID) {
      target.searchParams.set("sid", env.PVOUTPUT_SYSTEM_ID);
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: "GET",
        headers: { "Accept": "text/plain" },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
    } catch (err) {
      return jsonResponse({ error: `Upstream request failed: ${err.message}` }, 502);
    }

    // Pass PVOutput's body (CSV text or error message) through untouched so
    // the dashboard's rate-limit / error detection keeps working.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};