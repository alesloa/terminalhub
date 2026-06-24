// A curated starter pack of Claude Code slash commands shipped WITH terminalhub, so the wizard's
// "Available to install" list is useful even when the user has no global commands of their own.
// These are real, functional commands (the kind people keep in ~/.claude/commands) — installing one
// writes its `content` verbatim to <workspace>/.claude/commands/<name>.md. A user's own global command
// with the same name always wins (the catalog/seeder prefer the on-disk file over the bundled copy).
//
// Categories map to the wizard's left-rail buckets (Git / Code / Writing / AI / Other). Keep each
// command's body in plain prose with `$ARGUMENTS` placeholders — no triple-backtick fences needed.

export interface BundledCommand {
  name: string;
  description: string;
  category: string;
  content: string;
}

/** Wrap a one-line description + body into a slash-command markdown file. */
function cmd(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

export const BUNDLED_COMMANDS: BundledCommand[] = [
  // ---- Git ----
  {
    name: "commit",
    category: "Git",
    description: "Stage changes and write a clean conventional-commit message.",
    content: cmd(
      "Stage changes and write a clean conventional-commit message.",
      `Review the working tree with git status and git diff. Stage the files relevant to one logical change, then create a single commit using Conventional Commits format: type(scope): subject, where type is one of feat, fix, refactor, perf, docs, test, chore, build, or ci.

Keep the subject in the imperative mood and under 72 characters. If the change is non-trivial, add a short body explaining WHY, not what. Do not push. Show the final message before committing.

If the user passed $ARGUMENTS, treat it as a hint about what the commit should focus on.`,
    ),
  },
  {
    name: "create-pr",
    category: "Git",
    description: "Open a GitHub pull request for the current branch.",
    content: cmd(
      "Open a GitHub pull request for the current branch.",
      `Create a pull request for the current branch with the gh CLI. First make sure the branch is pushed (git push -u origin HEAD if needed). Then run gh pr create with:

- a clear, imperative title (use $ARGUMENTS as the title if provided),
- a body containing a Summary section (what changed and why) and a Test plan section (how it was verified), both derived from the actual diff against the base branch.

Print the PR URL when done. Do not merge.`,
    ),
  },
  {
    name: "review",
    category: "Git",
    description: "Review the current diff for bugs, risks, and style.",
    content: cmd(
      "Review the current diff for bugs, risks, and style.",
      `Run git diff against the base branch (or review $ARGUMENTS if given). Review the changes for: correctness bugs, unhandled edge cases, security issues, performance traps, and inconsistencies with the surrounding code's style.

Group findings by severity (blocking, should-fix, nitpick). Reference each with a file:line. For every issue, suggest a concrete fix. If the change looks solid, say so plainly.`,
    ),
  },
  {
    name: "fix-issue",
    category: "Git",
    description: "Investigate and fix a GitHub issue by number.",
    content: cmd(
      "Investigate and fix a GitHub issue by number.",
      `Read GitHub issue $ARGUMENTS with gh issue view (include comments). Reproduce the reported problem, trace it to its root cause, and implement a fix. Add or update a test that fails before the fix and passes after.

Summarize the root cause and the fix in a few lines. Reference the issue number in your eventual commit.`,
    ),
  },

  // ---- Code ----
  {
    name: "explain",
    category: "Code",
    description: "Explain how a file or symbol works.",
    content: cmd(
      "Explain how a file or symbol works.",
      `Explain $ARGUMENTS in plain language. Cover: its purpose, the key logic step by step, its inputs and outputs, and how it fits into the wider codebase (who calls it, what it depends on). Call out any non-obvious behavior, side effects, or gotchas. Keep it concrete and skip the boilerplate.`,
    ),
  },
  {
    name: "refactor",
    category: "Code",
    description: "Refactor code for clarity without changing behavior.",
    content: cmd(
      "Refactor code for clarity without changing behavior.",
      `Refactor $ARGUMENTS to improve readability and structure while preserving its behavior exactly. Extract helpers, clarify names, remove duplication, and simplify control flow. Do not change the public API unless asked.

After refactoring, run the project's tests (or build) and confirm nothing broke. Summarize what you changed and why.`,
    ),
  },
  {
    name: "optimize",
    category: "Code",
    description: "Find and fix performance bottlenecks.",
    content: cmd(
      "Find and fix performance bottlenecks.",
      `Analyze $ARGUMENTS for performance problems: needless allocations, repeated work in loops, N+1 queries, blocking I/O, and poor algorithmic complexity. Identify the highest-impact issues first.

Apply the fixes that are safe and well-understood, and explain the expected improvement for each. Flag anything that needs measurement before changing.`,
    ),
  },
  {
    name: "add-tests",
    category: "Code",
    description: "Write thorough tests for code.",
    content: cmd(
      "Write thorough tests for code.",
      `Write tests for $ARGUMENTS. Cover the happy path, boundary and edge cases, and error handling. Match the project's existing test framework, file layout, and naming conventions.

Run the tests and make sure they pass. Prefer testing real behavior over mocks; only mock what is genuinely external.`,
    ),
  },
  {
    name: "scaffold",
    category: "Code",
    description: "Scaffold a new component or module from a description.",
    content: cmd(
      "Scaffold a new component or module from a description.",
      `Create the files for $ARGUMENTS, following the patterns already established in this codebase: directory structure, naming, imports, and styling. Wire the new code into wherever it needs to be registered or exported.

Leave no TODOs or placeholders. Make the build and type checker pass before you finish.`,
    ),
  },
  {
    name: "clean",
    category: "Code",
    description: "Remove dead code and unused imports.",
    content: cmd(
      "Remove dead code and unused imports.",
      `Find dead code in $ARGUMENTS (or the current changes): unused variables, unreachable branches, commented-out blocks, and unused imports or dependencies. Remove them safely.

Be conservative — do not delete anything that is exported and may be used elsewhere without checking first. Run the build and tests afterward to confirm nothing broke.`,
    ),
  },
  {
    name: "types",
    category: "Code",
    description: "Add or strengthen type annotations.",
    content: cmd(
      "Add or strengthen type annotations.",
      `Strengthen the types in $ARGUMENTS. Replace any and unknown with precise types, add missing return types, and tighten loose signatures. Introduce shared types/interfaces where it reduces duplication.

Do not change runtime behavior. Make the type checker pass with no new errors.`,
    ),
  },
  {
    name: "debug",
    category: "Code",
    description: "Systematically debug an error or failing test.",
    content: cmd(
      "Systematically debug an error or failing test.",
      `Debug $ARGUMENTS. Work the problem methodically: reproduce it reliably, form a hypothesis about the root cause, and verify that hypothesis with a focused log line or a minimal test before changing anything.

Fix the root cause, not the symptom. Confirm the fix resolves the original failure and does not break other tests. Explain what was actually wrong.`,
    ),
  },

  // ---- Writing / Docs ----
  {
    name: "document",
    category: "Writing",
    description: "Add docstrings and comments to code.",
    content: cmd(
      "Add docstrings and comments to code.",
      `Add documentation to $ARGUMENTS. Write clear docstrings (JSDoc/equivalent) for the public functions, classes, and types, describing parameters, return values, and any thrown errors. Add brief inline comments only where the logic is non-obvious.

Explain the why, not the what. Do not comment trivial lines or restate the code.`,
    ),
  },
  {
    name: "readme",
    category: "Writing",
    description: "Generate or update the project README.",
    content: cmd(
      "Generate or update the project README.",
      `Write or update README.md for this project. Derive everything from the actual code and package manifest, not assumptions. Include: a one-line description, key features, install steps, usage examples, the important scripts/commands, and configuration. Keep it accurate, current, and skimmable.`,
    ),
  },
  {
    name: "changelog",
    category: "Writing",
    description: "Draft a changelog from recent git history.",
    content: cmd(
      "Draft a changelog from recent git history.",
      `Read the git history since the last release tag (or since $ARGUMENTS if provided). Summarize it into a changelog in Keep a Changelog style, grouped into Added, Changed, Fixed, Removed, and Deprecated.

Write each entry for users, describing the impact — not a commit-by-commit dump. Omit purely internal noise.`,
    ),
  },
  {
    name: "adr",
    category: "Writing",
    description: "Write an Architecture Decision Record.",
    content: cmd(
      "Write an Architecture Decision Record.",
      `Write an ADR for the decision: $ARGUMENTS. Use the standard structure: Title, Status, Context (the forces and constraints), Decision (what was chosen and why), Consequences (positive and negative), and Alternatives considered. Be concise and concrete. Save it under docs/adr/ with a sequential number if that directory convention exists.`,
    ),
  },

  // ---- AI / Meta ----
  {
    name: "summarize",
    category: "AI",
    description: "Summarize a file, diff, or PR.",
    content: cmd(
      "Summarize a file, diff, or PR.",
      `Summarize $ARGUMENTS into its key points: what it does or what changed, the most important details, and anything risky or worth a closer look. Lead with the single most important line, then a short bulleted breakdown. Keep it tight.`,
    ),
  },
  {
    name: "prompt",
    category: "AI",
    description: "Improve a prompt for an LLM.",
    content: cmd(
      "Improve a prompt for an LLM.",
      `Rewrite the prompt in $ARGUMENTS to be clearer and more effective. Make the task explicit, state the constraints, specify the desired output format, and add a short example if it helps. Remove ambiguity and filler. Then briefly explain the main changes you made and why.`,
    ),
  },

  // ---- Other ----
  {
    name: "todo",
    category: "Other",
    description: "List all TODO / FIXME / HACK comments.",
    content: cmd(
      "List all TODO / FIXME / HACK comments.",
      `Search the codebase for TODO, FIXME, HACK, and XXX markers. List them grouped by file with line numbers and a one-line summary of each. Order them by apparent urgency, and flag any that look like real bugs or security gaps rather than routine cleanup.`,
    ),
  },
  {
    name: "security-review",
    category: "Other",
    description: "Scan changes for security issues.",
    content: cmd(
      "Scan changes for security issues.",
      `Review $ARGUMENTS (or the current diff) for security problems: injection (SQL/command/XSS), secrets or credentials committed to code, missing authentication or authorization checks, unsafe deserialization, path traversal, SSRF, and risky dependencies.

Report each finding with its severity, the affected file:line, why it is exploitable, and a concrete fix. If nothing stands out, say so.`,
    ),
  },
];

const BY_NAME = new Map(BUNDLED_COMMANDS.map((c) => [c.name, c]));

/** The bundled command with this name, or undefined. Used by the seeder to write its content and by
 *  the catalog to offer it as installable. */
export function bundledCommandByName(name: string): BundledCommand | undefined {
  return BY_NAME.get(name);
}
