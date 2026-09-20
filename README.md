# ☀️ PVOutput Solar Dashboard

A sleek, modern, and lightweight web dashboard for real-time monitoring and historical analysis of solar photovoltaic systems via the **PVOutput.org** API. Built with modern web technologies: **HTML5**, **Vanilla JavaScript (ES6+)**, **Chart.js**, and **Pico CSS v2**.

Designed with a 100% German user interface (*100% Deutsch*) tailored for high visual clarity, precision, and responsive performance across mobile, tablet, and desktop devices.

---

## 🏗️ Project Architecture (SOLID & ES6 Modules)

The codebase has been meticulously refactored using pure vanilla JavaScript to embrace **SOLID** principles, particularly the **Single Responsibility Principle (SRP)**, while preserving maximum readability (**KISS**). There are no complex build steps required.

The application logic is broken down into highly focused ES6 modules:

- `app.js` (Orchestrator): The main entry point. It holds the global state, binds modules together, handles timing/intervals, and orchestrates the data loading flow.
- `api.js` (`PVOutputAPI`): Strictly handles all interactions with PVOutput.org. This includes multi-proxy fallbacks, rate limit throttling, sequential data fetching, and transforming raw CSV data into clean JS objects.
- `ui.js` (`DashboardUI`): Manages the DOM. Responsible for taking state data and rendering it to the visual components, including updating texts, classes, conditional visibility, and the sun arc position.
- `charts.js` (`DashboardCharts`): Wraps the Chart.js library to specifically handle the creation, updating, and lifecycle of the historical and intraday graphs.
- `i18n.js` (`I18n`): Isolates all translation dictionaries and logic to apply current language configurations to the DOM.
- `utils.js`: A collection of pure, stateless utility functions (e.g., date parsing, number formatting, and async delays).

---

## 🚀 Key Features & Architecture

- **Real-Time Generation Monitoring**: Displays current power output (Watts), daily energy yield, specific efficiency (kWh/kWp), inverter module temperature (°C), and peak power today with timestamp.
- **Interactive 24h Intraday Curve**: Chart.js smooth area line chart rendering 5-minute status history for today with zero-based Y-scaling and instant hover tooltips.
- **Granular Yield History**: Interactive Chart.js bar chart with tab switching for **Täglich** (Daily 30-day), **Wöchentlich** (Weekly 12-week), **Monatlich** (Monthly 12-month), and **Jährlich** (Yearly) production data.
- **Smart Energy Unit Formatting**: Automatically switches unit precision between Watt-hours (**Wh**) for yields under 1,000 Wh (ideal for micro-solar / Balkonkraftwerk systems) and high-precision **kWh** for larger generation values.
- **Rate-Limit Throttling Protection**: Sequential staggered API fetcher maintaining 1.5-second spacing to strictly observe PVOutput rate limits and eliminate HTTP 403 errors.
- **Lifetime Statistics & Records**: All-time energy total, daily average production, historical single-day record yield with date, and total active recording days.
- **System Specs Display**: Shows installed capacity (Wp), panel brand & counts, inverter model, and system name.


---

## 🔒 Security & Credentials Architecture

Zero secrets or credentials are hardcoded into the source code repository. Credentials are dynamically resolved at runtime using the following precedence:

1. **URL Query Parameters** (convenience for bookmarks — *local use only, do not share*):
   ```text
   https://yourusername.github.io/ha-dashboard/?sid=YOUR_SYSTEM_ID&key=YOUR_API_KEY
   ```
2. **Browser `localStorage`**: Persisted when entered via the settings dialog.
3. **`secrets.json` File** (generated at deploy time — see below).
4. **Settings Dialog**: Click **⚙️ Einstellungen** to configure **System ID**, **API Key**, or the proxy URL.

> [!IMPORTANT]
> **GitHub Pages is static hosting — every file in the deployed artifact is world-readable.**
> A `secrets.json` containing the API key can be read by anyone at
> `https://yourusername.github.io/ha-dashboard/secrets.json`. GitHub "repository secrets"
> only protect the build, never the deployed output.
>
> Therefore, the deployment workflow **no longer writes the API key into `secrets.json`**.
> It only contains the **System ID** and the **Worker URL** (both non-secret). The API key
> lives as an encrypted secret **inside your own Cloudflare Worker** (see next section)
> and is injected server-side — it never appears in the browser at all.

`secrets.json` structure after deployment:

```json
{
  "systemId": "YOUR_SYSTEM_ID",
  "proxyUrl": "https://pvoutput-proxy.YOUR_SUBDOMAIN.workers.dev"
}
```

---

## ☁️ Cloudflare Worker Proxy (Recommended)

**PVOutput.org does not send `Access-Control-Allow-Origin` headers**, so a browser hosted
on GitHub Pages cannot call the API directly. Public CORS proxies (CodeTabs, AllOrigins,
CorsProxy.io, ThingProxy…) are unreliable: they rate-limit, they block non-localhost
origins (CorsProxy.io's free tier only serves `localhost`), or they are simply dead
(ThingProxy). This is why the dashboard worked locally but failed on GitHub Pages.

The bundled worker (`cloudflare/worker.js`) solves both problems at once:

- ✅ It adds the required **CORS headers**.
- ✅ It **injects the PVOutput API key server-side** from the encrypted worker secret
  `PVOUTPUT_API_KEY` — the key never travels to or from the browser.

**Request flow:**

```text
Browser (GitHub Pages)                Cloudflare Worker                PVOutput.org
──────────────────────                ─────────────────                ────────────
GET /getstatus.jsp?sid=…&h=1    →     adds ?key=*** (secret)     →     https://pvoutput.org/service/r2/getstatus.jsp?…
← CSV text + CORS headers       ←     forwards CSV               ←     CSV text
```

### Option A: Deploy with the Wrangler CLI (recommended)

```bash
cd cloudflare
npm install -g wrangler          # or use: npx wrangler
wrangler login
wrangler deploy                                          # publishes the worker
wrangler secret put PVOUTPUT_API_KEY                     # paste your read-only key
wrangler secret put PVOUTPUT_SYSTEM_ID                   # optional fallback
```

Your worker URL will be printed after `wrangler deploy`, e.g.:

```text
https://pvoutput-proxy.YOUR_SUBDOMAIN.workers.dev
```


### Option B: Deploy via the Cloudflare Dashboard (no CLI)

1. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create Application** → **Create Worker**.
2. Name it (e.g. `pvoutput-proxy`) and click **Deploy**.
3. Click **Edit Code**, paste the full contents of [`cloudflare/worker.js`](cloudflare/worker.js), and **Deploy**.
4. Go to your worker → **Settings** → **Variables and Secrets** → add:
   - `PVOUTPUT_API_KEY` (type: **Secret**) = your PVOutput **read-only** API key.
   - `PVOUTPUT_SYSTEM_ID` (type: **Secret**, optional) = your System ID fallback.

### Verify the worker

```bash
curl https://pvoutput-proxy.YOUR_SUBDOMAIN.workers.dev/health
# → {"ok":true,"service":"pvoutput-proxy","keyConfigured":true}

curl "https://pvoutput-proxy.YOUR_SUBDOMAIN.workers.dev/getstatus.jsp?sid=YOUR_SID"
# → PVOutput CSV, e.g. "20240920,14:55,1234,567,0,0,5.982,18.0"
```

### Wire it into the dashboard

Set the worker URL either:

- as the GitHub repository secret **`PVOUTPUT_PROXY_URL`** (auto-deployed via `secrets.json`), or
- in the dashboard's **⚙️ Einstellungen → CORS Proxy Server** field (stored in `localStorage`).

When a proxy URL is configured, the frontend calls the worker **without** any API key.
If no proxy URL is configured, the dashboard falls back to a public proxy chain
(CodeTabs / AllOrigins) where the key travels inside the URL — this only makes sense
for local development.

---

## 🛠️ Local Development

To run the dashboard locally:

1. Copy `secrets_example.json` to `secrets.json` and add your credentials:

   ```bash
   cp secrets_example.json secrets.json
   ```

2. Start a local HTTP server:

   ```bash
   python3 -m http.server 8080 --bind 127.0.0.1
   ```

3. Open `http://127.0.0.1:8080` in your web browser.

> [!NOTE]
> Locally you can leave `proxyUrl` empty: browsers treat `http://127.0.0.1` as a
> development origin, so the public proxy fallback chain usually works there.
> For parity with production, set `proxyUrl` to your worker URL as well.

---

## 🌐 GitHub Pages Deployment & Repository Secrets

This repository includes a GitHub Actions workflow (`.github/workflows/pages.yml`) that
automatically builds and deploys the dashboard to **GitHub Pages** whenever changes are
pushed to `main` (or `master`).

### Configuring GitHub Repository Secrets

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret                | Required | Value                                                                       |
| --------------------- | -------- | --------------------------------------------------------------------------- |
| `PVOUTPUT_SYSTEM_ID`  | ✅       | Your PVOutput System ID (e.g. `12345`)                                      |
| `PVOUTPUT_PROXY_URL`  | ✅       | Your worker URL, e.g. `https://pvoutput-proxy.YOUR_SUBDOMAIN.workers.dev`   |
| `PVOUTPUT_API_KEY`    | ❌       | **No longer used by the site.** The key belongs in the Cloudflare Worker secret instead. |

> [!NOTE]
> Secrets are read at **build time**. After adding or changing a secret, re-run the
> deployment (push to `main` or re-run the workflow from the Actions tab).
> Also make sure your changes actually land on `main` — the workflow does not run
> for feature branches.

The workflow generates `secrets.json` (System ID + Worker URL only) and verifies its
existence in the build log. To confirm on the live site, open
`https://yourusername.github.io/ha-dashboard/secrets.json` — it must contain
`systemId` and `proxyUrl`, and **no API key**.

---

## 🐞 Debugging Guide

| Symptom / check                        | How                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Is `secrets.json` deployed?            | Open `https://yourusername.github.io/ha-dashboard/secrets.json` in the browser. 404 → deployment didn't run or secrets missing. |
| Which secrets did the build see?       | Repo → **Actions** → latest *Deploy to GitHub Pages* run → step *"Generate secrets.json"* / *"Verify secrets.json"*.            |
| Is the worker alive & key set?         | `curl https://…/workers.dev/health` → `"keyConfigured": true`. If `false`, run `wrangler secret put PVOUTPUT_API_KEY` again.    |
| Does the worker reach PVOutput?        | `curl "https://…/workers.dev/getstatus.jsp?sid=YOUR_SID"` → expect CSV. `Err 402/403` → wrong key/sid or PVOutput rate limit.   |
| Which proxy failed in the browser?     | DevTools (F12) → **Console**: each failed candidate logs `Proxy Attempt (<url>) failed:`. **Network** tab shows status codes.   |
| Is the API key itself valid?           | `curl "https://pvoutput.org/service/r2/getstatus.jsp?key=KEY&sid=SID"` directly from your machine.                              |

The status banner on the page maps to causes as follows:

- *„Bitte PVOutput System-ID & API-Key eintragen"* → no credentials found at all (check `secrets.json` / settings).
- *„⚠️ API-Limit erreicht"* → PVOutput 60-requests-per-hour limit hit (quota is per API key).
- *„Keine Daten geladen. Öffentliche CORS-Proxys blockiert? …"* → every proxy candidate failed (check worker `/health` and the console logs).

