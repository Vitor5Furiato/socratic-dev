import * as vscode from "vscode";

export interface PanelHandlers {
  onAsk(question: string): void;
  onRun(): void;
  onStart(): void;
  onStop(): void;
}

/** Sidebar chat view. All rendering happens in media/panel.js; this class only relays messages. */
export class ProfessorPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "socraticDev.professor";
  private view?: vscode.WebviewView;
  private ready = false;
  private queue: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly handlers: PanelHandlers,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((msg: { type: string; text?: string }) => {
      switch (msg.type) {
        case "ready":
          this.ready = true;
          for (const m of this.queue) void view.webview.postMessage(m);
          this.queue = [];
          break;
        case "ask":
          this.handlers.onAsk(msg.text ?? "");
          break;
        case "run":
          this.handlers.onRun();
          break;
        case "start":
          this.handlers.onStart();
          break;
        case "stop":
          this.handlers.onStop();
          break;
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  reveal() {
    if (this.view) this.view.show(true);
    else void vscode.commands.executeCommand(`${ProfessorPanel.viewId}.focus`);
  }

  showExercise(title: string, subtitle: string, prompt: string, resumed: boolean) {
    this.post({ type: "exercise", title, subtitle, prompt, resumed });
  }
  showUserMessage(text: string) {
    this.post({ type: "user", text });
  }
  startProfessorMessage() {
    this.post({ type: "profStart" });
  }
  appendProfessorText(text: string) {
    this.post({ type: "profDelta", text });
  }
  endProfessorMessage() {
    this.post({ type: "profEnd" });
  }
  showTestReport(text: string, passed: boolean) {
    this.post({ type: "tests", text, passed });
  }
  notice(text: string) {
    this.post({ type: "notice", text });
  }
  error(text: string) {
    this.post({ type: "error", text });
  }
  setBusy(busy: boolean, label?: string) {
    this.post({ type: "busy", busy, label });
  }

  private post(msg: unknown) {
    // Messages sent before the webview finished loading would be lost, so queue them until "ready".
    if (this.view && this.ready) void this.view.webview.postMessage(msg);
    else this.queue.push(msg);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${style}" rel="stylesheet">
<title>Professor</title>
</head>
<body>
  <div id="log">
    <div class="empty">
      <p><strong>No exercise yet.</strong></p>
      <p>Pick one and the professor will ask you uncomfortable questions about it.</p>
      <button id="startEmpty">Start exercise</button>
    </div>
  </div>
  <div id="status" hidden></div>
  <form id="composer">
    <textarea id="input" rows="3" placeholder="Ask the professor… (Enter to send, Shift+Enter for newline). Empty = just look at my code."></textarea>
    <div class="row">
      <button type="submit" id="ask">Ask</button>
      <button type="button" id="run" class="secondary">Run tests</button>
      <button type="button" id="stop" class="secondary" hidden>Stop</button>
      <span class="spacer"></span>
      <button type="button" id="start" class="secondary" title="Start another exercise">New</button>
    </div>
  </form>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
