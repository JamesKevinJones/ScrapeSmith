# ScrapeSmith

AI-powered structured web data extractor built with React, TypeScript, Tailwind CSS, Express, and the Gemini API.

## Features
- **Multi-URL & Topic Extraction**: Paste up to 10 public URLs (with validation and deduplication) or enter a topic to discover 3–5 public pages via Google Search grounding.
- **Schema Generation & Editing**: Auto-generated JSON Schema (`responseSchema`) synced with a typed field builder and editable before running.
- **Advanced Per-Field Rules**: CSS selector + attribute overrides, merged HTML table (`colspan`/`rowspan`) normalization, and dynamic JS/hydration content extraction.
- **Session Re-Authentication**: Ephemeral in-memory temporary session headers (`Cookie`, `Authorization`, HTTP Basic, or guided manual re-login) with live verification and TTL auto-expiry.
- **Results & Export**: Sortable/filterable table with inline editing, provenance (`confidence` + verbatim `source_snippet`), key-based deduplication, CSV/JSON/clipboard/Creative Studio exports, and **Google Sheets** export (append or overwrite).

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your `GEMINI_API_KEY`:
   ```bash
   cp .env.example .env
   ```
3. Start the full-stack dev server on `http://localhost:3000`:
   ```bash
   npm run dev
   ```

## Deploying from GitHub

> **Important:** Because ScrapeSmith runs an Express backend (`/api/extract`, `/api/schema`, `/api/discover`, `/api/auth/verify-session`) to keep `GEMINI_API_KEY` off the client and avoid browser CORS restrictions, it requires a **Node.js / container host** rather than static-only GitHub Pages.

### 1. Push to GitHub
Use the **Save to GitHub** action in your workspace toolbar, or initialize and push manually:
```bash
git init
git add .
git commit -m "Initial ScrapeSmith release"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Every push to `main` automatically runs the included `.github/workflows/ci.yml` pipeline (TypeScript lint, 22 unit tests, and Vite production build).

### 2. Deploy to a Host Connected to Your GitHub Repo
The included `Dockerfile` works out of the box with:
- **Google Cloud Run** (continuous deployment from GitHub repo using `Dockerfile`)
- **Render** / **Railway** / **Fly.io** (connect GitHub repo, select Docker or Node runtime)

Set these environment variables on your host:
- `GEMINI_API_KEY` — required (server-side only)
- `NODE_ENV=production`
- `PORT=3000` (or the port injected by your host)

### 3. Enable Google Sheets OAuth on Your Production Domain
After deploying, add your new production domain to **Firebase Console → Authentication → Settings → Authorized domains** so **Sign in with Google** works for Google Sheets export.
