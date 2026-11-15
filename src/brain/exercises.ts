import * as fs from "fs";
import * as path from "path";
import { Exercise, Language } from "./types";

/**
 * Loads every exercise under `root/<language>/<exercise-id>/exercise.json`.
 * The starter file named in the JSON must sit next to it.
 */
export function loadExercises(root: string): Exercise[] {
  const exercises: Exercise[] = [];
  if (!fs.existsSync(root)) return exercises;

  for (const lang of fs.readdirSync(root)) {
    const langDir = path.join(root, lang);
    if (!fs.statSync(langDir).isDirectory()) continue;

    for (const id of fs.readdirSync(langDir)) {
      const jsonPath = path.join(langDir, id, "exercise.json");
      if (!fs.existsSync(jsonPath)) continue;
      const ex = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Exercise;
      validate(ex, jsonPath);
      exercises.push(ex);
    }
  }

  return exercises.sort(
    (a, b) => a.language.localeCompare(b.language) || a.difficulty - b.difficulty || a.id.localeCompare(b.id),
  );
}

export function starterCodePath(root: string, ex: Exercise): string {
  return path.join(root, ex.language, ex.id, ex.starterFile);
}

export function languageLabel(lang: Language): string {
  return lang === "cpp" ? "C++" : "C#";
}

function validate(ex: Exercise, where: string): void {
  const missing = (["id", "title", "language", "prompt", "starterFile", "tests"] as const).filter(
    (k) => ex[k] === undefined,
  );
  if (missing.length) throw new Error(`${where}: missing fields ${missing.join(", ")}`);
  if (ex.language !== "cpp" && ex.language !== "csharp") {
    throw new Error(`${where}: language must be "cpp" or "csharp"`);
  }
}
