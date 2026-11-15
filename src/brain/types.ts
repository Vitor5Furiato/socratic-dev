// Shared types for the tutor "brain". Nothing in src/brain may import `vscode`,
// so this module can later power a CLI or web version unchanged.

export type Language = "cpp" | "csharp";

export interface TestCase {
  /** Text fed to the program on stdin. */
  input: string;
  /** Exact expected stdout (trailing whitespace is ignored when comparing). */
  expected: string;
  /** Optional label shown to the learner, e.g. "empty input". */
  name?: string;
  /** Hidden tests are run but their input/expected are not shown to the learner or the tutor. */
  hidden?: boolean;
}

export interface Exercise {
  id: string;
  title: string;
  language: Language;
  topic: string;
  difficulty: 1 | 2 | 3;
  /** Problem statement in Markdown. */
  prompt: string;
  /** File name of the starter code inside the exercise folder (e.g. "main.cpp"). */
  starterFile: string;
  tests: TestCase[];
  /** Notes for the tutor only: the concept being trained, common pitfalls. Never shown to the learner. */
  tutorNotes?: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  hidden: boolean;
  input?: string;
  expected?: string;
  actual?: string;
  error?: string;
}

export interface RunReport {
  /** "compile_error" means no test ran. */
  status: "passed" | "failed" | "compile_error" | "toolchain_missing";
  compilerOutput?: string;
  results: TestResult[];
}
