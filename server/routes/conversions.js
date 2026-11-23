// Conversions: start, list, view, images, zip, finalise.
// Access rules:
//   admin  -> everything
//   editor -> start conversions, see/download/finalise their own
//   viewer -> only view finished conversions (preview only, no downloads)
const router = require("express").Router();
const JSZip = require("jszip");
const store = require("../store");
const auth = require("../auth");
const figma = require("../figma");
const platforms = require("../platforms");
const { resolveMatches, swapImageSrcs } = require("../platforms/common");
const { hmac, newId, slug } = require("../util");

const MAX_PNG_BYTES = 4 * 1024 * 1024; // Netlify request bodies are limited to ~6 MB (base64 adds a third)

// ----- helpers -----
const isFinished = (c) => c.status === "ready" || c.status === "finalised";

// Can this user open this conversion at all?
function canView(user, conv) {
  if (user.role === "admin") return true;
  if (user.role === "editor") return conv.by === user.username;
  return isFinished(conv); // viewer
}
const canWork = (user, conv) => user.role === "admin" || (user.role === "editor" && conv.by === user.username);

async function loadConv(req, res, next) {
  const conv = await store.getJSON("conversions", req.params.id);
  if (!conv || !canView(req.user, conv)) return res.status(404).json({ error: "Conversion not found." });
  req.conv = conv;
  next();
}
function needWork(req, res, next) {
  if (!canWork(req.user, req.conv)) return res.status(403).json({ error: "You don't have permission to do that." });
  next();
}

const imageUrl = (id, name) => `/api/conversions/${id}/images/${encodeURIComponent(name)}`;

// What the browser gets. Viewers never get the raw HTML.
function present(conv, user) {
  const out = {
    id: conv.id, name: conv.name, title: conv.title || conv.name, brand: conv.brand.name, platform: conv.platform, source: conv.source,
    by: conv.by, status: conv.status, error: conv.error, createdAt: conv.createdAt,
    imageCount: conv.images.length,
  };
  if (isFinished(conv)) {
    // Preview: show hosted URLs if finalised; otherwise point file names at our own image route.
    const map = {};
    conv.images.forEach((i) => (map[i.name] = imageUrl(conv.id, i.name)));
    out.previewHtml = conv.status === "finalised" && conv.finalHtml ? conv.finalHtml : swapImageSrcs(conv.html, map);
    if (user.role !== "viewer") out.finalHtml = conv.finalHtml || null;
  }
  return out;
}

// ----- start a conversion (Figma step runs here; Claude step runs in the background function) -----
router.post("/", auth.requireRole("admin", "editor"), async (req, res) => {
  const body = req.body || {};
  const brands = (await store.getJSON("settings", "brands")) || [];
  const brand = brands.find((b) => b.name === body.brand);
  if (!brand) return res.status(400).json({ error: "Choose a brand. (An admin can add brands in Admin settings.)" });
  const rules = await platforms.getRules(body.platform);
  if (!rules || !rules.enabled) return res.status(400).json({ error: "That platform isn't available yet." });

  // Every conversion needs a name: it titles the History row and prefixes the exported file names.
  const title = String(body.emailName || "").trim().replace(/\s+/g, " ");
  if (title.length < 2 || title.length > 60) return res.status(400).json({ error: "Give this email a name (2-60 characters)." });

  const id = newId();
  let emailName, screenshot, frameData = null, layerImages = [];

  if (body.source === "figma") {
    try {
      ({ emailName, screenshot, frameData, images: layerImages } = await figma.readFrame(body.figmaLink, title));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  } else if (body.source === "png") {
    const png = Buffer.from(String(body.pngBase64 || ""), "base64");
    if (!png.length || png.length > MAX_PNG_BYTES) return res.status(400).json({ error: "Upload a PNG under 4 MB." });
    if (png.slice(0, 4).toString("hex") !== "89504e47") return res.status(400).json({ error: "That file isn't a PNG." });
    screenshot = png;
    emailName = slug(title, "email");
  } else {
    return res.status(400).json({ error: "Choose a Figma link or a PNG upload." });
  }

  // Save images + data to Blobs.
  await store.setBuffer("images", `${id}/_screenshot.png`, screenshot);
  if (frameData) await store.setJSON("frames", id, frameData);
  for (const img of layerImages) await store.setBuffer("images", `${id}/${img.name}`, img.buffer);

  // Brand icons used by this email travel with the images (they also need uploading to the platform).
  const icons = brand.socials.filter((s) => s.on && s.icon).map((s) => ({ name: s.icon, kind: "icon" }));
  const conv = {
    id, name: emailName, title, source: body.source, notes: String(body.notes || "").slice(0, 2000), whiteBody: !!body.whiteBody,
    brand, platform: body.platform, platformRules: rules, by: req.user.username,
    status: "processing", createdAt: new Date().toISOString(),
    images: [...layerImages.map((i) => ({ name: i.name, kind: "layer" })), ...icons],
  };
  await store.setJSON("conversions", id, conv);

  // Kick off the background function. It answers 202 straight away and keeps working.
  try {
    // Netlify sets DEPLOY_URL (this exact deploy) and URL (the site; localhost under "netlify dev").
    const origin = process.env.DEPLOY_URL || process.env.URL || `${req.protocol}://${req.get("host")}`;
    const r = await fetch(`${origin}/.netlify/functions/convert-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, token: hmac("convert:" + id) }),
    });
    if (!r.ok) throw new Error(`background function answered ${r.status}`);
  } catch (err) {
    console.error("Could not trigger background function", err.cause || err);
    await store.setJSON("conversions", id, { ...conv, status: "error", error: "Could not start the conversion: " + err.message });
    return res.status(500).json({ error: "Could not start the conversion. Please try again." });
  }
  res.status(202).json({ id });
});

// ----- list -----
router.get("/", auth.requireRole(), async (req, res) => {
  const keys = await store.listKeys("conversions");
  const all = (await Promise.all(keys.map((k) => store.getJSON("conversions", k)))).filter(Boolean);
  const rows = all.filter((c) => canView(req.user, c))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200)
    .map((c) => ({ id: c.id, name: c.name, title: c.title || c.name, brand: c.brand.name, platform: c.platform, by: c.by, status: c.status, createdAt: c.createdAt }));
  res.json({ conversions: rows });
});

// ----- one conversion (the page polls this while status is "processing") -----
router.get("/:id", auth.requireRole(), loadConv, (req, res) => res.json({ conversion: present(req.conv, req.user) }));

// ----- an image (for previews) -----
router.get("/:id/images/:name", auth.requireRole(), loadConv, async (req, res) => {
  const entry = req.conv.images.find((i) => i.name === req.params.name);
  if (!entry) return res.status(404).end();
  const buf = entry.kind === "icon" ? await store.getBuffer("icons", entry.name) : await store.getBuffer("images", `${req.conv.id}/${entry.name}`);
  if (!buf) return res.status(404).end();
  const ext = entry.name.split(".").pop();
  res.type(ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : "image/" + ext).send(buf);
});

// ----- zip of all images -----
router.get("/:id/zip", auth.requireRole("admin", "editor"), loadConv, needWork, async (req, res) => {
  const zip = new JSZip();
  for (const entry of req.conv.images) {
    const buf = entry.kind === "icon" ? await store.getBuffer("icons", entry.name) : await store.getBuffer("images", `${req.conv.id}/${entry.name}`);
    if (buf) zip.file(entry.name, buf);
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // Netlify function responses are capped at ~6 MB.
  if (out.length > 5.5 * 1024 * 1024) return res.status(413).json({ error: "The image zip is too large to download in one go." });
  res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${req.conv.name}-images.zip"` });
  res.end(out);
});

// ----- save hand edits to the final HTML (links added in the preview, or typed HTML) -----
router.put("/:id/final", auth.requireRole("admin", "editor"), loadConv, needWork, async (req, res) => {
  const conv = req.conv;
  if (conv.status !== "finalised") return res.status(400).json({ error: "Finalise the email first." });
  let html = String((req.body || {}).finalHtml || "");
  if (html.length < 20 || html.length > 2 * 1024 * 1024) return res.status(400).json({ error: "The HTML is empty or too large." });
  // Emails never need scripts, and this HTML is shown to other users, so drop them.
  html = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*>/gi, "");
  await store.setJSON("conversions", conv.id, { ...conv, finalHtml: html, updatedAt: new Date().toISOString() });
  res.json({ ok: true, finalHtml: html });
});

// ----- finalise: swap file names for the hosted URLs the user pasted back -----
router.post("/:id/finalise", auth.requireRole("admin", "editor"), loadConv, needWork, async (req, res) => {
  const conv = req.conv;
  if (!isFinished(conv)) return res.status(400).json({ error: "The conversion isn't ready yet." });
  const text = String((req.body || {}).accordionHtml || "");
  if (text.length < 10) return res.status(400).json({ error: "Paste the HTML first." });
  if (text.length > 2 * 1024 * 1024) return res.status(400).json({ error: "That paste is too large." });

  const mod = platforms.registry[conv.platform];
  if (!mod.extractImageUrls(text).length) return res.status(400).json({ error: "No image URLs found in that HTML. Copy the file list again from Inspector." });

  const names = conv.images.map((i) => i.name);
  const matches = resolveMatches(names, text, mod);
  const finalHtml = swapImageSrcs(conv.html, matches);
  await store.setJSON("conversions", conv.id, { ...conv, status: "finalised", finalHtml, updatedAt: new Date().toISOString() });
  res.json({
    finalHtml,
    matched: Object.keys(matches).length,
    unmatched: names.filter((n) => !matches[n]),
  });
});

module.exports = router;
