// The ONLY place that talks to an AI. Swap this function to change provider.
//
//   AI_PROVIDER=api  (default) -> Anthropic API using ANTHROPIC_API_KEY
//   AI_PROVIDER=cli            -> local Claude Code CLI ("claude -p"), for local development only
//
// generateEmailHtml({ prompt, brand, platform, notes, frameData, screenshot, imageNames, source })
//   -> Promise<string>  (the HTML document)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_FRAME_CHARS = 150000;

// Everything except the screenshot, as plain text.
function buildContext({ brand, platform, notes, frameData, imageNames, source }) {
  const parts = [];
  parts.push("## Brand profile\n" + JSON.stringify(brand, null, 2));
  parts.push("## Platform rules\n" + JSON.stringify(platform, null, 2));
  if (notes && notes.trim()) parts.push("## Notes for this email\n" + notes.trim());
  if (imageNames.length) {
    parts.push("## Exported image files (use these exact names as img src)\n" + imageNames.join("\n"));
  } else {
    parts.push("## Exported image files\nNone. Use only the brand's icon files; for other pictures leave a clearly sized placeholder cell.");
  }
  if (frameData) {
    let json = JSON.stringify(frameData);
    if (json.length > MAX_FRAME_CHARS) json = json.slice(0, MAX_FRAME_CHARS) + "...(truncated)";
    parts.push("## Figma layer data (simplified; box = [x, y, width, height])\n" + json);
  } else {
    parts.push("## Source\nA PNG exported from Figma (no layer data). Read the screenshot, and identify which social icons appear in it.");
  }
  return parts.join("\n\n");
}

// Remove ```html fences if the model added them anyway.
function cleanHtml(text) {
  let t = String(text).trim();
  const fenced = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.search(/<!doctype|<html/i);
  return start > 0 ? t.slice(start) : t;
}

async function viaApi(input) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
  const Anthropic = require("@anthropic-ai/sdk");
  const Client = Anthropic.default || Anthropic;
  const client = new Client();
  const content = [];
  if (input.screenshot) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: input.screenshot.toString("base64") } });
  }
  content.push({ type: "text", text: buildContext(input) });

  // Streaming keeps the long request alive; the background function allows up to 15 minutes.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: input.prompt,
    messages: [{ role: "user", content }],
  });
  const message = await stream.finalMessage();
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// Local Claude Code CLI. The screenshot is written to a temp folder so Claude can read it.
async function viaCli(input) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "email-converter-"));
  let text = input.prompt + "\n\n" + buildContext(input);
  if (input.screenshot) {
    fs.writeFileSync(path.join(dir, "design.png"), input.screenshot);
    text += "\n\nThe design screenshot is the file design.png in the current directory. Read it first.";
  }
  text += "\n\nReply with the HTML document only.";
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", "--allowedTools", "Read"], { cwd: dir });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("claude CLI timed out after 10 minutes.")); }, 10 * 60 * 1000);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(new Error("Could not run the claude CLI: " + e.message)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(out) : reject(new Error("claude CLI failed: " + (err || out).slice(0, 500)));
      });
      child.stdin.end(text);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function generateEmailHtml(input) {
  const provider = (process.env.AI_PROVIDER || "api").toLowerCase();
  const raw = provider === "cli" ? await viaCli(input) : await viaApi(input);
  const html = cleanHtml(raw);
  if (!/<html|<table/i.test(html)) throw new Error("The AI did not return HTML. Try again.");
  return html;
}

module.exports = { generateEmailHtml };
