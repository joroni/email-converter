// The slow Claude step. Called by the background function (up to 15 minutes allowed).
const store = require("./store");
const { generateEmailHtml } = require("./ai");
const { DEFAULT_PROMPT } = require("./defaults");

async function saveStatus(id, patch) {
  const conv = await store.getJSON("conversions", id);
  await store.setJSON("conversions", id, { ...conv, ...patch, updatedAt: new Date().toISOString() });
}

async function runConversion(id) {
  const conv = await store.getJSON("conversions", id);
  if (!conv) throw new Error("Conversion not found: " + id);
  if (conv.status !== "processing") return; // already handled (e.g. duplicate trigger)

  try {
    const prompt = (await store.getJSON("settings", "prompt")) || DEFAULT_PROMPT;
    const screenshot = await store.getBuffer("images", `${id}/_screenshot.png`);
    const frameData = await store.getJSON("frames", id);

    const html = await generateEmailHtml({
      prompt,
      brand: conv.brand,
      platform: conv.platformRules,
      notes: conv.notes,
      whiteBody: !!conv.whiteBody,
      frameData,
      screenshot,
      imageNames: conv.images.filter((i) => i.kind === "layer").map((i) => i.name),
      source: conv.source,
    });
    await saveStatus(id, { status: "ready", html, error: null });
  } catch (err) {
    console.error("Conversion failed", id, err);
    await saveStatus(id, { status: "error", error: String(err.message || err).slice(0, 500) });
  }
}

module.exports = { runConversion };
