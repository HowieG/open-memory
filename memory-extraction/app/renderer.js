"use strict";

// ---- source logos (inline SVG) ----
const LOGOS = {
  // OpenAI logomark
  chatgpt: `<svg viewBox="0 0 24 24" width="16" height="16" fill="#000"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.062l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zM8.307 12.863l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.376-3.454l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v3l-2.597 1.5-2.607-1.5z"/></svg>`,
  // Claude / Anthropic sunburst (coral)
  claude: `<svg viewBox="0 0 24 24" width="16" height="16"><g stroke="#D97757" stroke-width="2.2" stroke-linecap="round"><line x1="16" y1="12" x2="21" y2="12"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/></g></svg>`,
};

const FACTS = [
  "Based in San Francisco.",
  "Runs an AI strategy & implementation consulting practice.",
  "Building open-memory — user-controlled memory you carry between AI apps.",
  "Prefers a near-monochrome design with restrained accents.",
  "Recently working through ChatGPT and Claude data-export ingestion.",
  "Leans on tests and self-checking infrastructure before shipping.",
];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const logoFor = (source) => LOGOS[source] || `<span style="font-size:11px;color:#999">•</span>`;

const convItem = (c, clickable) =>
  `<div class="conv-item"${clickable ? ` data-id="${esc(c.id)}"` : ""}>` +
  `<span class="logo" title="${esc(c.source)}">${logoFor(c.source)}</span>` +
  `<span class="title">${esc(c.title)}</span></div>`;

// ---- screen switching ----
const screens = ["screen-upload", "screen-uploaded", "screen-memories"];
function show(id) {
  for (const s of screens) document.getElementById(s).classList.toggle("active", s === id);
}

// ---- elements ----
const $ = (id) => document.getElementById(id);
const drop = $("drop");
const status = $("status");

function setStatus(text, isErr) {
  status.textContent = text || "";
  status.className = "status" + (isErr ? " err" : "");
}

// ---- upload result -> confirmation screen ----
function onUploaded(res) {
  if (!res || res.canceled) {
    setStatus("");
    return;
  }
  if (res.error) {
    setStatus("Error: " + res.error, true);
    return;
  }
  setStatus("");
  $("uploaded-count").textContent =
    `${res.count} conversation${res.count === 1 ? "" : "s"} from ${res.source}` +
    (res.failed ? ` · ${res.failed} skipped` : "");
  $("uploaded-list").innerHTML = res.uploaded.map((c) => convItem(c, false)).join("");
  show("screen-uploaded");
}

$("pick").addEventListener("click", async () => {
  setStatus("Reading…");
  onUploaded(await window.api.pickAndIngest());
});

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("hot");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("hot");
  }),
);
drop.addEventListener("drop", async (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  setStatus("Reading…");
  onUploaded(await window.api.ingestPath(window.api.pathForFile(file)));
});

// ---- Next -> memories screen ----
function renderFacts(count) {
  const from = count ? `your ${count} conversation${count === 1 ? "" : "s"}` : "your conversations";
  $("mem-facts").innerHTML =
    `<h2>Your memories</h2>` +
    `<div class="note">Placeholder facts — your real memories will be extracted from ${from}.</div>` +
    `<ul>${FACTS.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
}

function showFacts() {
  $("mem-view").style.display = "none";
  $("backbar").style.display = "none";
  $("mem-facts").style.display = "block";
  for (const el of document.querySelectorAll("#mem-list .conv-item.active")) el.classList.remove("active");
}

async function openMemories() {
  const list = await window.api.listConversations();
  $("mem-list").innerHTML = list.map((c) => convItem(c, true)).join("");
  renderFacts(list.length);
  showFacts();
  show("screen-memories");
}

$("next").addEventListener("click", openMemories);

// Persistence: if the store already has conversations from a prior session,
// offer to jump straight to them.
async function checkStore() {
  const existing = await window.api.listConversations();
  if (!existing.length) return;
  const r = $("resume");
  r.style.display = "block";
  r.innerHTML = `<button id="resume-btn">View your ${existing.length} stored conversation${existing.length === 1 ? "" : "s"} →</button>`;
  $("resume-btn").addEventListener("click", openMemories);
}
checkStore();

$("back").addEventListener("click", showFacts);

// sidebar conversation click -> render it
$("mem-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".conv-item");
  if (!item) return;
  const id = item.getAttribute("data-id");
  for (const el of document.querySelectorAll("#mem-list .conv-item.active")) el.classList.remove("active");
  item.classList.add("active");

  const res = await window.api.getConversation(id);
  if (res.error) return;
  $("mem-facts").style.display = "none";
  $("mem-view").style.display = "block";
  $("mem-view").srcdoc = res.html;
  $("backbar").style.display = "block";
});
