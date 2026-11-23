// The Express app. Netlify wraps it with serverless-http (see netlify/functions/api.js),
// so the same code can run on a normal server (EC2) later with app.listen().
const express = require("express");
const auth = require("./auth");
const { rawCss } = require("./fonts");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "5mb" }));
app.use(auth.loadUser);

// Seed the first admin from env vars on first use.
app.use(async (req, res, next) => {
  try { await auth.ensureSeedAdmin(); next(); } catch (err) { next(err); }
});

// Express 4 doesn't catch rejected promises by itself; wrap every handler.
function wrapAsync(router) {
  router.stack.forEach((layer) => {
    if (layer.route) {
      layer.route.stack.forEach((l) => {
        const fn = l.handle;
        if (fn.length <= 3) l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
      });
    }
  });
  return router;
}

// Brand @font-face rules for the app's own pages (public: just font URLs, no secrets).
app.get(["/api/fonts.css", "/.netlify/functions/api/fonts.css"], (req, res) => {
  res.type("text/css").set("Cache-Control", "public, max-age=86400").send(rawCss());
});

const api = express.Router();
api.use("/users", wrapAsync(require("./routes/users")));
api.use("/conversions", wrapAsync(require("./routes/conversions")));
api.use("/", wrapAsync(require("./routes/auth")));
api.use("/", wrapAsync(require("./routes/settings")));

// Reachable as /api/... (redirect) and /.netlify/functions/api/... (direct).
app.use("/api", api);
app.use("/.netlify/functions/api", api);

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// Last-resort error handler: log details, send a plain message.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: err.message && /SESSION_SECRET/.test(err.message) ? err.message : "Something went wrong on the server." });
});

module.exports = app;
