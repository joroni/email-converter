// Image layers (including frames with text on top) are exported flattened.
const test = require("node:test");
const assert = require("node:assert");

process.env.FIGMA_TOKEN = "test";
const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
const jpg = Buffer.from("ffd8ffe000104a464946", "hex");

const frame = {
  id: "1:1", name: "Newsletter", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 1000 },
  children: [
    { id: "2:1", name: "hero", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 500 },
      fills: [{ type: "IMAGE", imageRef: "REF_HERO" }],
      children: [{ id: "2:2", name: "Headline", type: "TEXT", characters: "Ending the year strong", absoluteBoundingBox: { x: 10, y: 10, width: 500, height: 60 }, style: { fontFamily: "Inter", fontSize: 40 } }] },
    { id: "3:1", name: "logo", type: "RECTANGLE", absoluteBoundingBox: { x: 0, y: 600, width: 100, height: 50 }, fills: [{ type: "IMAGE", imageRef: "REF_LOGO" }] },
  ],
};

const calls = [];
global.fetch = async (url) => {
  url = String(url); calls.push(url);
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  if (url.includes("/files/KEY/nodes")) return json({ nodes: { "1:1": { document: frame } } });
  if (url.includes("/files/KEY/images")) return json({ meta: { images: { REF_HERO: "https://cdn/hero.jpg" } } });
  if (url.includes("/images/KEY")) {
    const ids = decodeURIComponent(url.match(/ids=([^&]+)/)[1]).split(",");
    return json({ images: Object.fromEntries(ids.map((i) => [i, "https://cdn/render-" + i + ".png"])) });
  }
  const body = url.includes("hero.jpg") ? jpg : png;
  return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};

const { readFrame } = require("../server/figma");

test("frame with a background photo and content is exported flattened, with its text kept for alt text", async () => {
  const r = await readFrame("https://www.figma.com/design/KEY/N?node-id=1-1");
  assert.deepStrictEqual(r.images.map((i) => i.name).sort(), ["newsletter-hero-01.png", "newsletter-logo-02.png"]);
  // the hero WAS rendered as a whole (text baked in on purpose)
  assert.ok(calls.some((u) => /\/images\/KEY.*ids=2%3A1/.test(u)));
  assert.ok(!calls.some((u) => u.includes("/files/KEY/images"))); // no raw-background fetch
  const hero = r.frameData.children[0];
  assert.strictEqual(hero.exportedImage, "newsletter-hero-01.png");
  assert.deepStrictEqual(hero.textInsideImage, ["Ending the year strong"]);
  assert.strictEqual(hero.children, undefined); // children are not passed on, so Claude can't rebuild them
});
