import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { loadExercises, starterCodePath } from "../brain/exercises";
import { formatReport, runTests } from "../brain/runner";
import { Exercise } from "../brain/types";

const root = path.join(__dirname, "..", "..", "exercises");
const hasGpp = (() => {
  try {
    execFileSync("g++", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const sumExercise: Exercise = {
  id: "sum",
  title: "Sum",
  language: "cpp",
  topic: "test",
  difficulty: 1,
  prompt: "",
  starterFile: "main.cpp",
  tests: [
    { name: "adds", input: "2 3\n", expected: "5\n" },
    { name: "secret", input: "10 -4\n", expected: "6\n", hidden: true },
  ],
};

function writeTemp(code: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "socratic-test-"));
  const file = path.join(dir, "main.cpp");
  fs.writeFileSync(file, code);
  return file;
}

test("all bundled exercises load and have their starter file", () => {
  const all = loadExercises(root);
  assert.ok(all.length >= 5);
  for (const ex of all) {
    assert.ok(fs.existsSync(starterCodePath(root, ex)), `missing starter for ${ex.id}`);
    assert.ok(ex.tests.length > 0, `${ex.id} has no tests`);
  }
});

test("correct C++ solution passes", { skip: !hasGpp }, async () => {
  const file = writeTemp("#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<\"\\n\";}\n");
  const report = await runTests(sumExercise, file);
  assert.equal(report.status, "passed", formatReport(report));
});

test("wrong answer fails and hides hidden test details", { skip: !hasGpp }, async () => {
  const file = writeTemp("#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a*b<<\"\\n\";}\n");
  const report = await runTests(sumExercise, file);
  assert.equal(report.status, "failed");
  const hidden = report.results.find((r) => r.hidden)!;
  assert.equal(hidden.passed, false);
  assert.equal(hidden.input, undefined);
  assert.equal(hidden.actual, undefined);
  assert.doesNotMatch(formatReport(report), /10 -4/);
});

test("compile error is reported", { skip: !hasGpp }, async () => {
  const file = writeTemp("int main() { return 0 }\n");
  const report = await runTests(sumExercise, file);
  assert.equal(report.status, "compile_error");
  assert.match(report.compilerOutput ?? "", /error/);
});

test("infinite loop times out", { skip: !hasGpp }, async () => {
  const file = writeTemp("int main(){ volatile int x = 0; while(true){ x++; } }\n");
  const report = await runTests(sumExercise, file, { timeoutMs: 500 });
  assert.equal(report.status, "failed");
  assert.match(report.results[0].error ?? "", /Timed out/);
});

test("missing compiler is reported, not thrown", async () => {
  const file = writeTemp("int main(){}\n");
  const report = await runTests(sumExercise, file, { cppCompiler: "definitely-not-a-compiler" });
  assert.equal(report.status, "toolchain_missing");
});
