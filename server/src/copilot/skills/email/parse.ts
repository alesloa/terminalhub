import { simpleParser } from "mailparser";

// Turn a raw MIME message into a short plain-text snippet for the email summary. Prefers the text
// body, falling back to stripped HTML; collapses whitespace and trims to ~200 chars.
export async function parseSnippet(source: Buffer | string): Promise<string> {
  try {
    const mail = await simpleParser(source);
    const body = mail.text || (mail.html ? String(mail.html).replace(/<[^>]+>/g, " ") : "");
    return body.replace(/\s+/g, " ").trim().slice(0, 200);
  } catch {
    return "";
  }
}
