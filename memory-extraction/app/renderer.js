const pick = document.getElementById("pick");
const drop = document.getElementById("drop");
const statusEl = document.getElementById("status");
const view = document.getElementById("view");

function show(res) {
  if (!res || res.canceled) {
    statusEl.textContent = "";
    return;
  }
  if (res.error) {
    statusEl.className = "err";
    statusEl.textContent = "Error: " + res.error;
    view.srcdoc = "";
    return;
  }
  statusEl.className = "ok";
  statusEl.textContent =
    `${res.source}: ${res.count} conversations` +
    (res.failed ? ` · ${res.failed} failed` : "") +
    ` — ${res.path}`;
  view.srcdoc = res.html;
}

pick.addEventListener("click", async () => {
  statusEl.className = "";
  statusEl.textContent = "Reading…";
  show(await window.api.pickAndIngest());
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
  const zipPath = window.api.pathForFile(file);
  statusEl.className = "";
  statusEl.textContent = "Reading…";
  show(await window.api.ingestPath(zipPath));
});
