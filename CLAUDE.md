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