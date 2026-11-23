// Admin only: manage users.
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const store = require("../store");
const auth = require("../auth");

router.use(auth.requireRole("admin"));

router.get("/", async (req, res) => {
  const keys = await store.listKeys("users");
  const users = await Promise.all(keys.map((k) => store.getJSON("users", k)));
  res.json({ users: users.filter(Boolean).map(auth.publicUser).sort((a, b) => a.username.localeCompare(b.username)) });
});

router.post("/", async (req, res) => {
  const { username, password, role } = req.body || {};
  const name = auth.userKey(username);
  if (!/^[a-z0-9._-]{2,32}$/.test(name)) return res.status(400).json({ error: "Username: 2-32 letters, numbers, . _ -" });
  if (String(password || "").length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (!auth.ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });
  if (await store.getJSON("users", name)) return res.status(409).json({ error: "That username already exists." });
  await auth.createUser(name, password, role);
  res.json({ ok: true });
});

async function admins() {
  const keys = await store.listKeys("users");
  const users = await Promise.all(keys.map((k) => store.getJSON("users", k)));
  return users.filter((u) => u && u.role === "admin");
}

router.patch("/:name", async (req, res) => {
  const user = await store.getJSON("users", auth.userKey(req.params.name));
  if (!user) return res.status(404).json({ error: "User not found." });
  const { role } = req.body || {};
  if (!auth.ROLES.includes(role)) return res.status(400).json({ error: "Invalid role." });
  if (user.role === "admin" && role !== "admin" && (await admins()).length <= 1) return res.status(400).json({ error: "You can't demote the last admin." });
  user.role = role;
  await store.setJSON("users", user.username, user);
  res.json({ ok: true });
});

router.post("/:name/password", async (req, res) => {
  const user = await store.getJSON("users", auth.userKey(req.params.name));
  if (!user) return res.status(404).json({ error: "User not found." });
  if (String((req.body || {}).password || "").length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  user.hash = await bcrypt.hash(req.body.password, 10);
  await store.setJSON("users", user.username, user);
  res.json({ ok: true });
});

router.delete("/:name", async (req, res) => {
  const user = await store.getJSON("users", auth.userKey(req.params.name));
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.username === req.user.username) return res.status(400).json({ error: "You can't remove your own account." });
  if (user.role === "admin" && (await admins()).length <= 1) return res.status(400).json({ error: "You can't remove the last admin." });
  await store.remove("users", user.username);
  res.json({ ok: true });
});

module.exports = router;
