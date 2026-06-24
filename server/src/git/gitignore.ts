import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Default-`.gitignore` generation for a freshly-initialized repo. Detects which stack(s) a folder
 * holds (by marker files, source extensions, or build dirs) and composes a `.gitignore` from a common
 * base (OS junk, logs, and — the important part — `.env`/secrets) plus one section per detected stack,
 * so a brand-new repo never commits `node_modules/`, `target/`, `.env`, etc. Multiple stacks stack
 * (a folder with both `package.json` and `Cargo.toml` gets Node *and* Rust sections).
 */

interface Ecosystem {
  key: string;
  label: string;
  markers?: string[];    // top-level files that identify the stack (package.json, Cargo.toml…)
  exts?: string[];       // source extensions that identify it when no marker file is present
  dirs?: string[];       // build/dep dirs that strongly imply it (node_modules, target…)
  lines: string[];       // the ignore rules for this stack
}

// Order here is the order sections appear in the generated file. Each section mirrors the conventional
// GitHub `.gitignore` template for that stack, trimmed to the rules that actually matter day to day.
const ECOSYSTEMS: Ecosystem[] = [
  {
    key: "node", label: "Node",
    markers: ["package.json"], exts: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"], dirs: ["node_modules"],
    lines: [
      "node_modules/", "dist/", "build/", ".next/", ".nuxt/", ".output/", ".turbo/",
      ".cache/", ".parcel-cache/", ".vite/", ".svelte-kit/", "coverage/", "*.tsbuildinfo",
      ".pnp.*", "npm-debug.log*", "yarn-debug.log*", "yarn-error.log*", "pnpm-debug.log*",
    ],
  },
  {
    key: "python", label: "Python",
    markers: ["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "Pipfile"], exts: [".py"],
    dirs: ["__pycache__", ".venv", "venv"],
    lines: [
      "__pycache__/", "*.py[cod]", "*$py.class", ".venv/", "venv/", "env/",
      "*.egg-info/", ".eggs/", ".pytest_cache/", ".mypy_cache/", ".ruff_cache/", ".tox/", "build/", "dist/",
    ],
  },
  {
    key: "rust", label: "Rust",
    markers: ["Cargo.toml"], exts: [".rs"], dirs: ["target"],
    lines: ["/target/", "**/*.rs.bk"],
  },
  {
    key: "go", label: "Go",
    markers: ["go.mod"], exts: [".go"],
    lines: ["bin/", "*.exe", "*.exe~", "*.test", "*.out", "vendor/"],
  },
  {
    key: "java", label: "Java/Gradle",
    markers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"], exts: [".java", ".kt", ".kts"], dirs: [".gradle"],
    lines: ["target/", "build/", ".gradle/", "*.class", "*.jar", "*.war", "hs_err_pid*"],
  },
  {
    key: "dotnet", label: ".NET",
    exts: [".csproj", ".fsproj", ".sln", ".cs"], dirs: ["bin", "obj"],
    lines: ["bin/", "obj/", "*.user", ".vs/"],
  },
  {
    key: "php", label: "PHP",
    markers: ["composer.json"], exts: [".php"],
    lines: ["/vendor/", "composer.phar"],
  },
  {
    key: "ruby", label: "Ruby",
    markers: ["Gemfile"], exts: [".rb"],
    lines: ["/.bundle/", "/vendor/bundle", "*.gem", "/log/*", "/tmp/*"],
  },
  {
    key: "swift", label: "Swift",
    markers: ["Package.swift"], exts: [".swift"], dirs: [".build"],
    lines: [".build/", "DerivedData/", "*.xcodeproj/xcuserdata/"],
  },
  {
    key: "elixir", label: "Elixir",
    markers: ["mix.exs"], exts: [".ex", ".exs"], dirs: ["_build"],
    lines: ["/_build/", "/deps/", "/cover/", "*.ez", "erl_crash.dump"],
  },
];

export const ECOSYSTEM_LABELS: Record<string, string> = Object.fromEntries(ECOSYSTEMS.map(e => [e.key, e.label]));

// Always written, regardless of stack: OS/editor cruft, logs, and env/secret files. The `.env.*`
// rule plus the `!`-negations keep real secrets out while still tracking the example files.
const BASE_LINES = [
  "# OS / editor",
  ".DS_Store", "Thumbs.db", "desktop.ini", ".idea/", "*.swp", "*.swo", "*~",
  "",
  "# Logs",
  "*.log", "logs/",
  "",
  "# Environment / secrets",
  ".env", ".env.*", "!.env.example", "!.env.sample", "*.pem",
];

/** Which stacks a folder holds (keys), by top-level marker files, source extensions, or build dirs. */
export async function detectEcosystems(cwd: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(cwd, { withFileTypes: true }); }
  catch { return []; }
  const names = new Set(entries.map(e => e.name));
  const dirs = new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
  const exts = new Set(entries.filter(e => e.isFile()).map(e => path.extname(e.name).toLowerCase()).filter(Boolean));
  return ECOSYSTEMS.filter(eco =>
    eco.markers?.some(m => names.has(m)) ||
    eco.dirs?.some(d => dirs.has(d)) ||
    eco.exts?.some(x => exts.has(x)),
  ).map(eco => eco.key);
}

/** Compose the `.gitignore` text: header + always-on base + one section per detected stack. */
export function buildGitignore(ecoKeys: string[]): string {
  const sections = ECOSYSTEMS
    .filter(eco => ecoKeys.includes(eco.key))
    .flatMap(eco => [`# ${eco.label}`, ...eco.lines, ""]);
  const body = ["# .gitignore — sensible defaults", "", ...BASE_LINES, "", ...sections].join("\n");
  return body.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * Write a generated `.gitignore` into `cwd`, UNLESS one already exists (never clobber the user's own).
 * `ecoKeys` overrides auto-detection when given. Returns whether it wrote and the detected stacks, so
 * the caller can report what happened.
 */
export async function writeGitignore(cwd: string, ecoKeys?: string[]): Promise<{ wrote: boolean; ecosystems: string[] }> {
  const ecosystems = ecoKeys ?? await detectEcosystems(cwd);
  const target = path.join(cwd, ".gitignore");
  try { await fs.access(target); return { wrote: false, ecosystems }; } // already there → keep it
  catch { /* ENOENT → write it below */ }
  await fs.writeFile(target, buildGitignore(ecosystems), "utf8");
  return { wrote: true, ecosystems };
}

/** Detected stacks (key + label) and whether a `.gitignore` already exists — for the init dialog's preview. */
export async function gitignorePreview(cwd: string): Promise<{ ecosystems: { key: string; label: string }[]; exists: boolean }> {
  const keys = await detectEcosystems(cwd);
  let exists = false;
  try { await fs.access(path.join(cwd, ".gitignore")); exists = true; } catch { /* none */ }
  return { ecosystems: keys.map(k => ({ key: k, label: ECOSYSTEM_LABELS[k] ?? k })), exists };
}
