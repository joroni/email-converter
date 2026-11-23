// Login, logout, current user, change own password.
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const store = require("../store");
const auth = require("../auth");

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = await auth.checkLogin(username, password);
  if (!user) return res.status(401).json({ error: "Wrong username or password." });
  auth.setSessionCookie(req, res, user.username);
  res.json({ user: auth.publicUser(user) });
});

router.post("/logout", (req, res) => {
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", auth.requireRole(), (req, res) => res.json({ user: auth.publicUser(req.user) }));

router.post("/me/password", auth.requireRole(), async (req, res) => {
  const { current, next } = req.body || {};
  if (!(await bcrypt.compare(String(current || ""), req.user.hash))) return res.status(400).json({ error: "Current password is wrong." });
  if (String(next || "").length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  req.user.hash = await bcrypt.hash(next, 10);
  await store.setJSON("users", req.user.username, req.user);
  res.json({ ok: true });
});

module.exports = router;
