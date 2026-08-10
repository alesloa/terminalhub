import type { GuiBlock, GuiEvent, GuiMessage } from "./types.js";

// The conversation as the server has actually seen it, folded from the same event stream the
// browser renders.
//
// Why the server keeps its own copy: a GUI session outlives every socket, so a client that
// disconnects and comes back needs the turns it missed. Reading them back from Claude's JSONL is
// the cold-start path only — mid-conversation it's the wrong source, because the transcript on disk
// lags the stream, and a session whose id hasn't been written yet has no file at all. Folding the
// events we already emit is exact by construction: replaying them into a fresh client produces the
// same view the original client had.

export interface Transcript {
  apply(event: GuiEvent): void;
  /** Every completed message, plus the one in flight. Safe to send as a `history` frame. */
  messages(): GuiMessage[];
}

/** Deep-ish clone of a block so a later delta can't mutate an already-handed-out snapshot. */
function cloneBlock(block: GuiBlock): GuiBlock {
  return { ...block };
}

export function createTranscript(): Transcript {
  const messages: GuiMessage[] = [];
  const byId = new Map<string, GuiMessage>();
  // Blocks are addressed by id across message boundaries (tool.result arrives long after its
  // message closed), so the lookup is global rather than per-message.
  const blockById = new Map<string, GuiBlock>();
  const blockByToolUseId = new Map<string, Extract<GuiBlock, { kind: "tool" }>>();

  const apply = (event: GuiEvent): void => {
    switch (event.type) {
      case "message.start": {
        if (byId.has(event.id)) return;
        const message: GuiMessage = { id: event.id, role: event.role, blocks: [], ts: event.ts };
        byId.set(event.id, message);
        messages.push(message);
        return;
      }

      case "block.start": {
        const message = byId.get(event.messageId);
        if (!message || blockById.has(event.block.id)) return;
        const block = cloneBlock(event.block);
        message.blocks.push(block);
        blockById.set(block.id, block);
        if (block.kind === "tool") blockByToolUseId.set(block.toolUseId, block);
        return;
      }

      case "block.delta": {
        const block = blockById.get(event.blockId);
        if (block && (block.kind === "text" || block.kind === "thinking")) block.text += event.text;
        return;
      }

      case "block.input": {
        const block = blockById.get(event.blockId);
        if (block?.kind === "tool") block.input = event.input;
        return;
      }

      case "tool.result": {
        const block = blockByToolUseId.get(event.toolUseId);
        if (!block) return;
        block.status = event.status;
        block.result = event.result;
        return;
      }

      // A rewind cuts the conversation at an earlier turn, so the fold restarts from the kept
      // prefix. Rebuilding the indexes matters as much as the list: a stale blockById entry would
      // let a straggling delta write into a message that is no longer in the transcript.
      case "history.reset": {
        messages.length = 0;
        byId.clear();
        blockById.clear();
        blockByToolUseId.clear();
        for (const source of event.messages) {
          const message: GuiMessage = { ...source, blocks: source.blocks.map(cloneBlock) };
          messages.push(message);
          byId.set(message.id, message);
          for (const block of message.blocks) {
            blockById.set(block.id, block);
            if (block.kind === "tool") blockByToolUseId.set(block.toolUseId, block);
          }
        }
        return;
      }

      // Everything else — turn/state/approval/config — is liveness, not transcript. A reconnecting
      // client gets the current state from its own `state` event instead of a replayed history.
      default:
        return;
    }
  };

  return {
    apply,
    messages: () => messages.map((m) => ({ ...m, blocks: m.blocks.map(cloneBlock) })),
  };
}
