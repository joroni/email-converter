# Email Converter

Internal tool that turns a Figma email design (frame link or PNG) into Pardot-ready HTML.
Plain HTML/CSS/JS frontend, Node + Express backend wrapped as a Netlify Function.

## How it works

1. **Setup** - paste a Figma frame link (or upload a PNG), pick brand and platform, optional white-page background and notes, then Convert. `POST /api/conversions` reads the Figma frame, exports image layers as flattened 2x PNGs to Netlify Blobs, and triggers the background function.
2. **Preview** - the background function (`netlify/functions/convert-background.js`, up to 15 min) sends the screenshot, layer data, brand profile, platform rules, notes and the admin prompt to Claude and saves the HTML. The page shows a spinner and polls until it is ready. Download the images (zip: exported images plus the brand's social icons).
3. **Image links** - upload the images to Pardot Files, copy the file list HTML from the browser Inspector (a "How to" popup shows exactly how) and paste it in. Finalise pairs each file by its original name with its hosted URL (Pardot renames and shortens files) and replaces the `src` values.
4. **Final HTML** - click images or buttons in the live preview, or highlight text, to add links that open in a new tab. You can also edit the HTML directly. Save edits, then Copy.

```
public/                 static frontend (login.html, app.html, js/, css/, img/)
netlify/functions/
  api.js                Express app via serverless-http (60 s limit)
  convert-background.js Claude step (15 min limit)
server/
  app.js                Express app (also runnable on EC2 with app.listen)
  auth.js               bcrypt passwords, signed HTTP-only cookie, requireRole()
  store.js              Netlify Blobs wrapper
  figma.js              Figma REST API
  ai.js                 generateEmailHtml() - the one place that calls an AI
  convert.js            runs the Claude step
  platforms/            one file per platform (pardot, hubspot) + shared matching code
  routes/               auth, users, settings (brands/platforms/prompt), conversions
test/                   node --test
```

See `CLAUDE.md` ("AS BUILT") for design decisions, Pardot behaviour notes and how to rebuild.

## Roles

| Role   | Can do |
|--------|--------|
| Admin  | Everything: users, brands, platform rules, Claude prompt, all conversions |
| Editor | Run conversions, download images, finalise, see their own history |
| Viewer | View finished conversions and previews only |

Roles are checked on every API route (`requireRole` in `server/auth.js`) and the user is re-loaded from storage on each request, so removing a user or changing a role takes effect immediately. Passwords are hashed with bcrypt (`bcryptjs`, a pure-JS build that needs no native compile on Netlify).

## Local setup

```bash
npm install
cp .env.example .env        # fill in the values
npx netlify-cli dev --offline   # --offline skips an Edge Functions setup step that can hang
```

Open http://localhost:8888 and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Netlify Blobs runs locally (sandboxed) under `netlify dev`.

First steps as admin: **Admin settings > Brands** (add each brand, social links, icons, privacy link, footer address), check **Platform rules**, then convert.

### Using the local Claude Code CLI instead of the API

Set `AI_PROVIDER=cli` in `.env`. The background step then runs `claude -p` on your machine (uses your Claude Code login, no API key). Local development only; it does not work on Netlify.

### Tests

```bash
npm test
```

## Deploy to Netlify

1. Push this repo to GitHub/GitLab and **Add new site > Import an existing project** (or `netlify deploy --prod`). `netlify.toml` already sets the publish folder, functions folder and `/api/*` redirect.
2. Under **Site configuration > Environment variables** add `FIGMA_TOKEN`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`.
3. Deploy, sign in, then change the admin password from the avatar menu and delete `ADMIN_PASSWORD` from the environment if you like (it is only used when there are no users).

Secrets live only in server environment variables; the browser never sees them.

## Limits to know about

- The Claude step needs `ANTHROPIC_API_KEY` on Netlify (the local CLI option only works on your own machine).
- Netlify request/response bodies are about 6 MB: PNG uploads are capped at 4 MB and the image zip at about 5.5 MB.
- Regular functions stop at 60 s: reading a very large Figma frame with many images could hit this. Image layers are capped at 40 per email.
- PNG uploads have no layer data, so Claude works from the picture alone and no image layers are exported (only brand icons are included).

## Adding HubSpot (or another platform)

Copy `server/platforms/hubspot.js`, set its id, default tags and how to find hosted image URLs, register it in `server/platforms/index.js`, then switch it on under **Admin settings > Platform rules**.

---
Vibe coded by: Raymund Niconi
