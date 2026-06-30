import { describe, it, expect } from "vitest";
import { createGithubController, GhError, parseRemoteOwner, normalizeTopics } from "./github.js";
import type { GhRunner, GhResult } from "./github.js";

/** Fake gh runner that records the arg vectors (and per-call env) and returns scripted results. */
function fakeRunner(handler: (args: string[], cwd: string) => Partial<GhResult>): {
  run: GhRunner; calls: string[][]; envs: (Record<string, string> | undefined)[];
} {
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const run: GhRunner = async (args, cwd, env) => {
    calls.push(args);
    envs.push(env);
    return { stdout: "", stderr: "", code: 0, ...handler(args, cwd) };
  };
  return { run, calls, envs };
}

describe("normalizeTopics", () => {
  it("lowercases, hyphenates non-alphanumerics, drops empties, dedupes, caps at 20", () => {
    expect(normalizeTopics(["SSH", "ssh", " Cross Platform ", "!!!", "rust"])).toEqual(["ssh", "cross-platform", "rust"]);
    expect(normalizeTopics(undefined)).toEqual([]);
    expect(normalizeTopics(Array.from({ length: 25 }, (_, i) => `t${i}`)).length).toBe(20);
  });
});

describe("createGithubController.publish", () => {
  it("creates a private repo from the local source under the chosen owner and pushes", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "repo" ? { stdout: "https://github.com/me/proj\n" } : {});
    const res = await createGithubController(run).publish("/work/proj", {
      name: "proj", owner: "me", visibility: "private", description: "a thing",
    });
    expect(res).toEqual({ url: "https://github.com/me/proj" });
    expect(calls[0]).toEqual([
      "repo", "create", "me/proj",
      "--private", "--source", "/work/proj", "--remote", "origin", "--push",
      "--description", "a thing",
    ]);
  });

  it("uses --public and omits --description when none is given", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "repo" ? { stdout: "https://github.com/org/x\n" } : {});
    await createGithubController(run).publish("/x", { name: "x", owner: "org", visibility: "public" });
    expect(calls[0]).toContain("--public");
    expect(calls[0]).not.toContain("--private");
    expect(calls[0]).not.toContain("--description");
  });

  it("tags topics in a follow-up `repo edit` after create, normalised + deduped", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "repo" && a[1] === "create" ? { stdout: "https://github.com/me/proj\n" } : {});
    await createGithubController(run).publish("/work/proj", {
      name: "proj", owner: "me", visibility: "public", topics: ["SSH", "ssh", "Cross Platform", "", "rust"],
    });
    expect(calls[0][1]).toBe("create");
    expect(calls[1]).toEqual(["repo", "edit", "me/proj", "--add-topic", "ssh,cross-platform,rust"]);
  });

  it("makes no `repo edit` call when no topics are given", async () => {
    const { run, calls } = fakeRunner((a) => a[0] === "repo" ? { stdout: "https://github.com/me/x\n" } : {});
    await createGithubController(run).publish("/x", { name: "x", owner: "me", visibility: "private" });
    expect(calls.some(c => c[1] === "edit")).toBe(false);
  });

  it("falls back to a constructed URL when gh prints none", async () => {
    const { run } = fakeRunner((a) => a[0] === "repo" ? { stdout: "Created repository\n" } : {});
    const res = await createGithubController(run).publish("/x", { name: "proj", owner: "me", visibility: "private" });
    expect(res.url).toBe("https://github.com/me/proj");
  });

  it("throws GhError carrying gh's stderr when create fails", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "GraphQL: Name already exists on this account\n" }));
    const c = createGithubController(run);
    await expect(c.publish("/x", { name: "dup", owner: "me", visibility: "private" })).rejects.toThrow(GhError);
    await expect(c.publish("/x", { name: "dup", owner: "me", visibility: "private" })).rejects.toThrow("Name already exists");
  });

  it("creates under a specific signed-in account by injecting its token (no auth switch)", async () => {
    const { run, calls, envs } = fakeRunner((a) => {
      if (a[0] === "auth" && a[1] === "token") return { stdout: "ghp_work\n" };
      if (a[0] === "repo") return { stdout: "https://github.com/work/proj\n" };
      return {};
    });
    await createGithubController(run).publish("/work/proj", {
      name: "proj", owner: "work", visibility: "private",
      account: { login: "work", host: "github.com" },
    });
    // First resolves the account's token without flipping the active account…
    expect(calls[0]).toEqual(["auth", "token", "--hostname", "github.com", "--user", "work"]);
    expect(calls).not.toContainEqual(["auth", "switch"]);
    // …then `repo create` runs scoped to that token.
    expect(calls[1][0]).toBe("repo");
    expect(envs[1]).toEqual({ GH_TOKEN: "ghp_work", GH_HOST: "github.com" });
  });
});

describe("createGithubController.owners", () => {
  it("returns the authed login plus the orgs gh can create in", async () => {
    const { run, calls } = fakeRunner((a) => {
      if (a[1] === "user") return { stdout: "octocat\n" };
      if (a[1] === "user/orgs") return { stdout: "acme\nwidgets\n" };
      return {};
    });
    const res = await createGithubController(run).owners("/x");
    expect(res).toEqual({ login: "octocat", orgs: ["acme", "widgets"] });
    expect(calls[0]).toEqual(["api", "user", "--jq", ".login"]);
    expect(calls[1]).toEqual(["api", "user/orgs", "--jq", ".[].login"]);
  });

  it("returns empty orgs when the orgs lookup fails", async () => {
    const { run } = fakeRunner((a) => {
      if (a[1] === "user") return { stdout: "octocat\n" };
      if (a[1] === "user/orgs") return { code: 1, stderr: "boom" };
      return {};
    });
    expect(await createGithubController(run).owners("/x")).toEqual({ login: "octocat", orgs: [] });
  });

  it("scopes the owner lookup to a given account's token", async () => {
    const { run, calls, envs } = fakeRunner((a) => {
      if (a[0] === "auth" && a[1] === "token") return { stdout: "ghp_work\n" };
      if (a[1] === "user") return { stdout: "work\n" };
      if (a[1] === "user/orgs") return { stdout: "acme\n" };
      return {};
    });
    const res = await createGithubController(run).owners("/x", { login: "work", host: "github.com" });
    expect(res).toEqual({ login: "work", orgs: ["acme"] });
    expect(calls[0]).toEqual(["auth", "token", "--hostname", "github.com", "--user", "work"]);
    expect(envs[1]).toEqual({ GH_TOKEN: "ghp_work", GH_HOST: "github.com" }); // user lookup
    expect(envs[2]).toEqual({ GH_TOKEN: "ghp_work", GH_HOST: "github.com" }); // orgs lookup
  });
});

describe("createGithubController PR actions", () => {
  it("commentPr posts a comment via gh pr comment", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGithubController(run).commentPr("/x", 7, "looks good");
    expect(calls[0]).toEqual(["pr", "comment", "7", "--body", "looks good"]);
  });

  it("mergePr merges with the chosen method", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGithubController(run).mergePr("/x", 7, "squash");
    expect(calls[0]).toEqual(["pr", "merge", "7", "--squash"]);
  });

  it("mergePr maps merge / rebase to their gh flags", async () => {
    const merge = fakeRunner(() => ({}));
    await createGithubController(merge.run).mergePr("/x", 7, "merge");
    expect(merge.calls[0]).toEqual(["pr", "merge", "7", "--merge"]);
    const rebase = fakeRunner(() => ({}));
    await createGithubController(rebase.run).mergePr("/x", 7, "rebase");
    expect(rebase.calls[0]).toEqual(["pr", "merge", "7", "--rebase"]);
  });

  it("closePr closes the PR", async () => {
    const { run, calls } = fakeRunner(() => ({}));
    await createGithubController(run).closePr("/x", 7);
    expect(calls[0]).toEqual(["pr", "close", "7"]);
  });

  it("throws GhError carrying gh's stderr when an action fails", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "Pull request is not mergeable\n" }));
    await expect(createGithubController(run).mergePr("/x", 7, "merge")).rejects.toThrow(GhError);
    await expect(createGithubController(run).mergePr("/x", 7, "merge")).rejects.toThrow("not mergeable");
  });

  it("createPr opens a PR with title, body, base and draft, returning the printed url", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "https://github.com/me/proj/pull/12\n" }));
    const res = await createGithubController(run).createPr("/x", { title: "Add X", body: "why", base: "main", draft: true });
    expect(calls[0]).toEqual(["pr", "create", "--title", "Add X", "--body", "why", "--base", "main", "--draft"]);
    expect(res).toEqual({ url: "https://github.com/me/proj/pull/12" });
  });

  it("createPr passes an empty body and omits --base / --draft when unset", async () => {
    const { run, calls } = fakeRunner(() => ({ stdout: "https://github.com/me/proj/pull/13\n" }));
    await createGithubController(run).createPr("/x", { title: "Quick fix" });
    expect(calls[0]).toEqual(["pr", "create", "--title", "Quick fix", "--body", ""]);
  });

  it("createPr throws GhError carrying gh's stderr when create fails", async () => {
    const { run } = fakeRunner(() => ({ code: 1, stderr: "must first push the current branch\n" }));
    await expect(createGithubController(run).createPr("/x", { title: "X" })).rejects.toThrow(GhError);
    await expect(createGithubController(run).createPr("/x", { title: "X" })).rejects.toThrow("must first push");
  });
});

describe("parseRemoteOwner", () => {
  it("parses https remotes with and without .git / trailing slash", () => {
    expect(parseRemoteOwner("https://github.com/Contoso-Labs/chat-service.git"))
      .toEqual({ host: "github.com", owner: "Contoso-Labs", repo: "chat-service" });
    expect(parseRemoteOwner("https://github.com/me/proj")).toEqual({ host: "github.com", owner: "me", repo: "proj" });
    expect(parseRemoteOwner("https://github.com/me/proj/")).toEqual({ host: "github.com", owner: "me", repo: "proj" });
  });

  it("parses ssh shorthand and ssh:// remotes", () => {
    expect(parseRemoteOwner("git@github.com:me/proj.git")).toEqual({ host: "github.com", owner: "me", repo: "proj" });
    expect(parseRemoteOwner("ssh://git@github.com/me/proj.git")).toEqual({ host: "github.com", owner: "me", repo: "proj" });
  });

  it("returns null for empty or unrecognizable remotes", () => {
    expect(parseRemoteOwner("")).toBeNull();
    expect(parseRemoteOwner("/local/only")).toBeNull();
  });
});

describe("createGithubController.repoAuth", () => {
  // gh runner with two signed-in accounts: active `alesloa`, plus `Contoso-Labs`. `auth token` hands
  // back a token named after the requested --user so assertions can tell which account was scoped.
  const twoAccounts = () => fakeRunner((a) => {
    if (a[0] === "--version") return { stdout: "gh version 2.0\n" };
    if (a[0] === "auth" && a[1] === "status") return {
      stdout:
        "github.com\n" +
        "  ✓ Logged in to github.com account alesloa (keyring)\n" +
        "  - Active account: true\n" +
        "  ✓ Logged in to github.com account Contoso-Labs (keyring)\n" +
        "  - Active account: false\n",
    };
    if (a[0] === "auth" && a[1] === "token") return { stdout: `tok_${a[a.indexOf("--user") + 1]}\n` };
    return {};
  });

  it("pins the owning account's token as primary when a login matches the repo owner", async () => {
    const { run } = twoAccounts();
    const res = await createGithubController(run).repoAuth("https://github.com/Contoso-Labs/chat-service.git");
    expect(res.primary).toEqual({ GH_TOKEN: "tok_Contoso-Labs", GH_HOST: "github.com" });
    expect(res.fallbacks).toEqual([]);
  });

  it("leaves primary unset for an org repo but offers the non-active account as a fallback", async () => {
    const { run } = twoAccounts();
    const res = await createGithubController(run).repoAuth("https://github.com/SomeOrg/widget.git");
    expect(res.primary).toBeUndefined();
    expect(res.fallbacks).toEqual([{ GH_TOKEN: "tok_Contoso-Labs", GH_HOST: "github.com" }]);
  });

  it("is a no-op when the active account already owns the repo (but still lists other fallbacks)", async () => {
    const { run } = twoAccounts();
    const res = await createGithubController(run).repoAuth("https://github.com/alesloa/dotfiles.git");
    expect(res.primary).toBeUndefined();
    expect(res.fallbacks).toEqual([{ GH_TOKEN: "tok_Contoso-Labs", GH_HOST: "github.com" }]);
  });

  it("is a no-op with only one signed-in account", async () => {
    const { run } = fakeRunner((a) => {
      if (a[0] === "--version") return { stdout: "gh\n" };
      if (a[1] === "status") return { stdout: "github.com\n  ✓ Logged in to github.com account solo\n  - Active account: true\n" };
      return {};
    });
    expect(await createGithubController(run).repoAuth("https://github.com/solo/x.git")).toEqual({ fallbacks: [] });
  });

  it("is a no-op for an unparseable / non-GitHub remote", async () => {
    const { run } = twoAccounts();
    expect(await createGithubController(run).repoAuth("/local/only")).toEqual({ fallbacks: [] });
  });
});
