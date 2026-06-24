import { describe, it, expect } from "vitest";
import { createStore } from "./store.js";

describe("copilot skill accounts", () => {
  it("creates an account and never exposes the secret in the public list", () => {
    const store = createStore(":memory:");
    const acc = store.createSkillAccount({ skillId: "email", label: "Personal", provider: "gmail", config: { user: "me@gmail.com" }, secret: "app-password" });
    expect(acc.id).toMatch(/^ca_/);
    expect(acc.hasSecret).toBe(true);
    expect((acc as any).secret).toBeUndefined();

    const list = store.listSkillAccounts("email");
    expect(list).toHaveLength(1);
    expect((list[0] as any).secret).toBeUndefined();
    expect(list[0].hasSecret).toBe(true);
    expect(list[0].config).toEqual({ user: "me@gmail.com" });
  });

  it("getSkillAccountSecret returns the secret for server-side use only", () => {
    const store = createStore(":memory:");
    const acc = store.createSkillAccount({ skillId: "email", label: "Work", provider: "outlook", config: { user: "w@x.com" }, secret: "s3cret" });
    expect(store.getSkillAccountSecret(acc.id)?.secret).toBe("s3cret");
    expect(store.getSkillAccountSecret("ca_nope")).toBeUndefined();
  });

  it("scopes the list to the skill", () => {
    const store = createStore(":memory:");
    store.createSkillAccount({ skillId: "email", label: "A", provider: "gmail", config: {}, secret: "x" });
    store.createSkillAccount({ skillId: "other", label: "B", provider: "imap", config: {}, secret: "y" });
    expect(store.listSkillAccounts("email")).toHaveLength(1);
  });

  it("updates label/config and keeps the secret when not given", () => {
    const store = createStore(":memory:");
    const acc = store.createSkillAccount({ skillId: "email", label: "Old", provider: "imap", config: { host: "a" }, secret: "keepme" });
    const upd = store.updateSkillAccount(acc.id, { label: "New", config: { host: "b" } })!;
    expect(upd.label).toBe("New");
    expect(upd.config).toEqual({ host: "b" });
    expect(store.getSkillAccountSecret(acc.id)?.secret).toBe("keepme"); // unchanged
  });

  it("rotates the secret when a new one is given", () => {
    const store = createStore(":memory:");
    const acc = store.createSkillAccount({ skillId: "email", label: "A", provider: "gmail", config: {}, secret: "old" });
    store.updateSkillAccount(acc.id, { secret: "new" });
    expect(store.getSkillAccountSecret(acc.id)?.secret).toBe("new");
  });

  it("deletes an account", () => {
    const store = createStore(":memory:");
    const acc = store.createSkillAccount({ skillId: "email", label: "A", provider: "gmail", config: {}, secret: "x" });
    store.deleteSkillAccount(acc.id);
    expect(store.listSkillAccounts("email")).toHaveLength(0);
    expect(store.getSkillAccountSecret(acc.id)).toBeUndefined();
  });
});
