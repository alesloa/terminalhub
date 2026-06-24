/** base64 ↔ raw bytes, browser-side (atob/btoa). Shared by the binary viewers/editors so the light
 *  reader (PdfView) doesn't have to pull in the heavy editor deps just for a decode. */

/** Decode a base64 payload to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64, chunked so a large buffer doesn't blow the argument limit of fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** The bytes of a `data:...;base64,...` URL (e.g. a canvas PNG export). */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  return base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1));
}
