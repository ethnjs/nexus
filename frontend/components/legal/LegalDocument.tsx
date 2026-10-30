import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import Markdown, { type Components } from "react-markdown";

const linkStyle = { textDecoration: "underline", textUnderlineOffset: "2px" };

const components: Components = {
  h1: ({ children }) => (
    <h1 style={{ fontSize: "36px", color: "var(--color-text-primary)", margin: "0 0 8px" }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: "22px", color: "var(--color-text-primary)", margin: "40px 0 12px" }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: "16px", color: "var(--color-text-primary)", margin: "24px 0 8px" }}>
      {children}
    </h3>
  ),
  p: ({ children }) => <p style={{ margin: "0 0 14px" }}>{children}</p>,
  ul: ({ children }) => (
    <ul style={{ listStyleType: "disc", paddingLeft: "20px", margin: "0 0 14px" }}>{children}</ul>
  ),
  li: ({ children }) => <li style={{ margin: "6px 0" }}>{children}</li>,
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{children}</strong>
  ),
  code: ({ children }) => (
    <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.9em" }}>{children}</code>
  ),
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link href={href} style={linkStyle}>
        {children}
      </Link>
    ) : href.startsWith("http") ? (
      <a href={href} target="_blank" rel="noreferrer" style={linkStyle}>
        {children}
      </a>
    ) : (
      <a href={href} style={linkStyle}>
        {children}
      </a>
    ),
};

/** Renders a Markdown file from `content/legal/`, read at build time. */
export async function LegalDocument({ file }: { file: string }) {
  const source = await readFile(path.join(process.cwd(), "content/legal", file), "utf8");

  return (
    <article
      style={{
        fontFamily: "var(--font-sans)",
        fontSize: "15px",
        lineHeight: 1.7,
        color: "var(--color-text-secondary)",
      }}
    >
      <Markdown components={components}>{source}</Markdown>
    </article>
  );
}
