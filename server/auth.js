// Login sessions: a signed, HTTP-only cookie. Passwords are hashed with bcrypt.
// Every request re-loads the user from storage, so removing a user or changing a role takes effect immediately.
const bcrypt = require("bcryptjs");
const store = require("./store");
const { hmac, safeEqual } = require("./util");

const COOKIE = "ec_session";
const SESSION_HOURS = 12;
const ROLES = ["admin", "editor", "viewer"];

// ----- cookie token: base64url(payload).signature -----
function makeToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString("base64url");
  return payload + "." + hmac(payload);
}
function readToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? data.u : null;
  } catch {
    return null;
  }
}
function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function setSessionCookie(req, res, username) {
  const secure = req.protocol === "https" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeToken(username))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// ----- users -----
const userKey = (name) => String(name || "").trim().toLowerCase();
const publicUser = (u) => ({ username: u.username, role: u.role });

async function createUser(username, password, role) {
  const hash = await bcrypt.hash(password, 10);
  const user = { username: userKey(username), hash, role, createdAt: new Date().toISOString() };
  await store.setJSON("users", user.username, user);
  return user;
}

// First run: create the admin from environment variables if there are no users yet.
let seeded = false;
async function ensureSeedAdmin() {
  if (seeded) return;
  const keys = await store.listKeys("users");
  if (keys.length === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    await createUser(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, "admin");
  }
  seeded = true;
}

async function checkLogin(username, password) {
  const user = await store.getJSON("users", userKey(username));
  // Compare against a dummy hash when the user doesn't exist, so timing doesn't reveal valid usernames.
  const ok = await bcrypt.compare(String(password || ""), user ? user.hash : "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
  return user && ok ? user : null;
}

// ----- middleware -----
// Attaches req.user (or leaves it undefined).
async function loadUser(req, res, next) {
  try {
    const name = readToken(parseCookies(req.headers.cookie)[COOKIE]);
    if (name) req.user = (await store.getJSON("users", name)) || undefined;
    next();
  } catch (err) {
    next(err);
  }
}

// Use on every route: requireRole("admin", "editor") or requireRole() for "any logged-in user".
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Please sign in." });
    if (allowed.length && !allowed.includes(req.user.role)) return res.status(403).json({ error: "You don't have permission to do that." });
    next();
  };
}

module.exports = {
  ROLES, userKey, publicUser, createUser, ensureSeedAdmin, checkLogin,
  loadUser, requireRole, setSessionCookie, clearSessionCookie,
};
