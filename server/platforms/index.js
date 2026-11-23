// Platform registry. Adding a platform = add a file here + list it below.
const store = require("../store");

const registry = {
  pardot: require("./pardot"),
  hubspot: require("./hubspot"),
};

// Defaults merged with whatever the admin saved. Returns { pardot: {label, enabled, unsubscribe, ...}, ... }
async function getAllRules() {
  const saved = (await store.getJSON("settings", "platforms")) || {};
  const out = {};
  for (const [id, mod] of Object.entries(registry)) {
    out[id] = { label: mod.label, ...mod.defaults, ...(saved[id] || {}) };
  }
  return out;
}

async function getRules(id) {
  const all = await getAllRules();
  return all[id] || null;
}

// Admin save: only accept known platforms and known fields.
async function saveRules(input) {
  const saved = (await store.getJSON("settings", "platforms")) || {};
  for (const id of Object.keys(registry)) {
    const p = input[id];
    if (!p) continue;
    saved[id] = {
      enabled: !!p.enabled,
      unsubscribe: String(p.unsubscribe || "").trim(),
      mergeTags: (Array.isArray(p.mergeTags) ? p.mergeTags : []).map((t) => String(t).trim()).filter(Boolean),
      imageHost: String(p.imageHost || registry[id].defaults.imageHost).trim(),
    };
  }
  await store.setJSON("settings", "platforms", saved);
}

module.exports = { registry, getAllRules, getRules, saveRules };
