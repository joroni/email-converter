// Brands, platform rules, Claude prompt, brand icons.
// Everyone logged in can read the dropdown options (/config); only admins read/write the full settings.
const router = require("express").Router();
const store = require("../store");
const auth = require("../auth");
const platforms = require("../platforms");
const { DEFAULT_PROMPT } = require("../defaults");
const { slug } = require("../util");

const ICON_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp" };

async function getBrands() {
  return (await store.getJSON("settings", "brands")) || [];
}

// ----- Options for the main page dropdowns (no secrets) -----
router.get("/config", auth.requireRole(), async (req, res) => {
  const brands = await getBrands();
  const rules = await platforms.getAllRules();
  res.json({
    version: require("../../package.json").version, // shown on the About page
    brands: brands.map((b) => b.name),
    platforms: Object.entries(rules).map(([id, p]) => ({ id, label: p.label, enabled: p.enabled })),
  });
});

// ----- Brands -----
router.get("/brands", auth.requireRole("admin"), async (req, res) => res.json({ brands: await getBrands() }));

router.put("/brands", auth.requireRole("admin"), async (req, res) => {
  const input = Array.isArray((req.body || {}).brands) ? req.body.brands : null;
  if (!input) return res.status(400).json({ error: "brands must be a list." });
  const seen = new Set();
  const clean = [];
  for (const b of input) {
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Every brand needs a name." });
    if (seen.has(name.toLowerCase())) return res.status(400).json({ error: `Duplicate brand: ${name}` });
    seen.add(name.toLowerCase());
    clean.push({
      name,
      privacy: String(b.privacy || "").trim(),
      address: String(b.address || "").trim(),
      socials: (Array.isArray(b.socials) ? b.socials : []).map((s) => ({
        network: String(s.network || "").trim(),
        url: String(s.url || "").trim(),
        on: !!s.on,
        icon: s.icon ? String(s.icon) : null, // file name in the icons store
      })).filter((s) => s.network),
    });
  }
  await store.setJSON("settings", "brands", clean);
  res.json({ ok: true });
});

// Upload a social icon. Body: { brand, network, contentType, dataBase64 } -> { icon: "file name" }
router.post("/brands/icon", auth.requireRole("admin"), async (req, res) => {
  const { brand, network, contentType, dataBase64 } = req.body || {};
  const ext = ICON_TYPES[contentType];
  if (!ext) return res.status(400).json({ error: "Icon must be PNG, JPG, GIF, SVG or WebP." });
  const buf = Buffer.from(String(dataBase64 || ""), "base64");
  if (!buf.length || buf.length > 500 * 1024) return res.status(400).json({ error: "Icon must be under 500 KB." });
  const name = `${slug(brand, "brand")}-icon-${slug(network, "social")}.${ext}`;
  await store.setBuffer("icons", name, buf);
  res.json({ icon: name });
});

router.get("/icons/:name", auth.requireRole(), async (req, res) => {
  const name = req.params.name;
  const buf = await store.getBuffer("icons", name);
  if (!buf) return res.status(404).end();
  const ext = name.split(".").pop();
  const type = Object.keys(ICON_TYPES).find((t) => ICON_TYPES[t] === ext) || "application/octet-stream";
  res.type(type).send(buf);
});

// ----- Platform rules -----
router.get("/platforms", auth.requireRole("admin"), async (req, res) => res.json({ platforms: await platforms.getAllRules() }));
router.put("/platforms", auth.requireRole("admin"), async (req, res) => {
  await platforms.saveRules((req.body || {}).platforms || {});
  res.json({ ok: true });
});

// ----- Claude prompt (admin only; never sent to other roles) -----
router.get("/prompt", auth.requireRole("admin"), async (req, res) => {
  res.json({ prompt: (await store.getJSON("settings", "prompt")) || DEFAULT_PROMPT });
});
router.put("/prompt", auth.requireRole("admin"), async (req, res) => {
  const prompt = String((req.body || {}).prompt || "").trim();
  if (prompt.length < 20) return res.status(400).json({ error: "Prompt is too short." });
  await store.setJSON("settings", "prompt", prompt);
  res.json({ ok: true });
});

module.exports = router;
