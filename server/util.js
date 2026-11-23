// Small shared helpers.
const crypto = require("crypto");

// "My Hero Banner!" -> "my-hero-banner"
function slug(text, fallback = "item") {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

// Secret used for signing cookies and background-function tokens.
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (16+ characters).");
  return s;
}

function hmac(text) {
  return crypto.createHmac("sha256", secret()).update(text).digest("base64url");
}

// Constant-time string compare.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { slug, hmac, safeEqual, newId, escapeRegex };
