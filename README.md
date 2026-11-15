# Socratic Dev 🦉

A VS Code extension that tutors you through C++ and C# exercises **by asking questions instead of writing your code**.

Autocomplete finishes your line. The Professor asks you what `i` is on the last iteration until you notice the off-by-one yourself.

- **Syntax errors:** the Professor tells you straight up (semicolons aren't a learning experience).
- **Logic, edge cases, design:** you get guiding questions, never the answer. Hints get sharper the longer you stay stuck.
- **Tests:** each exercise has stdin/stdout test cases, including hidden ones. Failures go to the Professor as context.

## Requirements

- VS Code 1.95+
- Node.js 20+ (only to build the extension)
- **C++:** `g++` or `clang++` on your PATH. On Windows the easiest route is [MSYS2](https://www.msys2.org/) (`pacman -S mingw-w64-ucrt-x86_64-gcc`), then add `C:\msys64\ucrt64\bin` to PATH.
- **C#:** the [.NET 8 SDK](https://dotnet.microsoft.com/download) or newer (`dotnet --version` should work)
- An Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

## Run it

```bash
git clone https://github.com/Vitor5Furiato/socratic-dev.git
cd socratic-dev
npm install
code .
```

Then press **F5**. A second VS Code window (the "Extension Development Host") opens with the extension loaded:

1. Click the 🦉 owl in the activity bar.
2. **Start exercise** → pick one. The starter file opens in `~/socratic-exercises/` (your work is saved there, and picking the exercise again resumes it).
3. Write code, hit **Run tests**, then **Ask** the Professor (an empty question means "look at my code").
4. On the first ask it prompts for your API key and stores it in VS Code's secret storage.

## Settings

| Setting | Default | |
|---|---|---|
| `socraticDev.model` | `claude-opus-5-5` | Cheaper: `claude-sonnet-5-5`, `claude-haiku-5-5` |
| `socraticDev.effort` | `medium` | `low` is faster and cheaper, `high` thinks harder |
| `socraticDev.workspaceFolder` | `~/socratic-exercises` | Where your exercise files live |
| `socraticDev.cppCompiler` | `g++` | Or `clang++` |

## Project layout

```
src/brain/        Tutor logic. No VS Code imports, so it can later power a CLI or web version.
  tutor.ts        System prompt + Claude API calls (streaming, conversation history)
  runner.ts       Compiles and runs your code against the test cases
  exercises.ts    Loads exercises from exercises/
src/extension.ts  VS Code glue: commands, files, API key storage
src/panel.ts      Sidebar webview host
media/            Webview UI (panel.js, panel.css)
exercises/        <language>/<id>/exercise.json + starter file
```

## Adding an exercise

Create `exercises/cpp/04-something/exercise.json` plus the starter file. Copy an existing one for the format. `tutorNotes` are private hints for the Professor (common mistakes, what the hidden tests check) and are never shown to you. Run `npm test` to check that it loads.

## Tests

```bash
npm test
```
