const test = require("node:test");
const assert = require("node:assert");
const { injectFonts, loadFaces } = require("../server/fonts");

test("parses every @font-face in email-fonts.css", () => {
  const faces = loadFaces();
  assert.strictEqual(faces.length, 11);
  assert.ok(faces.every((f) => f.family && f.css.startsWith("@font-face")));
});

const email = `<!DOCTYPE html><html><head><title>t</title></head><body>
<p style="font-family:'AddiumSans','Helvetica Neue',Arial,sans-serif;font-weight:500">Hi</p>
<p style="font-family:'AddiumSans',Arial;font-weight:700">Bold</p>
<p style="font-family:'AddiumMono','Courier New',monospace">EYEBROW</p></body></html>`;

test("adds only the faces the email uses, in an Outlook-safe block before </head>", () => {
  const out = injectFonts(email);
  assert.match(out, /<!--\[if !mso\]><!-->\s*<style>[\s\S]*<\/style>\s*<!--<!\[endif\]-->\s*<\/head>/);
  const css = out.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.strictEqual((css.match(/@font-face/g) || []).length, 4); // Sans 400/500/700 + Mono 400
  assert.ok(css.includes("AddiumMono") && !css.includes("AddiumSerif"));
  assert.ok(!/font-weight:\s*(300|800|900)/.test(css) && !/italic/.test(css));
  assert.ok(css.includes("https://addium.marketing/fonts/"));
});

test("does nothing twice, without a <head>, or when no brand font is used", () => {
  const once = injectFonts(email);
  assert.strictEqual(injectFonts(once), once);
  assert.strictEqual(injectFonts("<p style=\"font-family:'AddiumSans'\">x</p>"), "<p style=\"font-family:'AddiumSans'\">x</p>");
  const plain = "<html><head></head><body style='font-family:Arial'>x</body></html>";
  assert.strictEqual(injectFonts(plain), plain);
});
