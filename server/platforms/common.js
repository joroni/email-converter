// Helpers shared by every platform module.
const { escapeRegex } = require("../util");

// Find every image URL in a pasted blob of HTML/text (works for any "list of hosted files" page).
function extractImageUrls(text) {
  const decoded = String(text).replace(/&amp;/g, "&");
  const re = /https?:\/\/[^\s"'<>()\\]+?\.(?:png|jpe?g|gif|webp|svg)(?=[\s"'<>()?#\\]|$)/gi;
  return [...new Set(decoded.match(re) || [])];
}

// "hero-image_abc123.png" -> "hero-image_abc123" (lower case, no extension, URL-decoded)
function baseName(nameOrUrl) {
  let last = String(nameOrUrl).split(/[?#]/)[0].split("/").pop();
  try { last = decodeURIComponent(last); } catch { /* keep as is */ }
  return last.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
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

module.exports = { extractImageUrls, matchImages, swapImageSrcs, baseName };
