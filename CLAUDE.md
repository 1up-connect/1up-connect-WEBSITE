# 1UP Connect website

- This directory is the ONLY canonical copy of the site. Never edit copies in
  `~/Downloads` or anywhere else — if one turns up, it's stale; work here.
- `public/index.html` is very large. Read it in slices (offset/limit or grep
  for the section first); never read the whole file.
- Deploys: use the `deploy` skill (commit → push to main → Railway
  auto-deploys → verify `/health` and the live page). CLI push needs `gh`
  auth; without it, Ben pushes via GitHub Desktop.
- `.env` holds `RESEND_API_KEY` — gitignored, never commit it, never echo it.
- Email goes through the Resend HTTP API. Railway blocks SMTP, so nodemailer/
  Gmail will time out — don't reintroduce it.
