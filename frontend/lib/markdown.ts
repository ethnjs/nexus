// The markdown subset stored in form titles, descriptions and question text.
// Discord-flavored: `**bold**`, `*italic*` / `_italic_`, `__underline__`, and
// every newline is a line break. "rich" (descriptions) adds `[text](url)`,
// bare URLs and emails, and flat `- ` / `1. ` lists; "inline" shows those as typed.

export type MarkdownVariant = "inline" | "rich";
export type InlineMark = "bold" | "underline" | "italic";
export type Span = { text: string; marks: InlineMark[]; href?: string };
export type Block =
  | { type: "line"; spans: Span[] }
  | { type: "bullet"; items: Span[][] }
  | { type: "ordered"; start: number; items: Span[][] };

// The order marks open in when serialized; every `marks` array is kept sorted by it.
export const INLINE_MARKS: InlineMark[] = ["bold", "underline", "italic"];
const DELIMITER: Record<InlineMark, string> = { bold: "**", underline: "__", italic: "*" };

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/;
const ALPHANUMERIC = /[\p{L}\p{N}]/u;
const AUTOLINK = /https?:\/\/[^\s<>]+/iy;
const EMAIL = /[A-Za-z0-9][\w.%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/y;
const EMAIL_CHARACTER = /[\w.%+-]/;
const BULLET_LINE = /^-(?: (.*))?$/;
const ORDERED_LINE = /^(\d{1,9})\.(?: (.*))?$/;

export function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

export function isEmailAddress(text: string): boolean {
  return matchEmail(text, 0) === text;
}

export function parseMarkdown(markdown: string, variant: MarkdownVariant): Block[] {
  const blocks: Block[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const bullet = variant === "rich" ? BULLET_LINE.exec(line) : null;
    const ordered = variant === "rich" && !bullet ? ORDERED_LINE.exec(line) : null;
    const last = blocks[blocks.length - 1];
    if (bullet) {
      const spans = parseInline(bullet[1] ?? "", true);
      if (last?.type === "bullet") last.items.push(spans);
      else blocks.push({ type: "bullet", items: [spans] });
    } else if (ordered) {
      const spans = parseInline(ordered[2] ?? "", true);
      if (last?.type === "ordered") last.items.push(spans);
      else blocks.push({ type: "ordered", start: Number(ordered[1]), items: [spans] });
    } else {
      blocks.push({ type: "line", spans: parseInline(line, variant === "rich") });
    }
  }
  return blocks;
}

export function serializeMarkdown(blocks: Block[], variant: MarkdownVariant): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "line") {
      const line = serializeInline(block.spans, variant);
      lines.push(variant === "rich" ? escapeListMarker(line) : line);
      continue;
    }
    block.items.forEach((item, index) => {
      const marker = block.type === "bullet" ? "-" : `${block.start + index}.`;
      const body = serializeInline(item, variant);
      lines.push(body ? `${marker} ${body}` : marker);
    });
  }
  return lines.join("\n");
}

export function toPlainText(markdown: string, variant: MarkdownVariant = "inline"): string {
  const text = (spans: Span[]) => spans.map((span) => span.text).join("");
  return parseMarkdown(markdown, variant)
    .flatMap((block) => {
      if (block.type === "line") return [text(block.spans)];
      return block.items.map((item, index) => {
        const marker = block.type === "bullet" ? "-" : `${block.start + index}.`;
        return `${marker} ${text(item)}`;
      });
    })
    .join("\n");
}

export function sameFormat(a: Span, b: Span): boolean {
  return a.href === b.href && a.marks.join() === b.marks.join();
}

// --- Parsing -------------------------------------------------------------

type Node =
  | { text: string }
  | { mark: InlineMark; children: Node[] }
  | { href: string; children: Node[] };
type Frame = { mark: InlineMark; delimiter: string; children: Node[] };

function parseInline(source: string, links: boolean): Span[] {
  const spans: Span[] = [];
  flatten(parseNodes(source, links), [], undefined, spans);
  return spans;
}

// Emphasis follows a trimmed-down CommonMark delimiter rule: a run opens when
// followed by non-whitespace, closes when preceded by it, closes only the
// innermost open mark, and a single `_` can't open or close inside a word.
// Unclosed delimiters fall back to literal text.
function parseNodes(source: string, links: boolean): Node[] {
  const root: Node[] = [];
  const stack: Frame[] = [];
  const current = () => (stack.length ? stack[stack.length - 1].children : root);
  let text = "";
  const flush = () => {
    if (text) current().push({ text });
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const before = source[i - 1];

    if (char === "\\" && PUNCTUATION.test(source[i + 1] ?? "")) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    if (links && (char === "h" || char === "H") && !isAlphanumeric(before)) {
      const url = matchAutolink(source, i);
      if (url) {
        flush();
        current().push({ href: url, children: [{ text: url }] });
        i += url.length;
        continue;
      }
    }

    if (links && /[A-Za-z0-9]/.test(char)) {
      const email = matchEmail(source, i);
      if (email) {
        flush();
        current().push({ href: `mailto:${email}`, children: [{ text: email }] });
        i += email.length;
        continue;
      }
    }

    if (links && char === "[") {
      const link = matchLink(source, i);
      if (link) {
        flush();
        current().push({ href: link.href, children: link.children });
        i = link.end;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      let length = 1;
      while (source[i + length] === char) length++;
      const after = source[i + length];
      let canOpen = after !== undefined && !WHITESPACE.test(after);
      let canClose = before !== undefined && !WHITESPACE.test(before);
      if (char === "_" && length === 1) {
        canOpen &&= !isAlphanumeric(before);
        canClose &&= !isAlphanumeric(after);
      }

      flush();
      let left = length;
      while (left > 0) {
        const top = stack[stack.length - 1];
        if (canClose && top && top.delimiter[0] === char && top.delimiter.length <= left) {
          stack.pop();
          current().push({ mark: top.mark, children: top.children });
          left -= top.delimiter.length;
        } else if (canOpen) {
          const delimiter = left >= 2 ? char + char : char;
          stack.push({ mark: delimiterMark(delimiter), delimiter, children: [] });
          left -= delimiter.length;
        } else {
          text += char.repeat(left);
          left = 0;
        }
      }
      i += length;
      continue;
    }

    text += char;
    i++;
  }

  flush();
  while (stack.length) {
    const frame = stack.pop() as Frame;
    current().push({ text: frame.delimiter }, ...frame.children);
  }
  return root;
}

function delimiterMark(delimiter: string): InlineMark {
  if (delimiter === "**") return "bold";
  if (delimiter === "__") return "underline";
  return "italic";
}

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && ALPHANUMERIC.test(char);
}

function matchAutolink(source: string, start: number): string | null {
  AUTOLINK.lastIndex = start;
  const match = AUTOLINK.exec(source);
  if (!match) return null;
  let url = match[0];
  for (;;) {
    const trimmed = url.replace(/[.,;:!?'"*_]+$/, "");
    const unbalanced =
      trimmed.endsWith(")") && trimmed.split("(").length < trimmed.split(")").length;
    const next = unbalanced ? trimmed.slice(0, -1) : trimmed;
    if (next === url) break;
    url = next;
  }
  return /^https?:\/\/./i.test(url) ? url : null;
}

function matchEmail(source: string, start: number): string | null {
  if (EMAIL_CHARACTER.test(source[start - 1] ?? "")) return null;
  EMAIL.lastIndex = start;
  return EMAIL.exec(source)?.[0] ?? null;
}

function matchLink(
  source: string,
  start: number,
): { href: string; children: Node[]; end: number } | null {
  let close = start + 1;
  while (close < source.length && source[close] !== "]") {
    if (source[close] === "[" || source[close] === "\n") return null;
    close += source[close] === "\\" ? 2 : 1;
  }
  if (close === start + 1 || source[close] !== "]" || source[close + 1] !== "(") return null;
  let end = close + 2;
  for (let depth = 0; end < source.length && (source[end] !== ")" || depth > 0); end++) {
    if (WHITESPACE.test(source[end])) return null;
    if (source[end] === "(") depth++;
    if (source[end] === ")") depth--;
  }
  const href = source.slice(close + 2, end);
  if (end >= source.length || !href) return null;
  return { href, children: parseNodes(source.slice(start + 1, close), false), end: end + 1 };
}

function flatten(nodes: Node[], marks: InlineMark[], href: string | undefined, out: Span[]) {
  for (const node of nodes) {
    if ("text" in node) {
      pushSpan(out, href ? { text: node.text, marks, href } : { text: node.text, marks });
    } else if ("mark" in node) {
      const next = marks.includes(node.mark)
        ? marks
        : INLINE_MARKS.filter((mark) => mark === node.mark || marks.includes(mark));
      flatten(node.children, next, href, out);
    } else {
      flatten(node.children, marks, isSafeHref(node.href) ? node.href : href, out);
    }
  }
}

function pushSpan(out: Span[], span: Span) {
  if (!span.text) return;
  const last = out[out.length - 1];
  if (last && sameFormat(last, span)) last.text += span.text;
  else out.push(span);
}

// --- Serializing ---------------------------------------------------------

function serializeInline(spans: Span[], variant: MarkdownVariant): string {
  const escapeText = variant === "rich" ? escapeRichText : escapeInlineText;
  let out = "";
  let start = 0;
  while (start < spans.length) {
    const href = variant === "rich" ? spans[start].href : undefined;
    let end = start + 1;
    while (end < spans.length && (variant === "rich" ? spans[end].href : undefined) === href) end++;
    const group = trimMarkedWhitespace(spans.slice(start, end));

    if (!href) {
      out += serializeMarks(group, escapeText);
    } else if (
      group.length === 1 &&
      isBareLink(group[0], out[out.length - 1], spans[end]?.text ?? "")
    ) {
      out += serializeMarks(group, (raw) => raw);
    } else {
      out += `[${serializeMarks(group, escapeLinkText)}](${encodeHref(href)})`;
    }
    start = end;
  }
  return out;
}

// Whether a link can be written as its bare text and still parse back to
// itself, given the characters that will surround it.
function isBareLink(span: Span, before: string | undefined, after: string): boolean {
  const innermost = span.marks[span.marks.length - 1];
  const edge = innermost ? DELIMITER[innermost] : undefined;
  if (span.href === span.text) {
    return (
      matchAutolink(span.text + (edge ?? after), 0) === span.text && !isAlphanumeric(edge ?? before)
    );
  }
  if (span.href === `mailto:${span.text}`) {
    const lead = edge ?? before ?? "";
    return matchEmail(lead + span.text + (edge ?? after), lead.length) === span.text;
  }
  return false;
}

// A delimiter only opens before and closes after non-whitespace, so whitespace
// at a mark's edge moves outside it.
function trimMarkedWhitespace(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [index, span] of spans.entries()) {
    const prev = spans[index - 1]?.marks ?? [];
    const next = spans[index + 1]?.marks ?? [];
    const shared = (other: InlineMark[]) => span.marks.filter((mark) => other.includes(mark));
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(span.text) as RegExpExecArray;
    if (!span.marks.length) {
      pushSpan(out, { ...span });
    } else if (!core) {
      pushSpan(out, { ...span, marks: shared(prev).filter((mark) => next.includes(mark)) });
    } else {
      pushSpan(out, { ...span, text: lead, marks: shared(prev) });
      pushSpan(out, { ...span, text: core });
      pushSpan(out, { ...span, text: trail, marks: shared(next) });
    }
  }
  return out;
}

function serializeMarks(spans: Span[], escapeText: (text: string) => string): string {
  let out = "";
  const open: InlineMark[] = [];
  for (const span of spans) {
    let keep = 0;
    while (keep < open.length && span.marks.includes(open[keep])) keep++;
    while (open.length > keep) out += DELIMITER[open.pop() as InlineMark];
    for (const mark of span.marks) {
      if (!open.includes(mark)) {
        out += DELIMITER[mark];
        open.push(mark);
      }
    }
    out += escapeText(span.text);
  }
  while (open.length) out += DELIMITER[open.pop() as InlineMark];
  return out;
}

function escapeInlineText(text: string): string {
  return text.replace(/[\\*_]/g, "\\$&");
}

function escapeLinkText(text: string): string {
  return text.replace(/[\\*_[\]]/g, "\\$&");
}

// Escaping the colon or the @ keeps a URL or email the TD unlinked from
// becoming a link again.
function escapeRichText(text: string): string {
  return escapeLinkText(text)
    .replace(/(https?):\/\//gi, "$1\\://")
    .replace(/@(?=[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, "\\@");
}

function encodeHref(href: string): string {
  return href.replace(/[\s()]/g, (char) =>
    char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char),
  );
}

function escapeListMarker(line: string): string {
  if (BULLET_LINE.test(line)) return `\\${line}`;
  const ordered = ORDERED_LINE.exec(line);
  return ordered ? `${ordered[1]}\\${line.slice(ordered[1].length)}` : line;
}
