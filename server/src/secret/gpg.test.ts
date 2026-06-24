import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { encryptSymmetric } from "./gpg.js";

/** Decrypt an armored gpg message the same way the Yopass viewer would, to prove round-trip. */
function gpgDecrypt(armored: string, passphrase: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "gpg",
      ["--batch", "--yes", "--quiet", "--decrypt", "--passphrase-fd", "3", "--pinentry-mode", "loopback"],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
    (child.stdio[3] as NodeJS.WritableStream).end(passphrase);
    child.stdin!.end(armored);
  });
}

describe("encryptSymmetric", () => {
  it("produces an armored OpenPGP message that round-trips back to the plaintext", async () => {
    const plaintext = "hello from your agent\nsecond line";
    const passphrase = "Zx9KQ2mABcdEfgHiJklMno";

    const armored = await encryptSymmetric(plaintext, passphrase);

    expect(armored).toContain("-----BEGIN PGP MESSAGE-----");
    expect(armored).toContain("-----END PGP MESSAGE-----");
    expect(await gpgDecrypt(armored, passphrase)).toBe(plaintext);
  });

  it("rejects when the gpg binary is missing", async () => {
    await expect(encryptSymmetric("x", "pass", "/nonexistent/definitely-not-gpg")).rejects.toThrow();
  });
});
