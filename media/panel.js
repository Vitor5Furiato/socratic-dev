// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code
  const vscode = acquireVsCodeApi();
  const log = /** @type {HTMLElement} */ (document.getElementById("log"));
  const input = /** @type {HTMLTextAreaElement} */ (document.getElementById("input"));
  const form = /** @type {HTMLFormElement} */ (document.getElementById("composer"));
  const status = /** @type {HTMLElement} */ (document.getElementById("status"));
  const askBtn = /** @type {HTMLButtonElement} */ (document.getElementById("ask"));
  const runBtn = /** @type {HTMLButtonElement} */ (document.getElementById("run"));
  const stopBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stop"));

  /** @type {{ el: HTMLElement, text: string } | null} */
  let current = null;

  // ---- Minimal, escape-first Markdown. Everything is HTML-escaped before any tag is added. ----
  /** @param {string} s */
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /** @param {string} s */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  }

  /** @param {string} md */
  function render(md) {
    const out = [];
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) {
        const code = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
        i++; // closing fence (or end of a still-streaming block)
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
      } else if (/^\s*[-*] /.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*] /, ""));
        out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      } else if (/^\s*\d+\. /.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+\. /, ""));
        out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol>`);
      } else if (/^#{1,6} /.test(line)) {
        out.push(`<p><strong>${inline(line.replace(/^#+ /, ""))}</strong></p>`);
        i++;
      } else if (line.trim() === "") {
        i++;
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() !== "" && !/^(```|\s*[-*] |\s*\d+\. |#{1,6} )/.test(lines[i])) {
          para.push(lines[i++]);
        }
        out.push(`<p>${inline(para.join("\n")).replace(/\n/g, "<br>")}</p>`);
      }
    }
    return out.join("");
  }

  // ---- Log helpers ----
  /** @param {string} cls @param {string} html */
  function add(cls, html) {
    log.querySelector(".empty")?.remove();
    const el = document.createElement("div");
    el.className = `msg ${cls}`;
    el.innerHTML = html;
    log.appendChild(el);
    el.scrollIntoView({ block: "end" });
    return el;
  }

  function send() {
    const text = input.value;
    input.value = "";
    vscode.postMessage({ type: "ask", text });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!askBtn.disabled) send();
    }
  });
  runBtn.addEventListener("click", () => vscode.postMessage({ type: "run" }));
  stopBtn.addEventListener("click", () => vscode.postMessage({ type: "stop" }));
  document.getElementById("start")?.addEventListener("click", () => vscode.postMessage({ type: "start" }));
  document.getElementById("startEmpty")?.addEventListener("click", () => vscode.postMessage({ type: "start" }));

  window.addEventListener("message", (event) => {
    const m = event.data;
    switch (m.type) {
      case "exercise":
        log.innerHTML = "";
        add(
          "exercise",
          `<div class="title">${esc(m.title)}</div><div class="sub">${esc(m.subtitle)}${m.resumed ? " · resumed your saved file" : ""}</div>${render(m.prompt)}`,
        );
        input.focus();
        break;
      case "user":
        add("user", `<p>${esc(m.text).replace(/\n/g, "<br>")}</p>`);
        break;
      case "profStart":
        current = { el: add("prof", ""), text: "" };
        break;
      case "profDelta":
        if (current) {
          current.text += m.text;
          current.el.innerHTML = render(current.text);
          current.el.scrollIntoView({ block: "end" });
        }
        break;
      case "profEnd":
        if (current && !current.text) current.el.remove();
        current = null;
        break;
      case "tests":
        add(`tests ${m.passed ? "pass" : "fail"}`, `<pre>${esc(m.text)}</pre>`);
        break;
      case "notice":
        add("notice", `<p>${esc(m.text)}</p>`);
        break;
      case "error":
        add("error", `<p>${esc(m.text)}</p>`);
        break;
      case "busy":
        askBtn.disabled = m.busy;
        runBtn.disabled = m.busy;
        stopBtn.hidden = !m.busy;
        status.hidden = !m.busy;
        status.textContent = m.label || "";
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
