const test = require("node:test");
const assert = require("node:assert");
const { extractImageUrls, matchImages, swapImageSrcs } = require("../server/platforms/common");
const { parseFigmaLink } = require("../server/figma");

test("extracts image URLs from pasted accordion HTML", () => {
  const html = `<div><a href="https://go.example.com/l/1/2026/hero-01_abc.png?x=1&amp;y=2">a</a>
    <span>https://go.example.com/l/1/logo-02.jpg</span><a href="https://x.com/page.html">no</a></div>`;
  const urls = extractImageUrls(html);
  assert.deepStrictEqual(urls, ["https://go.example.com/l/1/2026/hero-01_abc.png", "https://go.example.com/l/1/logo-02.jpg"]);
});

test("matches by original name, ignoring appended characters", () => {
  const urls = ["https://h/n-hero-10_x9.png", "https://h/n-hero-1_a1.png", "https://h/n-footer-02xyz.png"];
  const m = matchImages(["n-hero-01.png", "n-footer-02.png", "n-hero-1.png", "n-hero-10.png", "missing-03.png"], urls);
  assert.strictEqual(m["n-hero-10.png"], "https://h/n-hero-10_x9.png"); // longer name wins
  assert.strictEqual(m["n-hero-1.png"], "https://h/n-hero-1_a1.png");
  assert.strictEqual(m["n-footer-02.png"], "https://h/n-footer-02xyz.png");
  assert.strictEqual(m["missing-03.png"], undefined);
});

test("swaps src values, including paths and url()", () => {
  const html = `<img src="a-01.png"><img src='images/a-02.png'><td style="background:url(a-01.png)">`;
  const out = swapImageSrcs(html, { "a-01.png": "https://h/1.png", "a-02.png": "https://h/2.png" });
  assert.strictEqual(out, `<img src="https://h/1.png"><img src='https://h/2.png'><td style="background:url(https://h/1.png)">`);
});

test("parses Figma links", () => {
  assert.deepStrictEqual(parseFigmaLink("https://www.figma.com/design/ABC123/Newsletter?node-id=12-345&t=x"), { fileKey: "ABC123", nodeId: "12:345" });
  assert.throws(() => parseFigmaLink("https://www.figma.com/design/ABC123/Newsletter"), /node-id/);
  assert.throws(() => parseFigmaLink("https://evil.com/design/ABC123?node-id=1-2"), /figma\.com/);
  assert.throws(() => parseFigmaLink("nope"), /valid link/);
});
