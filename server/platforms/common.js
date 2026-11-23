// Helpers shared by every platform module.
const { escapeRegex } = require("../util");

const IMG_EXT = "(?:png|jpe?g|gif|webp|svg)";

// URLs that follow a "Location:" label (as link text or as an href), in order.
function extractLocations(decoded) {
  const out = [];
  const parts = decoded.split(/Location:/i).slice(1);
  for (const part of parts) {
    const chunk = part.slice(0, 800); // stay inside this file's entry
    const m = chunk.match(new RegExp(`(?:href\\s*=\\s*["'])?\\s*((?:https?:)?//[^\\s"'<>()\\\\]+?\\.${IMG_EXT})(?=[\\s"'<>()?#\\\\]|$)`, "i"));
    if (m) out.push(m[1].replace(/^\/\//, "https://"));
  }
  return [...new Set(out)];
}

// Find every hosted image URL in a pasted blob of HTML/text.
// 1) Read src / href / data-src attribute values (what the Inspector copies: <img src="...">).
// 2) Also catch bare URLs anywhere in the text.
// Protocol-relative values ("//go.example.com/x.png") become https://. Relative values are kept as they are.
function extractImageUrls(text) {
  const decoded = String(text).replace(/&amp;/g, "&");
  // Pardot's file list shows each file's real address on a "Location: <url>" line, while the
  // <img> thumbnails can be previews. When those lines exist they are the source of truth.
  const located = extractLocations(decoded);
  if (located.length) return located;
  const found = [];
  const add = (u) => {
    u = u.trim().replace(/^\/\//, "https://");
    if (new RegExp(`\\.${IMG_EXT}(?:[?#].*)?$`, "i").test(u)) found.push(u.split(/[?#]/)[0]);
  };

  for (const m of decoded.matchAll(/\b(?:src|href|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) add(m[1] ?? m[2]);
  for (const m of decoded.matchAll(new RegExp(`https?://[^\\s"'<>()\\\\]+?\\.${IMG_EXT}(?=[\\s"'<>()?#\\\\]|$)`, "gi"))) add(m[0]);
  return [...new Set(found)];
}

// Comparison key: "12_03_Hero-01_ab12.png" -> "1203hero01ab12" (lower case, no extension, URL-decoded,
// every separator removed), because platforms rewrite "-" to "_" and append characters.
function baseName(nameOrUrl) {
  let last = String(nameOrUrl).split(/[?#]/)[0].split("/").pop();
  try { last = decodeURIComponent(last); } catch { /* keep as is */ }
  return last.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Pardot-style accordion: one "accordion-group" per uploaded file. Each has the ORIGINAL file name
// (in the heading and in '"name.png" was successfully uploaded') next to its Location URL, so we can
// pair them exactly, even though the hosted URL has a rewritten, shortened name.
function extractNamedFiles(text) {
  const decoded = String(text).replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  const pairs = [];
  for (const chunk of decoded.split(/class\s*=\s*["']accordion-group["']/i).slice(1)) {
    const url = extractLocations(chunk)[0];
    const nameMatch =
      chunk.match(/<h4[^>]*media-heading[^>]*>\s*([^<]+?)\s+-\s*<a/i) ||
      chunk.match(new RegExp(`"([^"<>]+\\.${IMG_EXT})"\\s+was successfully uploaded`, "i"));
    if (url && nameMatch) pairs.push({ name: nameMatch[1].trim(), url });
  }
  return pairs;
}

// Best-effort matching of our exported names to what was pasted:
// 1) exact original-name pairs (when the platform's paste includes them), 2) fuzzy name matching.
function resolveMatches(fileNames, text, mod) {
  const matches = {};
  const pairs = mod.extractNamedFiles ? mod.extractNamedFiles(text) : [];
  for (const { name, url } of pairs) {
    const ours = fileNames.find((n) => n.toLowerCase() === name.toLowerCase());
    if (ours && !matches[ours]) matches[ours] = url;
  }
  const taken = new Set(Object.values(matches));
  const rest = matchImages(fileNames.filter((n) => !matches[n]), mod.extractImageUrls(text).filter((u) => !taken.has(u)));
  return { ...matches, ...rest };
}

// Match each exported file name to a hosted URL.
// Platforms append extra characters to file names, so we accept "starts with the original name".
// Longer names claim their URL first, so "hero-10" isn't stolen by "hero-1".
function matchImages(fileNames, urls) {
  const taken = new Set();
  const matches = {};
  const ordered = [...fileNames].sort((a, b) => baseName(b).length - baseName(a).length);
  for (const name of ordered) {
    const nb = baseName(name);
    const candidates = urls
      .filter((u) => !taken.has(u) && baseName(u).startsWith(nb))
      .sort((a, b) => baseName(a).length - baseName(b).length); // closest match first
    if (candidates.length) {
      matches[name] = candidates[0];
      taken.add(candidates[0]);
    }
  }
  // Second pass: some platforms cut long file names short. For names still unmatched, accept an unused
  // URL whose (long enough) name is the beginning of ours; the longest such URL wins.
  for (const name of ordered) {
    if (matches[name]) continue;
    const nb = baseName(name);
    const candidates = urls
      .filter((u) => !taken.has(u) && baseName(u).length >= 20 && nb.startsWith(baseName(u)))
      .sort((a, b) => baseName(b).length - baseName(a).length);
    if (candidates.length) {
      matches[name] = candidates[0];
      taken.add(candidates[0]);
    }
  }
  return matches;
}

// Replace file-name references in HTML (src="x.png", url(x.png), ...) with new URLs.
function swapImageSrcs(html, mapping) {
  let out = html;
  for (const [name, url] of Object.entries(mapping)) {
    const re = new RegExp(`(["'(])((?:[^"'()\\s]*/)?)${escapeRegex(name)}(?=["')])`, "g");
    out = out.replace(re, (_m, quote) => quote + url);
  }
  return out;
}

module.exports = { extractImageUrls, extractNamedFiles, resolveMatches, matchImages, swapImageSrcs, baseName };
