// Integration test of the Express app with an in-memory store (no Netlify needed).
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

process.env.SESSION_SECRET = "test-secret-test-secret";
process.env.ADMIN_USERNAME = "boss";
process.env.ADMIN_PASSWORD = "bosspassword";

// Replace the Blobs-backed store with a Map.
const mem = {};
const bucket = (n) => (mem[n] = mem[n] || new Map());
const store = require("../server/store");
Object.assign(store, {
  getJSON: async (s, k) => (bucket(s).has(k) ? JSON.parse(bucket(s).get(k)) : null),
  setJSON: async (s, k, v) => bucket(s).set(k, JSON.stringify(v)),
  getBuffer: async (s, k) => bucket(s).get(k) || null,
  setBuffer: async (s, k, b) => bucket(s).set(k, b),
  remove: async (s, k) => bucket(s).delete(k),
  listKeys: async (s) => [...bucket(s).keys()],
});

const app = require("../server/app");
let server, base;
test.before(() => new Promise((r) => { server = http.createServer(app).listen(0, () => { base = "http://127.0.0.1:" + server.address().port; r(); }); }));
test.after(() => server.close());

async function call(method, path, body, cookie) {
  const res = await fetch(base + "/api" + path, {
    method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: (res.headers.get("set-cookie") || "").split(";")[0] };
}
const login = async (u, p) => (await call("POST", "/login", { username: u, password: p })).cookie;

test("auth, roles and conversions access", async () => {
  assert.strictEqual((await call("GET", "/me")).status, 401);
  assert.strictEqual((await call("POST", "/login", { username: "boss", password: "wrong" })).status, 401);

  const admin = await login("boss", "bosspassword");
  assert.strictEqual((await call("GET", "/me", null, admin)).data.user.role, "admin");

  // password is stored hashed
  assert.match(JSON.parse(bucket("users").get("boss")).hash, /^\$2[aby]\$/);

  // admin creates an editor and a viewer
  assert.strictEqual((await call("POST", "/users", { username: "ed", password: "editorpass1", role: "editor" }, admin)).status, 200);
  assert.strictEqual((await call("POST", "/users", { username: "vi", password: "viewerpass1", role: "viewer" }, admin)).status, 200);
  const ed = await login("ed", "editorpass1");
  const vi = await login("vi", "viewerpass1");

  // non-admins can't touch admin routes
  for (const c of [ed, vi]) {
    assert.strictEqual((await call("GET", "/users", null, c)).status, 403);
    assert.strictEqual((await call("GET", "/prompt", null, c)).status, 403);
    assert.strictEqual((await call("PUT", "/brands", { brands: [] }, c)).status, 403);
  }
  // viewers can't start conversions; editors need a valid brand
  assert.strictEqual((await call("POST", "/conversions", { source: "figma" }, vi)).status, 403);
  assert.strictEqual((await call("POST", "/conversions", { source: "figma" }, ed)).status, 400);

  // last admin protections
  assert.strictEqual((await call("DELETE", "/users/boss", null, admin)).status, 400);
  assert.strictEqual((await call("PATCH", "/users/boss", { role: "viewer" }, admin)).status, 400);

  // brands + platforms
  await call("PUT", "/brands", { brands: [{ name: "Aqualab", privacy: "p", address: "a", socials: [{ network: "LinkedIn", url: "u", on: true }] }] }, admin);
  const cfg = (await call("GET", "/config", null, ed)).data;
  assert.deepStrictEqual(cfg.brands, ["Aqualab"]);
  assert.strictEqual(cfg.platforms.find((p) => p.id === "hubspot").enabled, false);
  assert.strictEqual((await call("POST", "/conversions", { source: "png", brand: "Aqualab", platform: "hubspot" }, ed)).status, 400);

  // an email name is required
  const noName = await call("POST", "/conversions", { source: "png", brand: "Aqualab", platform: "pardot" }, ed);
  assert.strictEqual(noName.status, 400);
  assert.match(noName.data.error, /name/i);
  assert.strictEqual((await call("POST", "/conversions", { source: "png", brand: "Aqualab", platform: "pardot", emailName: " " }, ed)).status, 400);

  // visibility: seed conversions directly
  const mk = (id, by, status) => ({ id, name: id, by, status, brand: { name: "Aqualab" }, platform: "pardot", images: [], html: "<table></table>", createdAt: "2026-01-01T00:00:00Z" });
  await store.setJSON("conversions", "c1", mk("c1", "ed", "ready"));
  await store.setJSON("conversions", "c2", mk("c2", "boss", "ready"));
  await store.setJSON("conversions", "c3", mk("c3", "ed", "processing"));
  const ids = async (c) => (await call("GET", "/conversions", null, c)).data.conversions.map((x) => x.id).sort();
  assert.deepStrictEqual(await ids(admin), ["c1", "c2", "c3"]);
  assert.deepStrictEqual(await ids(ed), ["c1", "c3"]);
  assert.deepStrictEqual(await ids(vi), ["c1", "c2"]);
  assert.strictEqual((await call("GET", "/conversions/c2", null, ed)).status, 404);
  assert.strictEqual((await call("GET", "/conversions/c3", null, vi)).status, 404);
  const viewerView = (await call("GET", "/conversions/c1", null, vi)).data.conversion;
  assert.ok(viewerView.previewHtml && viewerView.finalHtml === undefined && viewerView.html === undefined);
  assert.strictEqual((await call("GET", "/conversions/c1/zip", null, vi)).status, 403);
  assert.strictEqual((await call("POST", "/conversions/c1/finalise", { accordionHtml: "x".repeat(20) }, vi)).status, 403);

  // finalise (editor, own conversion)
  const conv = mk("c4", "ed", "ready");
  conv.html = '<img src="n-hero-01.png">';
  conv.images = [{ name: "n-hero-01.png", kind: "layer" }];
  await store.setJSON("conversions", "c4", conv);
  const fin = await call("POST", "/conversions/c4/finalise", { accordionHtml: '<a href="https://go.x.com/n-hero-01_ab12.png">f</a>' }, ed);
  assert.strictEqual(fin.data.finalHtml, '<img src="https://go.x.com/n-hero-01_ab12.png">');
  assert.deepStrictEqual(fin.data.unmatched, []);

  // editing the final HTML: owner can save, scripts are stripped, others are refused
  const edited = '<html><body><a href="https://x.com" target="_blank">hi</a><script>alert(1)</script></body></html>';
  const saved = await call("PUT", "/conversions/c4/final", { finalHtml: edited }, ed);
  assert.strictEqual(saved.status, 200);
  assert.ok(saved.data.finalHtml.includes('target="_blank"') && !saved.data.finalHtml.includes("<script"));
  assert.strictEqual((await call("PUT", "/conversions/c4/final", { finalHtml: edited }, vi)).status, 403);
  assert.strictEqual((await call("PUT", "/conversions/c1/final", { finalHtml: edited }, ed)).status, 400); // not finalised yet
  assert.ok(!(await call("GET", "/conversions/c4", null, admin)).data.conversion.previewHtml.includes("<script"));

  // removing a user kills their session immediately
  await call("DELETE", "/users/vi", null, admin);
  assert.strictEqual((await call("GET", "/me", null, vi)).status, 401);

  // tampered cookie is rejected
  assert.strictEqual((await call("GET", "/me", null, ed.slice(0, -2) + "xx")).status, 401);
});
