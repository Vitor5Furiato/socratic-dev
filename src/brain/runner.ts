import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Exercise, RunReport, TestResult } from "./types";

export interface RunnerOptions {
  cppCompiler?: string;
  /** Per-test wall clock limit. Catches infinite loops. */
  timeoutMs?: number;
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
}

const MAX_OUTPUT = 64 * 1024;

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs: number }): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (r: ProcResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString();
    });
    child.on("error", (err: NodeJS.ErrnoException) => finish({ code: null, stdout, stderr, timedOut, spawnError: err }));
    child.on("close", (code) => finish({ code, stdout, stderr, timedOut }));

    child.stdin.on("error", () => {}); // program may exit before reading stdin
    child.stdin.end(opts.input ?? "");
  });
}

const normalize = (s: string) =>
  s.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trimEnd();

/** Compiles the learner's source file and runs it against every test case. */
export async function runTests(ex: Exercise, sourceFile: string, options: RunnerOptions = {}): Promise<RunReport> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-"));
  try {
    const build = ex.language === "cpp"
      ? await buildCpp(sourceFile, workDir, options.cppCompiler ?? "g++")
      : await buildCSharp(sourceFile, workDir);
    if ("report" in build) return build.report;

    const results: TestResult[] = [];
    for (const [i, t] of ex.tests.entries()) {
      const name = t.name ?? `test ${i + 1}`;
      const r = await run(build.cmd, build.args, { input: t.input, timeoutMs });
      const actual = r.stdout;
      let error: string | undefined;
      if (r.timedOut) error = `Timed out after ${timeoutMs} ms (infinite loop, or waiting for input that never comes?)`;
      else if (r.code !== 0) error = `Exited with code ${r.code}${r.stderr ? `\n${r.stderr.trim()}` : ""}`;
      const passed = !error && normalize(actual) === normalize(t.expected);

      results.push(
        t.hidden
          ? { name, passed, hidden: true, error: passed ? undefined : error }
          : { name, passed, hidden: false, input: t.input, expected: t.expected, actual, error },
      );
    }

    return { status: results.every((r) => r.passed) ? "passed" : "failed", results };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

type Build = { cmd: string; args: string[] } | { report: RunReport };

async function buildCpp(source: string, workDir: string, compiler: string): Promise<Build> {
  const exe = path.join(workDir, process.platform === "win32" ? "main.exe" : "main");
  const r = await run(compiler, ["-std=c++17", "-Wall", "-Wextra", "-O0", "-g", source, "-o", exe], {
    timeoutMs: 60_000,
  });
  if (r.spawnError) {
    return {
      report: {
        status: "toolchain_missing",
        compilerOutput: `Could not start "${compiler}" (${r.spawnError.code}). Install g++ or clang++ and make sure it is on your PATH, or set socraticDev.cppCompiler.`,
        results: [],
      },
    };
  }
  if (r.code !== 0) return { report: { status: "compile_error", compilerOutput: r.stderr || r.stdout, results: [] } };
  // Warnings are useful teaching material even on success, but v0.1 keeps it simple and drops them.
  return { cmd: exe, args: [] };
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>Solution</AssemblyName>
    <RollForward>Major</RollForward>
  </PropertyGroup>
</Project>
`;

async function buildCSharp(source: string, workDir: string): Promise<Build> {
  fs.writeFileSync(path.join(workDir, "Solution.csproj"), CSPROJ);
  fs.copyFileSync(source, path.join(workDir, "Program.cs"));
  const outDir = path.join(workDir, "bin");
  const r = await run("dotnet", ["build", "-c", "Debug", "-o", outDir, "-nologo", "-v", "q", "-clp:NoSummary"], {
    cwd: workDir,
    timeoutMs: 180_000,
  });
  if (r.spawnError) {
    return {
      report: {
        status: "toolchain_missing",
        compilerOutput: `Could not start "dotnet" (${r.spawnError.code}). Install the .NET 8 SDK or newer and make sure "dotnet" is on your PATH.`,
        results: [],
      },
    };
  }
  if (r.code !== 0) {
    // Strip the temp directory from paths so errors read "Program.cs(5,9): error ..."
    const out = (r.stdout + r.stderr).split(workDir + path.sep).join("");
    return { report: { status: "compile_error", compilerOutput: out, results: [] } };
  }
  return { cmd: "dotnet", args: [path.join(outDir, "Solution.dll")] };
}

/** Plain-text summary used both in the UI and as context for the tutor. */
export function formatReport(report: RunReport): string {
  switch (report.status) {
    case "toolchain_missing":
      return `Toolchain problem:\n${report.compilerOutput}`;
    case "compile_error":
      return `Compilation failed:\n${report.compilerOutput?.trim()}`;
  }
  const passed = report.results.filter((r) => r.passed).length;
  const lines = [`${passed}/${report.results.length} tests passed.`];
  for (const r of report.results) {
    if (r.passed) {
      lines.push(`✔ ${r.name}`);
      continue;
    }
    lines.push(`✘ ${r.name}${r.hidden ? " (hidden test)" : ""}`);
    if (!r.hidden) {
      lines.push(`  input:    ${JSON.stringify(r.input)}`);
      lines.push(`  expected: ${JSON.stringify(r.expected)}`);
      lines.push(`  got:      ${JSON.stringify(r.actual)}`);
    }
    if (r.error) lines.push(`  ${r.error.split("\n").join("\n  ")}`);
  }
  return lines.join("\n");
}
