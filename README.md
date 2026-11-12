# CircuitGuide — Groq-powered Electronics Project Assistant

## Start (Node.js 22.13 or newer)
1. Open this folder in VS Code.
2. Edit `.env` and replace `your_groq_api_key_here` with your Groq API key. Do not add quotes unless needed. Never put the key in `dist/`.
3. In the VS Code terminal run `npm start`.
4. Open http://localhost:4173. The header should say **GROQ · LIVE AI** when a key is configured. This indicates configuration, not that a key has already been validated by Groq.

No dependency installation is required. If `.env` is missing, copy `.env.example` to `.env`. Restart the server after changing any environment values. The model defaults to `llama-3.3-70b-versatile`; change GROQ_MODEL if your Groq account requires another JSON-mode-compatible chat model. PORT defaults to 4173.

Opening index.html directly only runs the offline template demo. Live mode needs the Node server.

## What works
- Custom electronics project descriptions and follow-up conversations through Groq.
- Questions about budget, experience and missing requirements.
- Structured component list, estimated costs, conceptual flow, build steps, test checklist and curated references.
- Plan revision, per-account SQLite project history (or local guest history) and text/CSV downloads.
- Clear handling for missing/invalid keys, rate limits, unavailable models, timeouts and malformed model responses.
- Labelled offline demo using three curated templates when the backend is unavailable or no key is configured.

## Files
- `server.mjs`: local HTTP server, private Groq request, prompt, validation, reference allowlist and API errors.
- `.env`: your secret local key (ignored by Git; never included in the ZIP).
- `.env.example`: placeholder configuration safe to share.
- `dist/index.html`: page layout.
- `dist/styles.css`: all styling and theme variables.
- `dist/app.js`: conversation UI, backend connection, history and downloads.
- `dist/engine.js`: offline templates only; live mode uses Groq.
- `test/server.test.mjs`: API and provider-mock tests (`npm test`).

## Privacy and limitations
Live conversations and current plan context are transmitted to Groq. The server sends the most recent 20 conversation messages plus the current plan and instructions. Guest conversations stay in browser localStorage. Logged-in projects are saved to SQLite under data/circuitguide.sqlite. No API key is sent to the browser. The server serves only an allowlist of files in dist; it never serves .env.

AI-generated electronics advice is not automatically electrically verified. Costs are estimates, not live shop prices. Reference links are chosen from a curated library; the app does not browse the web or verify that every generated claim is supported. Outputs include selection notes and unresolved checks. There is no circuit simulation or guaranteed pin-by-pin wiring.

The server binds only to 127.0.0.1 for local use. This is not a public production deployment. A static host cannot run server.mjs; public hosting requires a Node-capable service plus authentication and appropriate rate/cost controls. Existing static Sites metadata does not deploy this backend.

## Verification
`npm test` uses a mocked Groq response to test the integration contract, validation, arithmetic, secret-file protection and error handling. A real Groq call cannot be verified until you supply a key.

API reference: https://console.groq.com/docs/text-chat
JSON-mode reference: https://console.groq.com/docs/structured-outputs


## Login and SQLite
After updating the files, stop the old server with Ctrl+C, run `npm start` again and refresh the browser. If account creation says "Method not allowed", the old server is still running.

Use **Log in / Sign up** in the header to create a local account with name, email and a password of at least 8 characters. Registration logs you in automatically. Each account has its own autosaved project conversations. Logout restores the guest workspace; guest history is not silently imported into an account. New conversations save automatically after the first project idea. Account projects are stored in `data/circuitguide.sqlite`, created automatically with no setup commands. Keep that file to retain accounts and projects across restarts.

The database has users, sessions and projects tables. Passwords use salted scrypt hashes; session tokens are random and stored as hashes in SQLite, with 7-day expiry and HttpOnly/SameSite=Strict cookies. Logout revokes the session. SQL queries use bound parameters, and every project query is scoped to the authenticated user. Authentication endpoints limit repeated attempts. The app remains usable as a guest.

This is local classroom authentication: no email verification, password recovery or account deletion flow is included. Use the same localhost hostname consistently; cookies and guest storage differ between localhost and 127.0.0.1. Before any future HTTPS deployment, set COOKIE_SECURE=true and add the appropriate deployment/authentication controls. Do not set it for this local HTTP preview.

`database.mjs` contains SQLite schema, account/session operations and project validation. Both the SQLite data directory and `.env` are excluded from Git and the submission ZIP. Tests use isolated in-memory or temporary databases, including account isolation, persistence, session expiry, revocation and endpoint tests. Browser QA covered registration, saving a full sample plan, reloading, logging out and logging back in to restore it.

## Hosted version
The Sites deployment uses a Cloudflare Worker with a persistent D1 database, declared in `.openai/hosting.json`. `scripts/build-hosted.mjs` embeds the four front-end assets and shared Groq validation into `dist/server/index.js`. `hosted/worker.mjs` is the hosted API adapter, and `drizzle/0000_hosted_accounts.sql` creates its database schema.

The local Node + SQLite app remains available with `npm start`. The hosted database is separate; existing local accounts and passwords are not uploaded. Hosted accounts use PBKDF2-SHA256 hashes and Secure session cookies. Live AI requires an account and is limited to five calls per minute and 50 per UTC day per account. Groq credentials belong in hosted secret storage, never in source or the front-end bundle.

Build before running the full suite: `node scripts/build-hosted.mjs && npm test`. Hosted tests run against an isolated SQLite adapter for D1. The deployment archive excludes `.env`, the local database, and local account data.
