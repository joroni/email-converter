// Brand web fonts for generated emails. The single source of truth is server/email-fonts.css
// (copied from the Email Templates folder's style.css). To change fonts, replace that file.
//
// After Claude writes the HTML we add ONLY the @font-face rules the email actually uses, inside an
// Outlook-safe block (the same convention as the existing Addium templates):
//   <!--[if !mso]><!--> <style> ...@font-face... </style> <!--<![endif]-->
// Gmail and Outlook desktop ignore web fonts and use the fallback stack in each font-family.
const fs = require("fs");
const path = require("path");

// Fallback stacks Claude must use (also given to it in server/ai.js).
const FONT_STACKS = {
  AddiumSans: "'AddiumSans','Helvetica Neue',Helvetica,Arial,sans-serif",
  AddiumMono: "'AddiumMono','Courier New',Courier,monospace",
  AddiumSerif: "'AddiumSerif',Georgia,'Times New Roman',serif",
};

let cached, rawCache;
function fontsFile() {
  const candidates = [
    path.join(__dirname, "email-fonts.css"),
    path.join(process.cwd(), "server", "email-fonts.css"),
    process.env.LAMBDA_TASK_ROOT && path.join(process.env.LAMBDA_TASK_ROOT, "server", "email-fonts.css"),
  ].filter(Boolean);
  return candidates.find((f) => fs.existsSync(f));
}

// The whole css file as text (served to the app's own pages so UI and emails share one font source).
function rawCss() {
  if (rawCache === undefined) {
    const file = fontsFile();
    rawCache = file ? fs.readFileSync(file, "utf8") : "";
  }
  return rawCache;
}

function loadFaces() {
  if (cached) return cached;
  const file = fontsFile();
  if (!file) {
    console.warn("email-fonts.css not found; emails will use fallback fonts only.");
    return (cached = []);
  }
  const css = fs.readFileSync(file, "utf8");
  cached = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
    const body = m[1];
    const get = (prop) => (body.match(new RegExp(prop + "\\s*:\\s*([^;]+);")) || [])[1];
    return {
      family: (get("font-family") || "").replace(/["']/g, "").trim(),
      weight: parseInt(get("font-weight"), 10) || 400,
      italic: /italic/i.test(get("font-style") || ""),
      css: "@font-face {" + body.replace(/\s+/g, " ").replace(/\s*;\s*/g, "; ").trim() + " }",
    };
  });
  return cached;
}

// Which weights does the email use? Always 400; plus any font-weight values found; "bold" means 700.
function usedWeights(html) {
  const w = new Set([400]);
  for (const m of html.matchAll(/font-weight\s*:\s*(\d{3}|bold|bolder|normal)/gi)) {
    const v = m[1].toLowerCase();
    w.add(v === "bold" || v === "bolder" ? 700 : v === "normal" ? 400 : parseInt(v, 10));
  }
  if (/<(b|strong|h[1-6])\b/i.test(html)) w.add(700);
  return w;
}

function injectFonts(html) {
  if (/@font-face/i.test(html) || !/<\/head>/i.test(html)) return html; // already has fonts, or no <head>
  const faces = loadFaces();
  const weights = usedWeights(html);
  const italic = /font-style\s*:\s*italic|<(em|i)\b/i.test(html);
  const picked = faces.filter((f) =>
    new RegExp(f.family, "i").test(html) && weights.has(f.weight) && (!f.italic || italic));
  if (!picked.length) return html;
  const block =
    "<!--[if !mso]><!-->\n<style>\n" + picked.map((f) => "  " + f.css).join("\n") + "\n</style>\n<!--<![endif]-->\n";
  return html.replace(/<\/head>/i, block + "</head>");
}

module.exports = { injectFonts, loadFaces, rawCss, FONT_STACKS };
