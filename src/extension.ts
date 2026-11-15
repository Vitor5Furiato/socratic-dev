import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { languageLabel, loadExercises, starterCodePath } from "./brain/exercises";
import { formatReport, runTests } from "./brain/runner";
import { TutorConfig, TutorSession } from "./brain/tutor";
import { Exercise } from "./brain/types";
import { ProfessorPanel } from "./panel";

const SECRET_KEY = "socraticDev.anthropicApiKey";

interface ActiveExercise {
  exercise: Exercise;
  file: vscode.Uri;
  tutor?: TutorSession;
  /** Test report not yet seen by the tutor. Cleared once it is sent along with a question. */
  pendingReport?: string;
}

let active: ActiveExercise | undefined;
let inFlight: AbortController | undefined;

export function activate(context: vscode.ExtensionContext) {
  const exercisesRoot = path.join(context.extensionPath, "exercises");
  const panel = new ProfessorPanel(context.extensionUri, {
    onAsk: (q) => askProfessor(q),
    onRun: () => runCurrentTests(),
    onStart: () => startExercise(),
    onStop: () => inFlight?.abort(),
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ProfessorPanel.viewId, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("socraticDev.startExercise", () => startExercise()),
    vscode.commands.registerCommand("socraticDev.askProfessor", () => askProfessor("")),
    vscode.commands.registerCommand("socraticDev.runTests", () => runCurrentTests()),
    vscode.commands.registerCommand("socraticDev.setApiKey", () => promptForApiKey()),
    vscode.commands.registerCommand("socraticDev.clearApiKey", async () => {
      await context.secrets.delete(SECRET_KEY);
      vscode.window.showInformationMessage("Socratic Dev: API key removed.");
    }),
  );

  async function getApiKey(): Promise<string | undefined> {
    return (await context.secrets.get(SECRET_KEY)) || process.env.ANTHROPIC_API_KEY || (await promptForApiKey());
  }

  async function promptForApiKey(): Promise<string | undefined> {
    const key = await vscode.window.showInputBox({
      title: "Anthropic API key",
      prompt: "Get one at console.anthropic.com. It is stored in VS Code's secret storage, not in settings.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().startsWith("sk-ant-") ? undefined : "Anthropic keys start with sk-ant-"),
    });
    if (!key) return undefined;
    await context.secrets.store(SECRET_KEY, key.trim());
    return key.trim();
  }

  function config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("socraticDev");
  }

  function exercisesDir(): string {
    return config().get<string>("workspaceFolder") || path.join(os.homedir(), "socratic-exercises");
  }

  async function startExercise() {
    const all = loadExercises(exercisesRoot);
    const pick = await vscode.window.showQuickPick(
      all.map((ex) => ({
        label: ex.title,
        description: `${languageLabel(ex.language)} · ${ex.topic}`,
        detail: "★".repeat(ex.difficulty) + "☆".repeat(3 - ex.difficulty),
        ex,
      })),
      { title: "Pick an exercise", matchOnDescription: true },
    );
    if (!pick) return;
    const ex = pick.ex;

    // Copy the starter file into the learner's folder. Existing work is never overwritten, so picking an
    // exercise again resumes it.
    const target = path.join(exercisesDir(), ex.language, ex.id, ex.starterFile);
    const resumed = fs.existsSync(target);
    if (!resumed) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(starterCodePath(exercisesRoot, ex), target);
    }

    inFlight?.abort();
    active = { exercise: ex, file: vscode.Uri.file(target) };
    const doc = await vscode.workspace.openTextDocument(active.file);
    await vscode.window.showTextDocument(doc, { preview: false });

    panel.reveal();
    panel.showExercise(ex.title, `${languageLabel(ex.language)} · ${ex.topic}`, ex.prompt, resumed);
  }

  async function currentCode(): Promise<string | undefined> {
    if (!active) return undefined;
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === active!.file.fsPath);
    if (doc) {
      if (doc.isDirty) await doc.save();
      return doc.getText();
    }
    return fs.existsSync(active.file.fsPath) ? fs.readFileSync(active.file.fsPath, "utf8") : undefined;
  }

  async function runCurrentTests() {
    if (!active) {
      panel.notice("Start an exercise first.");
      return;
    }
    const ex = active.exercise;
    await currentCode(); // saves the file
    panel.setBusy(true, "Compiling and running tests…");
    try {
      const report = await runTests(ex, active.file.fsPath, {
        cppCompiler: config().get<string>("cppCompiler") || "g++",
      });
      const text = formatReport(report);
      active.pendingReport = text;
      panel.showTestReport(text, report.status === "passed");
    } catch (err) {
      panel.error(`Test run failed: ${(err as Error).message}`);
    } finally {
      panel.setBusy(false);
    }
  }

  async function askProfessor(question: string) {
    if (!active) {
      panel.notice("Start an exercise first, then I'll have something to interrogate you about.");
      return;
    }
    if (inFlight) return;

    if (!active.tutor) {
      const apiKey = await getApiKey();
      if (!apiKey) {
        panel.notice("The professor needs an Anthropic API key. Run “Socratic Dev: Set Anthropic API Key”.");
        return;
      }
      const tutorConfig: TutorConfig = {
        apiKey,
        model: config().get<string>("model") || "claude-opus-5-5",
        effort: config().get<TutorConfig["effort"]>("effort") || "medium",
      };
      active.tutor = new TutorSession(active.exercise, tutorConfig);
    }

    const code = (await currentCode()) ?? "";
    const testReport = active.pendingReport;
    const session = active;
    panel.showUserMessage(question || "(look at my code)");
    panel.startProfessorMessage();
    inFlight = new AbortController();
    panel.setBusy(true, "The professor is thinking…");
    try {
      await session.tutor!.ask({ question, code, testReport }, (delta) => panel.appendProfessorText(delta), inFlight.signal);
      session.pendingReport = undefined;
      panel.endProfessorMessage();
    } catch (err) {
      panel.endProfessorMessage();
      if (inFlight.signal.aborted) panel.notice("Stopped.");
      else panel.error(describeError(err));
    } finally {
      inFlight = undefined;
      panel.setBusy(false);
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Invalid API key. Run “Socratic Dev: Set Anthropic API Key” to replace it.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model. Check socraticDev.model.";
  if (err instanceof Anthropic.NotFoundError) return "Model not found. Check the socraticDev.model setting.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited. Wait a moment and ask again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your connection.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return (err as Error)?.message ?? String(err);
}

export function deactivate() {
  inFlight?.abort();
}
