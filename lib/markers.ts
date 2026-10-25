// The agent puts `[action:<id>]` on its own line to place an action card,
// the same way `[document:<id>]` marks for arrivals.
const ACTION_LINE = /^\s*\[action:([a-z0-9]+)\]\s*$/;

export type ReplyPart = { kind: "text"; text: string } | { kind: "action"; actionId: string };

/** Splits an assistant reply into text chunks and action cards, in order. */
export function splitReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const chunk = buffer.join("\n").trim();
    if (chunk) parts.push({ kind: "text", text: chunk });
    buffer = [];
  };
  for (const line of text.split("\n")) {
    const match = line.match(ACTION_LINE);
    if (match) {
      flush();
      parts.push({ kind: "action", actionId: match[1] });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return parts;
}
