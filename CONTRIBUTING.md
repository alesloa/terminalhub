# Contributing to Terminal Hub

Contributions are welcome — bug reports, fixes, features, docs. Before you open a pull request,
please read this; it's short and it matters for how Terminal Hub is licensed.

## The deal (read this first)

Terminal Hub is **dual-licensed**: free to everyone under the [AGPL-3.0](LICENSE), and available
under a separate **commercial license** for companies that can't use the AGPL. That business
model only works if the Maintainer holds the rights to ship every line under both licenses.

So, **by contributing you agree to the [Contributor License Agreement](CLA.md).** In plain terms:

- You keep ownership of your code — the CLA is a license grant, not a copyright handover.
- You grant the Maintainer (Ale Sloan) the right to ship your contribution under **any** license,
  including paid/proprietary versions of Terminal Hub.
- You're contributing freely: no payment, no ownership stake, no say in how it's licensed or sold.
- Your reward is attribution in the git history — your commits stay yours in the record.

If that's not for you, that's completely fine — just don't submit a PR.

## How to contribute

1. **Open an issue first** for anything non-trivial, so we can agree on the approach before you
   spend time on it.
2. Fork the repo and branch off `main`.
3. Make your change. Match the surrounding code — small focused files, ESM only, server relative
   imports use `.js` extensions and web imports don't, no files over 1000 lines. See the existing
   code and `docs/` for conventions.
4. Keep the durability model intact: one tmux session per terminal, and closing a browser socket
   must never kill a tmux session. Don't add Docker or swap the core stack.
5. Run the tests: `npm test` (server-side vitest). Add tests for new server behavior.
6. **Sign off your commits** so you certify origin and accept the CLA:

   ```bash
   git commit -s -m "fix: ..."
   ```

   The `-s` adds a `Signed-off-by:` line. By adding it you agree to the
   [Developer Certificate of Origin](https://developercertificate.org/) and to the
   [CLA](CLA.md).
7. Open the pull request and tick the CLA checkbox in the template.

## What gets merged

The Maintainer reviews every PR and may accept, request changes, or decline it. Merging is at the
Maintainer's discretion — opening a PR doesn't guarantee it ships.

Thanks for helping make Terminal Hub better.
