/**
 * Catalog sources shipped on a fresh install so every server has a browsable skills catalog out of
 * the box. Seeded once on first boot of a real (file) database — see store.ts — and never again, so
 * removing a default later doesn't bring it back. `official` drives the ✓ Official badge: the vendor
 * repos are on, the big community mega-repo is off. The OpenAI/GitHub ones use the `/tree/<ref>/<sub>`
 * form because their skills live in a subfolder (and `.curated` is a dotfile the walker would skip
 * unless it's the scan root).
 */
export const DEFAULT_CATALOG_SOURCES: { source: string; official: boolean }[] = [
  { source: "anthropics/skills", official: true },
  { source: "https://github.com/openai/skills/tree/main/skills/.curated", official: true },
  { source: "https://github.com/github/awesome-copilot/tree/main/skills", official: true },
  { source: "alirezarezvani/claude-skills", official: false },
];
