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

test("real Pardot case: <img src> with underscores instead of hyphens", () => {
  const pasted = `<img class="media-object  img-polaroid" src="https://go.addium.io/l/1063872/2026-11-23/b6b8m7/1063872/1795434259G9dZLQAD/12_03_2026_ar_email_newsletter_december_hero_01.png" style="max-height:150px;max-width:150px;">`;
  const urls = extractImageUrls(pasted);
  assert.deepStrictEqual(urls, ["https://go.addium.io/l/1063872/2026-11-23/b6b8m7/1063872/1795434259G9dZLQAD/12_03_2026_ar_email_newsletter_december_hero_01.png"]);
  const name = "12-03-2026-ar-email-newsletter-december-hero-01.png";
  const m = matchImages([name], urls);
  assert.strictEqual(m[name], urls[0]);
  const out = swapImageSrcs(`<td style="background:url('${name}')"><img src="${name}" alt="x">`, m);
  assert.ok(!out.includes(name));
  assert.strictEqual(out.match(/https:\/\/go\.addium\.io[^"')]+/g).length, 2);
});

test("extracts protocol-relative and single-quoted src values", () => {
  assert.deepStrictEqual(extractImageUrls(`<img src='//go.x.com/a/b_01.PNG?v=2'>`), ["https://go.x.com/a/b_01.PNG"]);
});

test("prefers the Location: line over thumbnails", () => {
  const pasted = `<div><img src="https://go.addium.io/thumb/preview_hero.png">
    <h5>Location: <a href="https://go.addium.io/l/1/2026-11-23/b6b8mb/1/1795/aroya_icon_social.png" target="_blank">https://go.addium.io/l/1/2026-11-23/b6b8mb/1/1795/aroya_icon_social.png</a></h5></div>
    <div><h5>Location: <a href="https://go.addium.io/l/1/x/12_03_2026_ar_email_newsletter_december_hero_01.png">https://go.addium.io/l/1/x/12_03_2026_ar_email_newsletter_december_hero_01.png</a></h5></div>`;
  const urls = extractImageUrls(pasted);
  assert.deepStrictEqual(urls, [
    "https://go.addium.io/l/1/2026-11-23/b6b8mb/1/1795/aroya_icon_social.png",
    "https://go.addium.io/l/1/x/12_03_2026_ar_email_newsletter_december_hero_01.png",
  ]);
  const m = matchImages(["aroya-icon-social.png", "12-03-2026-ar-email-newsletter-december-hero-01.png"], urls);
  assert.strictEqual(Object.keys(m).length, 2);
});

test("matches names that the platform cut short", () => {
  const long = "12-03-2026-ar-email-newsletter-december-footer-stacked-center-row-for-content-co-04.png";
  const cut = "https://h/l/12_03_2026_ar_email_newsletter_december_footer_stacked_cent.png";
  assert.strictEqual(matchImages([long], [cut])[long], cut);
});

// Entries copied from a real Pardot upload (condensed): Pardot cut long names to ~68 characters.
const entry = (orig, url) => `
  <div class="accordion-group" id="file-accordion-x">
    <div class="accordion-heading file-upload"><a class="accordion-toggle" href="#c1">
        "${orig}" was successfully uploaded.
    </a></div>
    <div class="media"><a class="pull-left" href="${url}" target="_blank"><img class="media-object  img-polaroid" src="${url}" style="max-height:150px;"></a>
      <div class="media-body">
        <h4 class="media-heading">${orig} - <a href="/file/read/id/1" class="js-link">(edit)</a></h4>
        <h5>Location: <a href="${url}" target="_blank">${url}</a></h5>
        <h5>Short Url: <a href="" target="_blank"></a></h5>
      </div></div></div>`;

test("real Pardot accordion: truncated hosted names are paired by original name", () => {
  const { registry } = require("../server/platforms");
  const A = "https://go.addium.io/l/1063872/2026-11-23/";
  const files = {
    "12-03-2026-ar-email-newsletter-december-feature-1-aroya-device-store-02.png": A + "b6b8lx/x/12_03_2026_ar_email_newsletter_december_feature_1_aroya_device_store_.png",
    "12-03-2026-ar-email-newsletter-december-feature-2-aroya-x-growing-pains-link-htt-03.png": A + "b6b8lt/x/12_03_2026_ar_email_newsletter_december_feature_2_aroya_x_growing_pai.png",
    "12-03-2026-ar-email-newsletter-december-footer-stacked-center-row-for-content-co-04.png": A + "b6b8lq/x/12_03_2026_ar_email_newsletter_december_footer_stacked_center_row_for.png",
    "12-03-2026-ar-email-newsletter-december-hero-01.png": A + "b6b8m7/x/12_03_2026_ar_email_newsletter_december_hero_01.png",
    "aroya-icon-facebook.png": A + "b6b8m4/x/aroya_icon_facebook.png",
    "aroya-icon-instagram.png": A + "b6b8m1/x/aroya_icon_instagram.png",
    "aroya-icon-social.png": A + "b6b8mb/x/aroya_icon_social.png",
  };
  const pasted = `<div class="accordion" id="file-upload-accordion">` + Object.entries(files).map(([n, u]) => entry(n, u)).join("\n") + "</div>";
  const { resolveMatches } = require("../server/platforms/common");
  const m = resolveMatches(Object.keys(files), pasted, registry.pardot);
  assert.deepStrictEqual(m, files);
  // and a name Pardot didn't list stays unmatched
  assert.strictEqual(resolveMatches(["not-uploaded-05.png"], pasted, registry.pardot)["not-uploaded-05.png"], undefined);
});
