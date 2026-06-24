import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("skills/frontmatter", () => {
  it("extracts name and description from a fenced block", () => {
    const md = `---\nname: pdf-tools\ndescription: Use when working with PDFs\n---\n\n# body`;
    expect(parseFrontmatter(md)).toEqual({ name: "pdf-tools", description: "Use when working with PDFs" });
  });
  it("strips matching double and single quotes", () => {
    expect(parseFrontmatter(`---\nname: "quoted"\ndescription: 'single'\n---`)).toEqual({
      name: "quoted", description: "single",
    });
  });
  it("keeps colons inside a value (splits on the first colon only)", () => {
    const md = `---\nname: x\ndescription: Use when X: then do Y\n---`;
    expect(parseFrontmatter(md).description).toBe("Use when X: then do Y");
  });
  it("ignores keys other than name and description", () => {
    const md = `---\nname: a\nlicense: MIT\nmetadata:\n  internal: true\ndescription: d\n---`;
    expect(parseFrontmatter(md)).toEqual({ name: "a", description: "d" });
  });
  it("tolerates CRLF, a BOM, and leading blank lines", () => {
    const md = `﻿\r\n---\r\nname: crlf\r\ndescription: works\r\n---\r\n`;
    expect(parseFrontmatter(md)).toEqual({ name: "crlf", description: "works" });
  });
  it("returns nulls when there is no frontmatter", () => {
    expect(parseFrontmatter("# just a heading\n")).toEqual({ name: null, description: null });
  });
  it("returns a null for a field that is absent", () => {
    expect(parseFrontmatter(`---\nname: only-name\n---`)).toEqual({ name: "only-name", description: null });
  });
});
