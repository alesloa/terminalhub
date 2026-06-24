import type { BlueprintGraph, BlueprintNode } from "../../../api/types";

// Turn a node graph into a deterministic, agent-readable plan. Pure function — no React, no I/O —
// so it's trivial to reason about and reuse (live preview, copy, and the AI "Polish" input all use
// it). The walk follows edges from the Start node, numbering steps in the order they're reached and
// indenting branches under their labels ("If yes:", "Each pass:", "If it fails:", "If <case>:", …).
// Cycles and orphans are surfaced, never silently dropped, so the spec always reflects the canvas.
//
// Node kinds → plan:
//   start     entry; emits "Goal:" if named, then flows on (not numbered)
//   param     a value provided up front; listed in an "Inputs:" preamble, never a step
//   group     a section header ("— Phase: … —"), not numbered; flow continues through it
//   action    a numbered step; flows on
//   condition numbered "Check:" with If yes / If no branches
//   loop      numbered "Repeat:" with Each pass / When done branches
//   try       numbered "Try:" with If it succeeds / If it fails branches
//   switch    numbered "Decide by:" with one branch per case (+ Otherwise)
//   parallel  numbered "In parallel:" — every outgoing wire is a concurrent branch
//   end       numbered terminal "Done" / "Result"

const SPEC_HEADER =
  "Implement the following program. Follow the steps in order. Where a step branches, take the path that matches the check.";

const labelOf = (n: BlueprintNode) => n.data.label?.trim() || "(unnamed step)";
const descOf = (n: BlueprintNode) => (n.data.description?.trim() ? ` — ${n.data.description.trim()}` : "");

export function graphToSpec(graph: BlueprintGraph): string {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const outgoing = (id: string) => graph.edges.filter(e => e.source === id);
  const outBy = (id: string, handle: string) => outgoing(id).find(e => (e.sourceHandle ?? "") === handle);
  const hasIncoming = (id: string) => graph.edges.some(e => e.target === id);
  const pad = (d: number) => "  ".repeat(d);

  const num = new Map<string, number>(); // node id → printed step number (-1 = visited but unnumbered)
  let counter = 0;
  const lines: string[] = [];

  // A labelled branch: emit the caption, then walk the step wired to that handle (indented), or note
  // the gap so a forgotten branch is visible rather than silently missing.
  const branch = (fromId: string, handle: string, caption: string, depth: number) => {
    lines.push(`${pad(depth)}  - ${caption}`);
    const e = outBy(fromId, handle);
    if (e) walk(e.target, depth + 2);
    else lines.push(`${pad(depth + 2)}(no step yet)`);
  };

  const walk = (id: string, depth: number): void => {
    const node = byId.get(id);
    if (!node) return;

    if (num.has(id)) {
      const n = num.get(id)!;
      lines.push(`${pad(depth)}↳ loop back to step ${n > 0 ? n : "start"}`);
      return;
    }

    switch (node.type) {
      case "start": {
        num.set(id, -1);
        const t = node.data.label?.trim();
        if (t && t.toLowerCase() !== "start") lines.push(`${pad(depth)}Goal: ${t}${descOf(node)}`);
        for (const e of outgoing(id)) walk(e.target, depth);
        return;
      }
      case "param":
        num.set(id, -1); // declarations only — surfaced in the Inputs preamble, never walked as a step
        return;
      case "group": {
        num.set(id, -1);
        lines.push(`${pad(depth)}— Phase: ${labelOf(node)}${descOf(node)} —`);
        for (const e of outgoing(id)) walk(e.target, depth);
        return;
      }
      case "condition":
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. Check: ${labelOf(node)}${descOf(node)}`);
        branch(id, "yes", "If yes:", depth);
        branch(id, "no", "If no:", depth);
        return;
      case "loop":
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. Repeat: ${labelOf(node)}${descOf(node)}`);
        branch(id, "body", "Each pass:", depth);
        branch(id, "done", "When done:", depth);
        return;
      case "try":
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. Try: ${labelOf(node)}${descOf(node)}`);
        branch(id, "ok", "If it succeeds:", depth);
        branch(id, "fail", "If it fails:", depth);
        return;
      case "switch": {
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. Decide by: ${labelOf(node)}${descOf(node)}`);
        const cases = Array.isArray(node.data.cases) ? node.data.cases : [];
        cases.forEach((c, i) => branch(id, `c${i}`, `If ${c.trim() || `case ${i + 1}`}:`, depth));
        branch(id, "else", "Otherwise:", depth);
        return;
      }
      case "parallel": {
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. In parallel — do all of these (order doesn't matter):${descOf(node)}`);
        const outs = outgoing(id);
        if (!outs.length) lines.push(`${pad(depth)}  - (no steps yet)`);
        outs.forEach(e => { lines.push(`${pad(depth)}  - Also:`); walk(e.target, depth + 2); });
        return;
      }
      case "end":
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. ${node.data.label?.trim() ? `Result: ${labelOf(node)}` : "Done."}${descOf(node)}`);
        return; // terminal — no outgoing
      default: // action
        counter += 1; num.set(id, counter);
        lines.push(`${pad(depth)}${counter}. ${labelOf(node)}${descOf(node)}`);
        for (const e of outgoing(id)) walk(e.target, depth);
        return;
    }
  };

  // Entry points: every Start node first, then any non-start, non-param node with nothing pointing
  // at it (a root the user forgot to wire to Start). Whatever's left is genuinely disconnected.
  for (const s of graph.nodes.filter(n => n.type === "start")) walk(s.id, 0);
  for (const r of graph.nodes.filter(n => n.type !== "start" && n.type !== "param" && !hasIncoming(n.id))) {
    if (!num.has(r.id)) walk(r.id, 0);
  }

  const orphans = graph.nodes.filter(n => n.type !== "start" && n.type !== "param" && !num.has(n.id));
  if (orphans.length) {
    lines.push("", "Disconnected steps (not reachable from Start — wire them in):");
    for (const o of orphans) if (!num.has(o.id)) walk(o.id, 1);
  }

  // Inputs preamble: every "Info to give" (param) node, listed up front regardless of wiring.
  const head = [SPEC_HEADER];
  const params = graph.nodes.filter(n => n.type === "param");
  if (params.length) {
    head.push("", "Inputs (provided up front):");
    for (const p of params) head.push(`- ${labelOf(p)}${descOf(p)}`);
  }

  const body = lines.join("\n").trim();
  return body ? `${head.join("\n")}\n\n${body}` : head.join("\n");
}
