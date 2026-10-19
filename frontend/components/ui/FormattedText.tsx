import { Fragment, type ReactNode } from "react";
import { type MarkdownVariant, parseMarkdown, type Span } from "@/lib/markdown";
import styles from "./RichText.module.css";

function renderSpan(span: Span, key: number): ReactNode {
  let node: ReactNode = span.text;
  if (span.marks.includes("italic")) node = <em>{node}</em>;
  if (span.marks.includes("underline")) node = <u>{node}</u>;
  if (span.marks.includes("bold")) node = <strong>{node}</strong>;
  if (span.href) {
    node = (
      <a href={span.href} target="_blank" rel="noopener noreferrer">
        {node}
      </a>
    );
  }
  return <Fragment key={key}>{node}</Fragment>;
}

// The last word and `trailing` share a nowrap span, so a trailing marker that
// lands right at a line's edge can't wrap onto a line of its own.
function renderLastLine(spans: Span[], trailing: ReactNode): ReactNode {
  const last = spans[spans.length - 1];
  if (!last) return trailing;
  const split = last.text.lastIndexOf(" ");
  const head = split === -1 ? [] : [{ ...last, text: last.text.slice(0, split + 1) }];
  const tail = { ...last, text: last.text.slice(split + 1) };
  return (
    <>
      {[...spans.slice(0, -1), ...head].map(renderSpan)}
      <span style={{ whiteSpace: "nowrap" }}>
        {renderSpan(tail, 0)}
        {trailing}
      </span>
    </>
  );
}

/** Renders stored form markdown (see lib/markdown.ts). "inline" renders as
 *  inline content with line breaks; "rich" as a block with a paragraph per
 *  line, matching RichTextInput's editor. */
export function FormattedText({
  markdown,
  variant,
  trailing,
}: {
  markdown: string;
  variant: MarkdownVariant;
  /** Kept on the same line as the last word, e.g. a required marker. Inline only. */
  trailing?: ReactNode;
}) {
  const blocks = parseMarkdown(markdown, variant);

  if (variant === "inline") {
    return (
      <>
        {blocks.map((block, index) => {
          if (block.type !== "line") return null;
          const isLast = index === blocks.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond position
            <Fragment key={index}>
              {index > 0 && <br />}
              {isLast && trailing !== undefined
                ? renderLastLine(block.spans, trailing)
                : block.spans.map(renderSpan)}
            </Fragment>
          );
        })}
      </>
    );
  }

  return (
    <div className={styles.prose}>
      {blocks.map((block, index) => {
        if (block.type === "line") {
          // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity beyond position
          return <p key={index}>{block.spans.length ? block.spans.map(renderSpan) : <br />}</p>;
        }
        const items = block.items.map((spans, item) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity beyond position
          <li key={item}>{spans.map(renderSpan)}</li>
        ));
        return block.type === "bullet" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: lists have no identity beyond position
          <ul key={index}>{items}</ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: lists have no identity beyond position
          <ol key={index} start={block.start}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}
