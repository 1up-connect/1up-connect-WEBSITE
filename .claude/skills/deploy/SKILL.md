---
name: deploy
description: Deploy the 1UP Connect website to production and verify it. Use whenever the user asks to deploy, push live, ship changes, publish the site, or after finishing an edit they want on 1up-connect.com. Handles commit, push, Railway redeploy wait, and live verification.
---

# Deploy 1UP Connect

Production: https://1up-connect.com — Railway auto-deploys from `main` on
GitHub (`1up-connect/1up-connect-WEBSITE`). CLI `git push` has NO stored
credential (verified 2026-07-05) — push works only if `gh` has been set up
(`gh auth status`); otherwise commit locally and ask Ben to push via GitHub
Desktop.

## Steps

1. **Preflight**
   - `git status` — confirm only the intended files changed. Never commit `.env`.
   - If `server.js` or anything email-related changed, run the local email-path
     test first (see below) before pushing.

2. **Commit & push**
   - Short imperative commit message describing the change.
   - `git push origin main` (works only with `gh` auth set up). If push fails
     on auth, commit anyway and ask Ben to push via GitHub Desktop — don't
     retry credentials blindly.

3. **Wait for Railway**
   - Railway rebuilds on push; typically 1–3 minutes.
   - Poll `https://1up-connect.com/health` until it returns 200 (curl every
     ~20s, give up after 5 minutes and report).

4. **Verify live**
   - `curl -s https://1up-connect.com/` and grep for the specific change that
     was deployed (new text, tag, etc.). Confirm it's the new version, not
     cache.
   - Report the result plainly: what was deployed, health status, and what was
     verified on the live page.

5. **Contact form (only when email code changed, or on request)**
   - POST a submission to `https://1up-connect.com/api/contact` with name
     "Deploy Test" so it's obvious in the inbox. Expect `200`.
   - Note: this sends a real email to contact@1up-connect.com and a real
     auto-reply, and the endpoint is rate-limited — one test max.
   - Ask Ben to confirm the email arrived; Resend delivery can't be checked
     from here.

## Local email-path test (pre-push, when server.js changed)

Run the server with a dummy key so no real email sends:
`RESEND_API_KEY=re_dummy PORT=3100 node server.js`
- `GET /health` → 200
- `POST /api/contact` with invalid body → 400 (validation works)
- `POST /api/contact` with valid body → 502 (Resend error surfaced, not
  swallowed — the SDK returns `{data, error}` and doesn't throw)
Kill the server when done; check nothing stale is left on the port
(`lsof -iTCP:3100 -sTCP:LISTEN`).

## Gotchas

- Railway blocks outbound SMTP — email must go through the Resend HTTP API,
  never nodemailer/Gmail.
- Kill stale dev servers before local testing; a long-running old server on
  the expected port will serve old code and fake out your tests.
