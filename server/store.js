// Thin wrapper around Netlify Blobs so the rest of the code never touches the SDK directly.
//
// Stores (like folders):
//   users         key = username            -> { username, hash, role, createdAt }
//   settings      key = brands|platforms|prompt
//   conversions   key = conversion id       -> conversion record (status, html, ...)
//   frames        key = conversion id       -> simplified Figma frame data (JSON)
//   images        key = <id>/<file name>    -> exported PNG layers (binary)
//   icons         key = icon file name      -> brand social icons (binary)
const { getStore } = require("@netlify/blobs");

// "strong" consistency so the polling page sees updates from the background function immediately.
const open = (name) => getStore({ name, consistency: "strong" });

async function getJSON(storeName, key) {
  return (await open(storeName).get(key, { type: "json" })) || null;
}
async function setJSON(storeName, key, value) {
  await open(storeName).setJSON(key, value);
}
async function getBuffer(storeName, key) {
  const ab = await open(storeName).get(key, { type: "arrayBuffer" });
  return ab ? Buffer.from(ab) : null;
}
async function setBuffer(storeName, key, buf) {
  // Blobs wants an ArrayBuffer, not a Node Buffer view.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await open(storeName).set(key, ab);
}
async function remove(storeName, key) {
  await open(storeName).delete(key);
}
async function listKeys(storeName, prefix) {
  const { blobs } = await open(storeName).list(prefix ? { prefix } : {});
  return blobs.map((b) => b.key);
}

module.exports = { getJSON, setJSON, getBuffer, setBuffer, remove, listKeys };
