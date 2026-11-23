// Reads a Figma frame through the REST API and exports its image layers as 2x PNGs.
// Needs FIGMA_TOKEN (server environment variable, never sent to the browser).
const { slug } = require("./util");

const API = "https://api.figma.com/v1";
const MAX_IMAGES = 40;
const MAX_NODES = 700;

async function figma(path) {
  if (!process.env.FIGMA_TOKEN) throw new Error("FIGMA_TOKEN is not set on the server.");
  const res = await fetch(API + path, { headers: { "X-Figma-Token": process.env.FIGMA_TOKEN } });
  if (res.status === 403) throw new Error("Figma refused the token (403). Check FIGMA_TOKEN has access to this file.");
  if (res.status === 404) throw new Error("Figma file or frame not found (404). Check the link.");
  if (!res.ok) throw new Error(`Figma API error ${res.status}.`);
  return res.json();
}

// https://www.figma.com/design/FILEKEY/Name?node-id=12-345  ->  { fileKey, nodeId: "12:345" }
function parseFigmaLink(link) {
  let url;
  try { url = new URL(String(link).trim()); } catch { throw new Error("That doesn't look like a valid link."); }
  if (!/figma\.com$/.test(url.hostname)) throw new Error("The link must be a figma.com link.");
  const m = url.pathname.match(/\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  const node = url.searchParams.get("node-id");
  if (!m || !node) throw new Error('Use "Copy link to selection" on the frame so the link includes a node-id.');
  return { fileKey: m[1], nodeId: node.replace("-", ":") };
}

const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const hasImageFill = (n) => Array.isArray(n.fills) && n.fills.some((f) => f.type === "IMAGE" && f.visible !== false);

// All visible text inside a layer, in reading order (used for the image's alt text).
function collectText(node, out = []) {
  if (node.visible === false) return out;
  if (node.type === "TEXT" && node.characters && node.characters.trim()) out.push(node.characters.trim());
  (node.children || []).forEach((c) => collectText(c, out));
  return out;
}

// Walk the tree once: build a compact description for Claude and collect image layers to export.
function walk(frame) {
  const origin = frame.absoluteBoundingBox || { x: 0, y: 0 };
  const layers = []; // { id, section }
  let count = 0;

  function simplify(node, section, insideImage) {
    if (node.visible === false || ++count > MAX_NODES) return null;
    const box = node.absoluteBoundingBox;
    const out = { name: node.name, type: node.type };
    if (box) out.box = [box.x - origin.x, box.y - origin.y, box.width, box.height].map(Math.round);
    const solid = (node.fills || []).find((f) => f.type === "SOLID" && f.visible !== false);
    if (solid) out.fill = hex(solid.color);
    if (node.cornerRadius) out.radius = node.cornerRadius;
    if (node.layoutMode) out.layout = { mode: node.layoutMode, gap: node.itemSpacing, pad: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft] };
    if (node.type === "TEXT") {
      out.text = node.characters;
      const s = node.style || {};
      out.font = { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, align: s.textHorizontalAlignment, lineHeight: s.lineHeightPx && Math.round(s.lineHeightPx) };
    }
    // A layer with a picture fill is exported as ONE flattened image, exactly as it looks in Figma
    // (text and buttons on top included). Overlay text on a background image breaks in many email
    // clients (Outlook ignores CSS backgrounds), so we keep it as a picture and let Claude give it
    // alt text and a link instead of rebuilding the text.
    if (!insideImage && hasImageFill(node) && layers.length < MAX_IMAGES) {
      const texts = collectText(node);
      out.exportedImage = true;
      if (texts.length) out.textInsideImage = texts;
      layers.push({ id: node.id, section, node: out });
      return out;
    }
    if (node.children) out.children = node.children.map((c) => simplify(c, section, insideImage)).filter(Boolean);
    return out;
  }

  // Top-level children are the "sections" (header, hero, footer...). Used in image file names.
  const tree = { name: frame.name, type: frame.type, box: [0, 0, ...[origin.width, origin.height].map(Math.round)], children: [] };
  for (const child of frame.children || []) {
    const t = simplify(child, slug(child.name, "section"), false);
    if (t) tree.children.push(t);
  }
  return { tree, layers, width: origin.width, height: origin.height };
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download an exported image (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

// Main entry. Returns { emailName, frameData, screenshot (Buffer), images: [{ name, buffer }] }
async function readFrame(link, emailNameOverride) {
  const { fileKey, nodeId } = parseFigmaLink(link);
  const data = await figma(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`);
  const entry = data.nodes && data.nodes[nodeId];
  if (!entry) throw new Error("Frame not found in that file.");
  const frame = entry.document;

  const emailName = slug(emailNameOverride || frame.name, "email");
  const { tree, layers, width, height } = walk(frame);

  // Screenshot of the whole frame for Claude (scaled down if very tall; the AI limit is ~8000px).
  const shotScale = Math.min(1, 7500 / Math.max(width || 1, height || 1));
  const shot = await figma(`/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${shotScale.toFixed(3)}`);
  const screenshot = await download(shot.images[nodeId]);

  const images = [];
  const used = new Set();
  const uniqueName = (section) => {
    let n = images.length + 1, name;
    do { name = `${emailName.slice(0, 30)}-${section.slice(0, 18)}-${String(n++).padStart(2, "0")}`.replace(/-+/g, "-"); } while (used.has(name));
    used.add(name);
    return name;
  };

  // Every image layer, rendered at 2x, in small batches to keep URLs short.
  for (let i = 0; i < layers.length; i += 15) {
    const batch = layers.slice(i, i + 15);
    const ids = batch.map((l) => l.id).join(",");
    const out = await figma(`/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=2`);
    for (const layer of batch) {
      const url = out.images && out.images[layer.id];
      if (!url) continue;
      const name = uniqueName(layer.section) + ".png"; // <email>-<section>-<number>.png
      layer.node.exportedImage = name;
      images.push({ name, buffer: await download(url) });
    }
  }
  return { emailName, frameData: tree, screenshot, images };
}

module.exports = { readFrame, parseFigmaLink };
