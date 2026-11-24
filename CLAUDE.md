Figma to Pardot Email Converter (Netlify Version)
This version hosts the app on our company Netlify account, so there's no need for EC2 server access or IT admin help. The flow and features match the EC2 plan; only the hosting and server structure change.
Tech Decision
We're using plain HTML, CSS and JavaScript for the page, with Node and Express on the server, not Next.js. On Netlify, the Express app is wrapped into a Netlify Function with serverless-http, so the same code can move to EC2 later. The long Claude step still runs as a background function.
Priority: UI Mockup (Build First)
Ask Claude Code to build the page as a static HTML mockup first, before any Figma or AI wiring.
1.  Figma link box with a Convert button (paste the frame link from Copy link to selection).
2.  Email preview plus a Download images (zip) button.
3.  Pardot accordion HTML box with a Finalise button.
4.  Finished HTML with a Copy button and a live preview.
Login and Access Levels
There's a login page with a separate account for each of roughly 3 to 5 users, and no public sign-up. Passwords are stored hashed, and roles are checked inside every function.
Role
Can do
Admin
Manage users and passwords, change API keys and the Claude prompt, see all conversions, run conversions
Editor
Run conversions, download images, finalise HTML, see their conversion history
Viewer
View finished conversions and previews only
Inputs, Brands and Platforms
The main page uses buttons and dropdowns, not prompts. The real Claude prompt is kept in admin settings.
• Source: a Figma frame link or a PNG upload exported from Figma. For a PNG, Claude reads the image and spots which social icons appear.
• Brand dropdown (Aqualab, Addium, more via Add brand): picks which links and footer to use.
• Platform toggle: Pardot now, HubSpot later (moving next year). Each platform has its own unsubscribe tag, merge tags and image hosting (Pardot Files vs HubSpot File Manager).
• Optional notes box for one-off instructions, usually left empty.
Admin settings:
• Brands page: one profile per brand with social links (a row per network, with URL, on/off and stored icon image), privacy policy link and footer address. Detected icons are linked to the brand's URLs and swapped for its stored icons. Stored in Netlify Blobs.
• Platform rules: a separate settings piece per platform for unsubscribe and merge tags, so adding HubSpot only means filling in its rules.
How It's Built on Netlify
• Frontend: plain static HTML, CSS and JavaScript.
• Server code: an Express app wrapped as a Netlify Function with serverless-http, plus a separate background function for the Claude step.
• Regular functions have a 60-second limit: use them for login, reading Figma, exporting images and swapping URLs.
• Background function for the Claude HTML step: it runs up to 15 minutes but can't reply directly, so it saves the result and the page checks back until it's ready.
• Storage: Netlify Blobs for exported images, user accounts and conversion history. Keep large images out of direct responses, which are limited to about 6 MB.
• Secrets: Figma token and Anthropic API key go in Netlify environment variables, never in the frontend.
Flow
1.  User pastes the Figma frame link and clicks Convert.
2.  A function reads the frame through the Figma API and exports image layers as 2x PNGs with clear names, saved to Blobs.
3.  A background function sends the frame data and a screenshot to Claude, which writes Pardot-friendly HTML (tables, inline styles, unsubscribe tag) and saves it.
4.  The page polls until the HTML is ready, then shows a preview and the image zip.
5.  User uploads the images to Pardot Files, then pastes the Files accordion HTML into the app.
6.  A function extracts the URLs, matches them by original file name (ignoring characters Pardot appends), and outputs the final HTML.
Needed
• Access to the company Netlify account (already have)
• Figma personal access token with access to the designer's files
• Anthropic API key from the Anthropic Console (see the admin message in the EC2 plan doc)
Claude Code Prompts
Run Prompt 1 first and review the mockup in a browser before running Prompt 2.
Prompt 1: UI mockup only
Build a static UI mockup (no backend yet) for an internal tool called "Email Converter" that turns email designs into marketing email HTML.

Use plain HTML, CSS and vanilla JavaScript only. No frameworks, no build step. Keep the code simple, well commented and easy for a human to read.

Pages:
1. Login page: username, password, Sign in button. No sign-up.
2. Main converter page, top to bottom:
   - Source: tabs or toggle for "Figma link" (text field for a Figma frame link) or "PNG upload" (file picker).
   - Brand dropdown (Aqualab, Addium) and Platform toggle (Pardot, HubSpot).
   - Optional notes textarea for one-off instructions.
   - Convert button.
   - Results area: email preview (iframe) and "Download images (zip)" button.
   - "Paste Pardot Files accordion HTML" textarea with a Finalise button.
   - Final HTML: code view with Copy button, plus live preview.
3. Admin settings (only shown for admin role):
   - Users: list with role (Admin, Editor, Viewer), add, remove, reset password.
   - Brands: one profile per brand with social links (row per network: name, URL, on/off, icon image), privacy policy link, footer address. Add brand button.
   - Platform rules: per platform, unsubscribe tag and merge tags.
   - Claude prompt: a large textarea for the hidden conversion prompt.
4. History page: list of past conversions.

Use fake sample data. Make a role switcher in the corner so I can preview Admin, Editor and Viewer views. Clean, simple, professional look.
Prompt 2: full app
Turn the approved mockup into a working app hosted on Netlify. Keep plain HTML/CSS/JS on the frontend and Node.js with Express on the server, wrapped as a Netlify Function using serverless-http. Write readable, commented code.

Auth and roles:
- Login with per-user accounts, passwords hashed (bcrypt), session via signed HTTP-only cookie.
- Roles: Admin (everything), Editor (run conversions, see own history), Viewer (view finished conversions only). Check roles on every route.
- Seed one admin account from environment variables.

Storage: Netlify Blobs for users, brands, platform rules, the Claude prompt, exported images and conversion history.

Secrets in Netlify environment variables: FIGMA_TOKEN, ANTHROPIC_API_KEY, SESSION_SECRET.

Conversion flow:
1. Figma link: parse file key and node-id, read that frame via the Figma REST API, export image layers as 2x PNGs with clear unique names (email name + section), save to Blobs. PNG upload: save the image.
2. HTML step in a Netlify background function (15 min limit): send frame data and/or image, the brand profile, platform rules, notes and the admin prompt to Claude via @anthropic-ai/sdk. Output email-safe HTML: table layout, inline CSS, 600px wide, platform unsubscribe tag, brand footer and social links using stored icons. Save result; frontend polls until ready.
3. Keep the AI call in one isolated function (generateEmailHtml) so it can be swapped. For local development, add an option to call the local Claude Code CLI (claude -p) instead of the API.
4. Download images as zip.
5. Finalise: parse pasted Pardot Files accordion HTML, extract image URLs, match each to exported images by original file name (Pardot appends extra characters), replace src values, output final HTML.

Keep platform rules pluggable so HubSpot can be added later. Include a README with local setup (netlify dev) and deploy steps.

---

# AS BUILT (current state)

Everything above is the original plan. Prompt 1 (mockup) and Prompt 2 (working app) are DONE and pushed to
https://github.com/joroni/email-converter (branch `master`). This section records how it is actually built,
the decisions and gotchas learned along the way, and how to rebuild it. Keep it updated when behaviour changes.

## Stack and conventions
- Plain HTML/CSS/vanilla JS frontend in `public/` (no framework, no build step). Node 20 + Express 4 backend in `server/`.
- Express is wrapped as a Netlify Function (`netlify/functions/api.js`, serverless-http). A second function,
  `netlify/functions/convert-background.js` (the `-background` suffix = 15 min limit), runs the Claude step.
- Readable, commented code. Passwords hashed with `bcryptjs` (pure JS, no native build on Netlify).
- Tests: `npm test` (node:test, 14 tests in `test/`). Run them before committing. jsdom is NOT a dependency; browser behaviour
  was checked with throw-away jsdom scripts (note: jsdom ignores iframe `srcdoc`, so write into `contentDocument` by hand).

## File map
```
public/                      login.html, app.html (single page: stepper, history, admin), css/style.css, js/app.js, img/ (How-to screenshots)
netlify.toml                 publish=public, functions dir, /api/* -> /.netlify/functions/api/:splat, NODE_VERSION=20
netlify/functions/api.js     Express app via serverless-http (+ connectLambda for Blobs)
netlify/functions/convert-background.js   verifies HMAC token, calls runConversion(id)
server/app.js                Express app; mounts router at BOTH /api and /.netlify/functions/api; wraps async handlers
server/auth.js               bcrypt, signed HttpOnly cookie (ec_session, 12h), requireRole(), seeds first admin from env
server/store.js              Netlify Blobs wrapper (stores below)
server/figma.js              parse link, read frame, export image layers, simplified layer tree
server/ai.js                 generateEmailHtml() = the ONLY AI call; API or local `claude -p` (AI_PROVIDER=cli)
server/convert.js            runConversion(id): loads data, calls AI, saves html/status
server/defaults.js           DEFAULT_PROMPT (admin can override in settings)
server/fonts.js              injects brand @font-face rules into generated emails; server/email-fonts.css = the font source of truth
server/platforms/            index.js registry; pardot.js, hubspot.js; common.js (URL extraction, name matching, src swapping)
server/routes/               auth.js, users.js, settings.js, conversions.js
test/                        api.test.js (in-memory store, roles), matching.test.js, figma.test.js (mocked Figma API), fonts.test.js
```

## Blobs stores (server/store.js)
`users` (key=username) | `settings` (keys `brands`, `platforms`, `prompt`) | `conversions` (key=id, the record incl. status/html/finalHtml) |
`frames` (simplified Figma tree) | `images` (`<id>/<file>` + `<id>/_screenshot.png`) | `icons` (brand social icons by file name).
Conversion status: `processing` -> `ready` (html written) -> `finalised` (finalHtml written) or `error`.

## API (all under /api; roles checked on every route via requireRole)
- Auth: POST /login, POST /logout, GET /me, POST /me/password.
- Users (admin): GET/POST /users, PATCH /users/:name (role), POST /users/:name/password, DELETE /users/:name (cannot remove/demote last admin or self).
- Settings: GET /config (any user: brand names + platforms for dropdowns), GET/PUT /brands, POST /brands/icon, GET /icons/:name,
  GET/PUT /platforms, GET/PUT /prompt (the last four admin only).
- Conversions: POST / (admin, editor), GET / (admin all; editor own; viewer finished only), GET /:id (poll target),
  GET /:id/images/:name, GET /:id/zip (admin/editor), POST /:id/finalise, PUT /:id/final (save hand edits; strips `<script>`).
- Viewers never receive raw/final HTML or the zip, only `previewHtml`.

## Conversion flow (as implemented)
1. POST /conversions (60 s function): Figma step (or PNG upload, max 4 MB base64), saves images/frames to Blobs, creates the
   record with brand + platform-rules SNAPSHOTS, then POSTs to the background function (`DEPLOY_URL || URL || request host`).
2. Background function: token = HMAC(SESSION_SECRET, "convert:"+id) so only our API can trigger it. Calls `generateEmailHtml`.
3. Page polls GET /conversions/:id every 3 s (spinner shown) until status changes.
4. Step 2 shows the preview; images in the preview are served by `/api/conversions/:id/images/:name`.
5. Finalise (Pardot): paste the Pardot Files accordion HTML; see "Pardot behaviour" below; result stored as finalHtml.
6. Step 4: link editor + editable HTML; "Save edits" -> PUT /:id/final.

## Image export rules (server/figma.js)
- Any layer with an image fill is exported as ONE flattened 2x PNG, text/buttons on top included. Reason: overlay text on CSS
  background images breaks in Outlook and others. Claude is told (server/ai.js) to output a single `<img>` with the layer's text as
  alt text, wrapped in a link if a button is in it, and NOT to rebuild that text. (We tried "background only + live text": it
  doubled the text; rejected.)
- Names: `<email 30 chars>-<section 18 chars>-NN.png`, max ~55 chars (long names get truncated by Pardot). Max 40 image layers.
- Brand social icons (enabled ones with an uploaded file) are added to the zip and referenced by file name.
- Screenshot sent to Claude is scaled so no side exceeds ~7500 px (AI limit ~8000).

## Fonts (server/fonts.js, server/email-fonts.css)
- `server/email-fonts.css` is a verbatim copy of `Documents/Addium2026/Email Templates/style.css`: the ONLY place font URLs live.
  To change or add fonts, replace that file (families: AddiumSans 300-900 + italics, AddiumMono, AddiumSerif, hosted on addium.marketing).
- Claude is told (server/ai.js "## Fonts") to use the fallback stacks `FONT_STACKS` in inline font-family and NOT to write @font-face.
- After generation, `convert.js` calls `injectFonts(html)`: adds only the faces actually used (weights found in the HTML; italics only if used)
  in `<!--[if !mso]><!--> <style>...</style> <!--<![endif]-->` before `</head>`. Same convention as the Email Templates `CLAUDE.md`
  (Gmail and Outlook desktop ignore web fonts and use the fallbacks). Skipped if the HTML already has @font-face.
- Deploy: `netlify.toml` lists the css in `included_files` and `fonts.js` tries several paths. NOT yet verified on a real Netlify deploy:
  check the first deployed conversion contains the font block (a missing file only logs a warning and emails fall back to system fonts).

## Pardot behaviour (hard-won; do not "simplify" without re-testing with a real paste)
- Pardot rewrites hosted file names: `-` becomes `_`, and the name inside the URL is cut to about 68 characters.
- The pasted accordion HTML has one `accordion-group` per file, each with the ORIGINAL name (`<h4 class="media-heading">name - <a`,
  and `"name" was successfully uploaded`) and a `Location: <url>` line. `extractNamedFiles` pairs them exactly; that is the primary match.
- Fallback matching (`matchImages`): compare names with all separators removed, lower case, no extension; allow appended suffixes;
  longer names claim first; second pass accepts a URL that is a prefix of our name (>= 20 chars).
- `swapImageSrcs` replaces file names in `src="..."`, `url(...)` etc.; unmatched names are listed in the UI.
- If the user re-converts, file names change: the OLD Pardot paste will not match the NEW conversion (re-upload the new zip).
- HubSpot will behave differently. Each platform module can provide its own `extractImageUrls` / `extractNamedFiles`.

## Frontend (public/js/app.js)
- Converter is a 4-step stepper: 1 Setup, 2 Preview, 3 Image links, 4 Final HTML. `reached{}` controls which steps are clickable;
  viewers only get step 2. Role visibility uses `data-role="admin editor"` (class `.hidden`); step visibility uses `.step-panel.current`.
- Options: source (Figma link / PNG), brand, platform (HubSpot disabled until enabled in Platform rules), "White page background"
  tickbox (passed to Claude as a layout instruction), notes.
- Step 3 has a "How to" popup (`<dialog>`) using `public/img/guide-*.png` (Pardot-specific).
- Step 4 link editor: preview iframe is `sandbox="allow-same-origin"` (no scripts run) so the page can edit its DOM. Click image/link,
  or select text + "Add link to selection"; dialog sets href, new tab ON by default (`target=_blank rel="noopener noreferrer"`).
  Edits are serialised back into the textarea (editor-only `<style id="ec-editor-style">` is stripped). Browser serialisation may add
  `<tbody>` etc. The HTML box is also editable (preview refreshes after 500 ms). Unsaved-edit warnings on leave/new conversion.
- Admin: users, brands (social rows with URL/on/icon upload), platform rules, Claude prompt. Mobile-friendly hamburger drawer, avatar dropdown.

## UI look (public/css/style.css)
- Deliberately NOT Bootstrap-like (no framework at all, one hand-written stylesheet). Addium brand look: warm paper background `#f6f6f4`,
  ink `#373328`, accent green `#c3e2a3`, pill buttons and segmented pill toggles, soft 16px cards, small uppercase mono labels
  (AddiumMono) and AddiumSans for text. Colours/fonts are CSS variables at the top of the file.
- The app's pages load the brand fonts from `/api/fonts.css`, a route in `server/app.js` that serves `server/email-fonts.css`
  (the same single font source the generated emails use). The font host sends `access-control-allow-origin: *`, so cross-origin loading works.
- Verified by rendering the real pages in headless Chrome (puppeteer-core + a stub API) and viewing screenshots.

## Security notes
- Secrets only in server env vars; browser never sees them. Cookie is HttpOnly + SameSite=Lax (+ Secure on https). User re-loaded
  from storage each request, so role changes/removals apply immediately.
- Anything saved by editors is shown to other users, so previews are sandboxed and `<script>` is stripped on save. Keep both.
- `.env.example` MUST contain blank values only. GitHub push protection blocked a push once because a real Figma token had been
  put in it (history was rewritten before pushing). Real values go in `.env` (git-ignored). Never put secrets in `public/` (it is served openly).

## Environment variables
`FIGMA_TOKEN`, `ANTHROPIC_API_KEY`, `SESSION_SECRET` (random 16+ chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD` (seeds the first admin only
when there are no users). Optional: `AI_PROVIDER=cli` (local `claude -p`, LOCAL DEV ONLY), `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- On Netlify the app needs `ANTHROPIC_API_KEY`: the CLI option cannot work there, and users' own Claude Code installs are not reachable.

## Running locally (gotchas)
- `npm install`, copy `.env.example` to `.env` and fill it, then `npx netlify-cli dev --offline` -> http://localhost:8888.
  `--offline` is needed here: without it the proxy hung waiting on the Edge Functions setup (this app uses none).
- Blobs run in a local sandbox under netlify dev. `store.js` only requests "strong" consistency when NOT under netlify dev
  (`NETLIFY_DEV !== "true"`), because the local blobs context has no `uncachedEdgeURL` (it threw BlobsConsistencyError).
- Local blob data lives in `.netlify/blobs-serve/` (git-ignored).

## Limits
~6 MB Netlify request/response bodies (PNG upload 4 MB, zip 5.5 MB); 60 s for regular functions (huge Figma frames may time out);
background function 15 min; 40 image layers per email; PNG uploads have no layer data (Claude works from the picture only).

## How to rebuild from scratch (order)
1. Mockup (Prompt 1) -> approve it in the browser. 2. `package.json`, `netlify.toml`. 3. `server/util.js`, `store.js`, `auth.js`,
`platforms/*`, `defaults.js`. 4. `figma.js`, `ai.js`, `convert.js`. 5. Routes + `app.js`, then the two Netlify function wrappers.
6. Replace mock data in the frontend with `fetch('/api/...')` calls. 7. Tests (in-memory store for routes; mocked fetch for Figma).
8. README, `.env.example` (blanks), `.gitignore` (`.env`, `node_modules`, `.netlify`). Then re-apply the lessons in this section
(flattened images, Pardot pairing, sandboxed previews, consistency flag, `--offline`).

## Versioning and About page
- `package.json` `version` is the single source of truth (semantic versioning). `/api/config` returns it and the About page (`#view-about`, sidebar button next to Admin settings) shows it.
- Bump it on EVERY update with `npm version patch|minor|major --no-git-tag-version` (patch = fix, minor = new feature, major = breaking change), in the same commit as the change.
- The "Vibe coded by" credit lives on the About page (and the login page), not in the app footer.

## Future / ideas
HubSpot support (revisit file naming and finalise parsing); per-platform How-to popup; optional live HTML button below flattened
hero images (needs a layer-name convention); compress very large exports; deploy to Netlify once `ANTHROPIC_API_KEY` is available.

Built by Raymund Niconi (vibe coded with Claude Code).
