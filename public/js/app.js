// Email Converter - frontend. Plain JavaScript, talks to the /api/* routes.
// The server decides what each role may do; the page only hides what a role can't use.

const $ = (id) => document.getElementById(id);
let me = null;          // { username, role }
let config = null;      // { brands: [...], platforms: [{id,label,enabled}] }
let platform = "pardot";
let source = "figma";
let currentId = null;   // conversion shown on the converter page
let pollTimer = null;

// ---------- Helpers ----------
const show = (el, yes) => el.classList.toggle("hidden", !yes);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Call the API. Sends the cookie automatically; JSON in, JSON out; throws Error(message) on failure.
async function api(path, method = "GET", body) {
  const res = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = "login.html"; throw new Error("Please sign in."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

// Show a spinner + message (used while something is running). Clear it with el.textContent = "".
function busy(el, text) {
  el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span>`;
}

function flash(el, text, ms = 2500) {
  el.textContent = text;
  if (ms) setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, ms);
}

// Read a file as base64 (without the "data:...;base64," prefix).
const readBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(new Error("Could not read the file."));
  r.readAsDataURL(file);
});

// ---------- Roles ----------
// Elements with data-role="admin editor" are only shown to those roles.
function applyRole() {
  document.querySelectorAll("[data-role]").forEach((el) => show(el, el.dataset.role.split(" ").includes(me.role)));
  document.querySelectorAll("[data-show-role]").forEach((el) => show(el, el.dataset.showRole.split(" ").includes(me.role)));
}

// ---------- Navigation + menus ----------
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  $("nav").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  if (name === "history") loadHistory();
  if (name === "admin") loadAdmin();
}
$("nav").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) { switchView(btn.dataset.view); setMenu(false); }
});

function setMenu(open) {
  $("drawer").classList.toggle("open", open);
  $("overlay").classList.toggle("open", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
  $("menuBtn").setAttribute("aria-expanded", String(open));
}
$("menuBtn").addEventListener("click", () => setMenu(true));
$("closeMenuBtn").addEventListener("click", () => setMenu(false));
$("overlay").addEventListener("click", () => setMenu(false));

// Avatar: round image made from the user's initials (swap for an uploaded photo later).
const AVATAR_COLORS = { admin: "#373328", editor: "#4f7a2e", viewer: "#8a7650" }; // brand-toned; white initials stay readable
function avatarUrl(name, color) {
  const initials = name.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Arial" font-size="32" fill="#fff">${esc(initials)}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
function renderUser() {
  const url = avatarUrl(me.username, AVATAR_COLORS[me.role]);
  $("avatarImg").src = url; $("avatarImgLg").src = url;
  $("userName").textContent = me.username;
  $("userRole").textContent = me.role[0].toUpperCase() + me.role.slice(1);
}
function setUserMenu(open) {
  $("userDropdown").classList.toggle("open", open);
  $("avatarBtn").setAttribute("aria-expanded", String(open));
}
$("avatarBtn").addEventListener("click", (e) => { e.stopPropagation(); setUserMenu(!$("userDropdown").classList.contains("open")); });
document.addEventListener("click", (e) => { if (!$("userMenu").contains(e.target)) setUserMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setUserMenu(false); setMenu(false); } });
$("userDropdown").addEventListener("click", async (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link) return;
  e.preventDefault();
  setUserMenu(false);
  const which = link.dataset.link;
  if (which === "history") switchView("history");
  if (which === "logout") { await api("/logout", "POST"); location.href = "login.html"; }
  if (which === "password") {
    const current = prompt("Current password:");
    if (!current) return;
    const next = prompt("New password (at least 8 characters):");
    if (!next) return;
    try { await api("/me/password", "POST", { current, next }); alert("Password changed."); } catch (err) { alert(err.message); }
  }
});

// ---------- Stepper ----------
// reached[n] = the step can be opened (clicked). Steps unlock as the work progresses.
let reached = { 1: true };
let step = 1;

function setStep(n) {
  step = n;
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.toggle("current", p.id === "step-" + n));
  document.querySelectorAll("#stepper li").forEach((li) => {
    const i = +li.firstElementChild.dataset.step;
    li.classList.toggle("current", i === n);
    li.classList.toggle("reached", !!reached[i]);
    li.classList.toggle("done", !!reached[i] && i < n);
  });
}
$("stepper").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-step]");
  if (btn && reached[+btn.dataset.step]) setStep(+btn.dataset.step);
});
$("toStep3Btn").addEventListener("click", () => setStep(3));
$("backTo2Btn").addEventListener("click", () => setStep(2));
$("newConversionBtn").addEventListener("click", () => {
  if (finalDirty && !confirm("You have unsaved edits. Start a new conversion anyway?")) return;
  resetResults();
  $("emailName").value = ""; $("figmaLink").value = ""; $("pngFile").value = ""; $("notes").value = ""; $("accordionHtml").value = "";
  setStep(1);
});

// ---------- Converter ----------
function fillOptions() {
  $("brand").innerHTML = config.brands.map((b) => `<option>${esc(b)}</option>`).join("");
  show($("brandHint"), !config.brands.length);
  $("brandHint").textContent = "No brands yet. An admin needs to add one in Admin settings.";
  $("platformToggle").innerHTML = config.platforms.map((p) =>
    `<button data-platform="${p.id}" ${p.enabled ? "" : 'disabled title="Coming soon"'} class="${p.id === platform ? "active" : ""}">${esc(p.label)}${p.enabled ? "" : " (coming soon)"}</button>`).join("");
}
$("platformToggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  platform = btn.dataset.platform;
  $("platformToggle").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
});
$("sourceToggle").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  source = btn.dataset.source;
  $("sourceToggle").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  show($("sourceFigma"), source === "figma");
  show($("sourcePng"), source === "png");
});

$("convertBtn").addEventListener("click", async () => {
  show($("convertError"), false);
  const body = { source, emailName: $("emailName").value.trim(), brand: $("brand").value, platform, notes: $("notes").value, whiteBody: $("whiteBody").checked };
  try {
    if (body.emailName.length < 2) { $("emailName").focus(); throw new Error("Give this email a name first."); }
    if (source === "figma") {
      body.figmaLink = $("figmaLink").value.trim();
      if (!body.figmaLink) throw new Error("Paste a Figma frame link first.");
    } else {
      const file = $("pngFile").files[0];
      if (!file) throw new Error("Choose a PNG file first.");
      if (file.size > 4 * 1024 * 1024) throw new Error("PNG must be under 4 MB.");
      body.pngBase64 = await readBase64(file);
      body.pngName = file.name;
    }
    $("convertBtn").disabled = true;
    busy($("convertStatus"), "Reading the design and exporting images...");
    const { id } = await api("/conversions", "POST", body);
    resetResults();
    busy($("convertStatus"), "Claude is writing the HTML. This can take a few minutes...");
    poll(id);
  } catch (err) {
    $("convertBtn").disabled = false;
    $("convertStatus").textContent = "";
    $("convertError").textContent = err.message;
    show($("convertError"), true);
  }
});

// Single place that updates the Final HTML box + preview. dirty = has unsaved edits.
let finalDirty = false;
function setFinalHtml(html, dirty = false) {
  $("finalHtml").value = html;
  $("finalFrame").srcdoc = html;
  setDirty(dirty);
}
function setDirty(d) {
  finalDirty = d;
  $("saveFinalBtn").disabled = !d;
  if (d) { $("saveFinalStatus").innerHTML = '<span class="save-state">Unsaved edits</span>'; }
  else if ($("saveFinalStatus").textContent === "Unsaved edits") { $("saveFinalStatus").textContent = ""; }
}

function resetResults() {
  currentId = null;
  reached = me && me.role === "viewer" ? { 2: true } : { 1: true };
  show($("finalNote"), false);
  $("previewFrame").srcdoc = ""; setFinalHtml("");
  show($("previewFrame"), false);
  show($("previewEmpty"), true);
  setStep(me && me.role === "viewer" ? 2 : step);
}

// Ask the server every 3 seconds until the background function has saved the result.
function poll(id) {
  clearTimeout(pollTimer);
  const tick = async () => {
    try {
      const { conversion } = await api("/conversions/" + id);
      if (conversion.status === "processing") { pollTimer = setTimeout(tick, 3000); return; }
      $("convertBtn").disabled = false;
      $("convertStatus").textContent = "";
      if (conversion.status === "error") {
        $("convertError").textContent = conversion.error || "The conversion failed.";
        show($("convertError"), true);
        return;
      }
      showConversion(conversion);
    } catch (err) {
      $("convertBtn").disabled = false;
      $("convertStatus").textContent = "";
      $("convertError").textContent = err.message;
      show($("convertError"), true);
    }
  };
  tick();
}

function showConversion(c) {
  currentId = c.id;
  show($("finalNote"), false);
  $("previewFrame").srcdoc = c.previewHtml || "";
  show($("previewFrame"), true);
  show($("previewEmpty"), false);
  const canWork = me.role !== "viewer";
  reached = { 1: canWork, 2: true, 3: canWork };
  if (c.finalHtml) {
    setFinalHtml(c.finalHtml);
    reached[4] = true;
  }
  setStep(c.finalHtml && canWork ? 4 : 2);
}

$("zipBtn").addEventListener("click", () => { if (currentId) location.href = `/api/conversions/${currentId}/zip`; });

$("finaliseBtn").addEventListener("click", async () => {
  $("finaliseBtn").disabled = true;
  busy($("finaliseStatus"), "Matching image URLs...");
  try {
    const r = await api(`/conversions/${currentId}/finalise`, "POST", { accordionHtml: $("accordionHtml").value });
    setFinalHtml(r.finalHtml);
    reached[4] = true;
    setStep(4);
    $("finalNote").textContent = r.unmatched.length
      ? `Matched ${r.matched} image(s). Not found in your paste, so the file name was left in the HTML: ${r.unmatched.join(", ")}. Check that you uploaded THIS conversion's zip to Pardot and pasted its file list (a new conversion can use different file names).`
      : `All ${r.matched} images matched.`;
    $("finalNote").classList.toggle("warn", r.unmatched.length > 0);
    show($("finalNote"), true);
    $("finaliseStatus").textContent = "";
  } catch (err) {
    flash($("finaliseStatus"), err.message, 8000);
  }
  $("finaliseBtn").disabled = false;
});

$("copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("finalHtml").value); flash($("copyStatus"), "Copied!"); }
  catch { flash($("copyStatus"), "Copy failed - select the text and copy manually."); }
});

// ---------- Final HTML: link editor ----------
// The preview iframe is "sandbox=allow-same-origin" (no scripts run inside it), so this page can
// safely read and change its DOM. Every change is written back into the HTML box.
const finalFrame = $("finalFrame");
const linkDialog = $("linkDialog");
let savedRange = null;   // last text selection made inside the preview
let linkJob = null;      // what the open dialog will change: { anchor } | { img } | { range }

// Turn the preview back into HTML text (without our editor-only <style>).
function serializePreview() {
  const doc = finalFrame.contentDocument;
  const clone = doc.documentElement.cloneNode(true);
  const style = clone.querySelector("#ec-editor-style");
  if (style) style.remove();
  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : "<!DOCTYPE html>";
  return doctype + "\n" + clone.outerHTML;
}
function syncFromPreview() {
  $("finalHtml").value = serializePreview();
  savedRange = null;
  $("addLinkSelBtn").disabled = true;
  setDirty(true);
}

// Each time the preview (re)loads: add hover hints and listen for clicks / selections.
finalFrame.addEventListener("load", () => {
  const doc = finalFrame.contentDocument;
  if (!doc || !doc.body || !$("finalHtml").value || me.role === "viewer") return;
  if (!doc.getElementById("ec-editor-style")) {
    const st = doc.createElement("style");
    st.id = "ec-editor-style";
    st.textContent = "img:hover, a:hover { outline: 2px dashed #1f6feb; outline-offset: 2px; cursor: pointer; }";
    doc.head.appendChild(st);
  }
  doc.addEventListener("click", onPreviewClick, true);
  doc.addEventListener("mouseup", rememberSelection);
  doc.addEventListener("keyup", rememberSelection);
});

function rememberSelection() {
  const sel = finalFrame.contentDocument.getSelection();
  savedRange = sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim() ? sel.getRangeAt(0).cloneRange() : null;
  $("addLinkSelBtn").disabled = !savedRange;
}

function onPreviewClick(e) {
  e.preventDefault(); // never navigate away inside the editor
  const doc = finalFrame.contentDocument;
  const sel = doc.getSelection();
  if (sel && !sel.isCollapsed) return; // the user is selecting text, not clicking
  const anchor = e.target.closest("a");
  const img = e.target.closest("img");
  if (anchor) openLinkDialog({ anchor }, anchor.querySelector("img") ? "image" : "button / link");
  else if (img) openLinkDialog({ img }, "image");
}

$("addLinkSelBtn").addEventListener("click", () => {
  if (!savedRange) return;
  // If the selection sits inside an existing link, edit that link instead of nesting a new one.
  const node = savedRange.commonAncestorContainer;
  const inside = (node.nodeType === 1 ? node : node.parentElement).closest("a");
  openLinkDialog(inside ? { anchor: inside } : { range: savedRange }, "selected text");
});

function openLinkDialog(job, what) {
  linkJob = job;
  const existing = job.anchor || null;
  const href = existing ? existing.getAttribute("href") || "" : "";
  $("linkTitle").textContent = existing ? "Edit link" : "Add link";
  $("linkWhat").textContent = "Applies to: " + what;
  $("linkUrl").value = href === "#" ? "" : href;
  // New tab is the default, also for existing links that have no target yet.
  $("linkNewTab").checked = existing ? (existing.getAttribute("target") || "_blank") === "_blank" : true;
  show($("linkRemove"), !!existing);
  show($("linkError"), false);
  linkDialog.showModal();
  $("linkUrl").focus();
  $("linkUrl").select();
}

// "example.com" -> "https://example.com". Merge tags (%%tag%%), #, mailto: and tel: are kept as typed.
function normalizeUrl(raw) {
  const u = raw.trim();
  if (!u) throw new Error("Enter a link address.");
  if (/^(javascript|data|vbscript):/i.test(u)) throw new Error("That kind of link isn't allowed.");
  if (/^(https?:\/\/|mailto:|tel:|#|%%|\{\{|\/)/i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(u)) return "https://" + u;
  throw new Error("Enter a full link such as https://example.com");
}

function setLinkAttrs(a, url, newTab) {
  a.setAttribute("href", url);
  if (newTab) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener noreferrer"); }
  else { a.removeAttribute("target"); a.removeAttribute("rel"); }
}

// Wrap the text inside a selection in links (one per text node, so nothing is split awkwardly).
function linkRange(range, url, newTab) {
  const doc = finalFrame.contentDocument;
  const root = range.commonAncestorContainer;
  const texts = [];
  if (root.nodeType === 3) texts.push(root);
  else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (range.intersectsNode(n) && n.nodeValue.trim()) texts.push(n);
    }
  }
  texts.forEach((node) => {
    const existing = node.parentElement.closest("a");
    if (existing) { setLinkAttrs(existing, url, newTab); return; }
    const sub = doc.createRange();
    sub.setStart(node, node === range.startContainer ? range.startOffset : 0);
    sub.setEnd(node, node === range.endContainer ? range.endOffset : node.nodeValue.length);
    if (!sub.toString().trim()) return;
    const a = doc.createElement("a");
    setLinkAttrs(a, url, newTab);
    // Linked text keeps its surrounding colour (no default blue) and is underlined instead.
    a.setAttribute("style", "color:inherit;text-decoration:underline;");
    sub.surroundContents(a);
  });
}

$("linkApply").addEventListener("click", () => {
  let url;
  try { url = normalizeUrl($("linkUrl").value); }
  catch (err) { $("linkError").textContent = err.message; show($("linkError"), true); return; }
  const newTab = $("linkNewTab").checked;
  const doc = finalFrame.contentDocument;
  if (linkJob.anchor) setLinkAttrs(linkJob.anchor, url, newTab);
  else if (linkJob.img) {
    const a = doc.createElement("a");
    setLinkAttrs(a, url, newTab);
    linkJob.img.replaceWith(a);
    a.appendChild(linkJob.img);
  } else if (linkJob.range) linkRange(linkJob.range, url, newTab);
  linkDialog.close();
  syncFromPreview();
});

$("linkRemove").addEventListener("click", () => {
  const a = linkJob && linkJob.anchor;
  if (a) {
    while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a);
    a.remove();
    syncFromPreview();
  }
  linkDialog.close();
});
$("linkCancel").addEventListener("click", () => linkDialog.close());
$("linkUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("linkApply").click(); } });

// Typing in the HTML box updates the preview (after a short pause).
let htmlTimer;
$("finalHtml").addEventListener("input", () => {
  clearTimeout(htmlTimer);
  setDirty(true);
  htmlTimer = setTimeout(() => { finalFrame.srcdoc = $("finalHtml").value; }, 500);
});

$("saveFinalBtn").addEventListener("click", async () => {
  $("saveFinalBtn").disabled = true;
  busy($("saveFinalStatus"), "Saving...");
  try {
    const r = await api(`/conversions/${currentId}/final`, "PUT", { finalHtml: $("finalHtml").value });
    $("finalHtml").value = r.finalHtml; // the server removes any <script> tags
    setDirty(false);
    flash($("saveFinalStatus"), "Saved.");
  } catch (err) {
    $("saveFinalBtn").disabled = false;
    flash($("saveFinalStatus"), err.message, 6000);
  }
});
window.addEventListener("beforeunload", (e) => { if (finalDirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- How-to guide popup ----------
const howTo = $("howToDialog");
$("howToBtn").addEventListener("click", () => { howTo.showModal(); howTo.scrollTop = 0; });
["howToClose", "howToDone"].forEach((id) => $(id).addEventListener("click", () => howTo.close()));
// Click on the dark area outside the box closes it too.
howTo.addEventListener("click", (e) => { if (e.target === howTo) howTo.close(); });

// ---------- History ----------
async function loadHistory() {
  $("historyScope").textContent =
    me.role === "editor" ? "Showing your conversions only." :
    me.role === "viewer" ? "Showing finished conversions." : "Showing all conversions.";
  $("historyBody").innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
  try {
    const { conversions } = await api("/conversions");
    $("historyBody").innerHTML = conversions.length ? conversions.map((h) => `
      <tr><td>${esc(h.createdAt.slice(0, 10))}</td><td>${esc(h.title || h.name)}</td><td>${esc(h.brand)}</td><td>${esc(h.platform)}</td><td>${esc(h.by)}</td>
      <td><span class="badge ${h.status === "processing" ? "status-processing" : h.status === "error" ? "status-error" : "ok"}">${esc(h.status)}</span></td>
      <td><button class="btn secondary small" data-open="${esc(h.id)}">Open</button></td></tr>`).join("")
      : `<tr><td colspan="7">No conversions yet.</td></tr>`;
  } catch (err) {
    $("historyBody").innerHTML = `<tr><td colspan="7" class="error">${esc(err.message)}</td></tr>`;
  }
}
$("historyBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-open]");
  if (!btn) return;
  switchView("converter");
  resetResults();
  show($("convertError"), false);
  poll(btn.dataset.open);
  busy($("convertStatus"), "Loading...");
});

// ---------- Admin ----------
$("adminTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  $("adminTabs").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".admin-tab").forEach((t) => show(t, t.id === "tab-" + btn.dataset.tab));
});

let brands = [];
let platformRules = {};

async function loadAdmin() {
  try {
    const [u, b, p, pr] = await Promise.all([api("/users"), api("/brands"), api("/platforms"), api("/prompt")]);
    brands = b.brands; platformRules = p.platforms;
    renderUsers(u.users); renderBrands(); renderPlatforms();
    $("claudePrompt").value = pr.prompt;
  } catch (err) { alert(err.message); }
}

// Users
function renderUsers(users) {
  $("usersBody").innerHTML = users.map((u) => `
    <tr><td>${esc(u.username)}</td>
    <td><select data-role-for="${esc(u.username)}">${["admin", "editor", "viewer"].map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r[0].toUpperCase() + r.slice(1)}</option>`).join("")}</select></td>
    <td><button class="btn secondary small" data-reset="${esc(u.username)}">Reset password</button>
        <button class="btn danger small" data-remove="${esc(u.username)}">Remove</button></td></tr>`).join("");
}
async function reloadUsers() { renderUsers((await api("/users")).users); }
$("usersBody").addEventListener("change", async (e) => {
  const sel = e.target.closest("select[data-role-for]");
  if (!sel) return;
  try { await api("/users/" + encodeURIComponent(sel.dataset.roleFor), "PATCH", { role: sel.value }); } catch (err) { alert(err.message); }
  reloadUsers();
});
$("usersBody").addEventListener("click", async (e) => {
  const reset = e.target.closest("[data-reset]"), remove = e.target.closest("[data-remove]");
  try {
    if (reset) {
      const password = prompt(`New password for ${reset.dataset.reset} (at least 8 characters):`);
      if (password) { await api(`/users/${encodeURIComponent(reset.dataset.reset)}/password`, "POST", { password }); alert("Password updated."); }
    }
    if (remove && confirm(`Remove ${remove.dataset.remove}?`)) {
      await api("/users/" + encodeURIComponent(remove.dataset.remove), "DELETE");
      reloadUsers();
    }
  } catch (err) { alert(err.message); }
});
$("addUserBtn").addEventListener("click", async () => {
  try {
    await api("/users", "POST", { username: $("newUserName").value, password: $("newUserPass").value, role: $("newUserRole").value.toLowerCase() });
    $("newUserName").value = ""; $("newUserPass").value = "";
    reloadUsers();
  } catch (err) { alert(err.message); }
});

// Brands (edited in memory, saved with the Save button)
function renderBrands() {
  $("brandsList").innerHTML = brands.map((b, bi) => `
    <div class="brand-box" data-b="${bi}">
      <div class="row" style="align-items:end">
        <div><label>Brand name</label><input type="text" data-f="name" value="${esc(b.name)}"></div>
        <div style="flex:0"><button class="btn danger small" data-del-brand="${bi}">Remove brand</button></div>
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="list">
        <thead><tr><th>Network</th><th>URL</th><th>On</th><th>Icon</th><th></th></tr></thead>
        <tbody>${b.socials.map((s, si) => `
          <tr data-s="${si}">
            <td><input type="text" data-sf="network" value="${esc(s.network)}" style="min-width:110px"></td>
            <td><input type="text" data-sf="url" value="${esc(s.url)}" placeholder="https://..."></td>
            <td><input type="checkbox" data-sf="on" ${s.on ? "checked" : ""}></td>
            <td>${s.icon ? `<img src="/api/icons/${encodeURIComponent(s.icon)}" alt="" width="28" height="28" style="vertical-align:middle;border-radius:4px"> ` : `<span class="icon-thumb">?</span> `}
                <input type="file" accept="image/*" data-icon style="width:auto"></td>
            <td><button class="btn secondary small" data-del-social="${si}">x</button></td>
          </tr>`).join("")}</tbody>
      </table></div>
      <button class="btn secondary small" style="margin:8px 0" data-add-social>+ Add network</button>
      <div class="row">
        <div><label>Privacy policy link</label><input type="text" data-f="privacy" value="${esc(b.privacy)}"></div>
        <div><label>Footer address</label><input type="text" data-f="address" value="${esc(b.address)}"></div>
      </div>
    </div>`).join("") || "<p class='hint'>No brands yet.</p>";
}
$("brandsList").addEventListener("input", (e) => {
  const box = e.target.closest("[data-b]");
  if (!box) return;
  const b = brands[+box.dataset.b];
  if (e.target.dataset.f) b[e.target.dataset.f] = e.target.value;
  const row = e.target.closest("[data-s]");
  if (row && e.target.dataset.sf) b.socials[+row.dataset.s][e.target.dataset.sf] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
});
$("brandsList").addEventListener("change", async (e) => {
  if (!e.target.matches("[data-icon]")) return;
  const b = brands[+e.target.closest("[data-b]").dataset.b];
  const s = b.socials[+e.target.closest("[data-s]").dataset.s];
  const file = e.target.files[0];
  if (!file) return;
  try {
    const r = await api("/brands/icon", "POST", { brand: b.name, network: s.network, contentType: file.type, dataBase64: await readBase64(file) });
    s.icon = r.icon;
    renderBrands();
  } catch (err) { alert(err.message); }
});
$("brandsList").addEventListener("click", (e) => {
  const box = e.target.closest("[data-b]");
  if (!box) return;
  const b = brands[+box.dataset.b];
  if (e.target.matches("[data-add-social]")) { b.socials.push({ network: "", url: "", on: true, icon: null }); renderBrands(); }
  if (e.target.matches("[data-del-social]")) { b.socials.splice(+e.target.closest("[data-s]").dataset.s, 1); renderBrands(); }
  if (e.target.matches("[data-del-brand]") && confirm(`Remove brand ${b.name}? (Click "Save brands" to apply.)`)) { brands.splice(+box.dataset.b, 1); renderBrands(); }
});
$("addBrandBtn").addEventListener("click", () => {
  brands.push({ name: "New brand", privacy: "", address: "", socials: [] });
  renderBrands();
});
$("saveBrandsBtn").addEventListener("click", async () => {
  try { await api("/brands", "PUT", { brands }); flash($("brandsStatus"), "Saved."); config = await api("/config"); fillOptions(); }
  catch (err) { flash($("brandsStatus"), err.message, 6000); }
});

// Platform rules: one block per platform from the server, so a new platform appears automatically.
function renderPlatforms() {
  $("platformsList").innerHTML = Object.entries(platformRules).map(([id, p]) => `
    <div class="brand-box" data-p="${id}">
      <h3>${esc(p.label)}</h3>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pf="enabled" ${p.enabled ? "checked" : ""} style="width:auto"> Available on the converter page</label>
      <div class="row" style="margin-top:12px">
        <div><label>Unsubscribe tag</label><input type="text" data-pf="unsubscribe" value="${esc(p.unsubscribe)}"></div>
        <div><label>Image hosting</label><input type="text" data-pf="imageHost" value="${esc(p.imageHost)}"></div>
      </div>
      <label style="margin-top:12px">Merge tags (one per line)</label>
      <textarea data-pf="mergeTags">${esc(p.mergeTags.join("\n"))}</textarea>
    </div>`).join("");
}
$("platformsList").addEventListener("input", (e) => {
  const box = e.target.closest("[data-p]");
  if (!box || !e.target.dataset.pf) return;
  const p = platformRules[box.dataset.p], f = e.target.dataset.pf;
  p[f] = f === "enabled" ? e.target.checked : f === "mergeTags" ? e.target.value.split("\n") : e.target.value;
});
$("savePlatformsBtn").addEventListener("click", async () => {
  try { await api("/platforms", "PUT", { platforms: platformRules }); flash($("platformsStatus"), "Saved."); config = await api("/config"); fillOptions(); }
  catch (err) { flash($("platformsStatus"), err.message, 6000); }
});

// Claude prompt
$("savePromptBtn").addEventListener("click", async () => {
  try { await api("/prompt", "PUT", { prompt: $("claudePrompt").value }); flash($("promptStatus"), "Saved."); }
  catch (err) { flash($("promptStatus"), err.message, 6000); }
});

// ---------- Start ----------
(async function init() {
  try {
    me = (await api("/me")).user;
    config = await api("/config");
  } catch { return; } // api() already redirected to the login page on 401
  renderUser();
  applyRole();
  fillOptions();
  $("appVersion").textContent = "v" + config.version;
  $("appVersionText").textContent = config.version;
  reached = me.role === "viewer" ? { 2: true } : { 1: true };
  setStep(me.role === "viewer" ? 2 : 1);
})();
