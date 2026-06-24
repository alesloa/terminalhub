import { spawn } from "node:child_process";

/**
 * Symmetric-encrypt `plaintext` under `passphrase` via the host's gpg, returning an
 * ASCII-armored OpenPGP message (the same format the Yopass/onetime viewer decrypts).
 *
 * gpg is spawned as a separate, arms-length process — it is never bundled or linked, so
 * its license does not attach to Terminal Hub (same model as the language servers). The
 * passphrase is written to file descriptor 3 rather than passed on argv, so it never shows
 * up in the host's process list. Rejects if gpg is missing (ENOENT) or exits non-zero.
 */
export function encryptSymmetric(plaintext: string, passphrase: string, gpgBin = "gpg"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      gpgBin,
      [
        "--batch",
        "--yes",
        "--quiet",
        "--symmetric",
        "--armor",
        "--cipher-algo",
        "AES256",
        "--passphrase-fd",
        "3",
        "--pinentry-mode",
        "loopback",
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );

    let out = "";
    let err = "";
    child.stdout!.on("data", (d) => (out += d));
    child.stderr!.on("data", (d) => (err += d));
    child.on("error", reject); // spawn failure, e.g. gpg not installed (ENOENT)
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`gpg exited ${code}: ${err.trim() || "unknown error"}`));
    });

    // When the binary is missing the pipes break; the failure is already reported via the
    // "error" event, so swallow EPIPE on the writes to keep it from surfacing unhandled.
    const passFd = child.stdio[3] as NodeJS.WritableStream;
    passFd.on("error", () => {});
    child.stdin!.on("error", () => {});
    passFd.end(passphrase);
    child.stdin!.end(plaintext);
  });
}
