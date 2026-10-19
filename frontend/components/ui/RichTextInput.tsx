"use client";

import Bold, {
  starInputRegex,
  starPasteRegex,
  underscoreInputRegex,
  underscorePasteRegex,
} from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Underline from "@tiptap/extension-underline";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import {
  Fragment,
  type Node as ProseMirrorNode,
  type ResolvedPos,
  type Schema,
  Slice,
} from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  type Editor,
  EditorContent,
  Extension,
  type Extensions,
  type JSONContent,
  markInputRule,
  markPasteRule,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { FormPopover } from "@/components/ui/FormPopover";
import {
  IconBold,
  IconBulletList,
  IconClearFormatting,
  IconItalic,
  IconLink,
  IconNumberedList,
  IconUnderline,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import {
  type Block,
  INLINE_MARKS,
  isEmailAddress,
  isSafeHref,
  type MarkdownVariant,
  parseMarkdown,
  type Span,
  serializeMarkdown,
} from "@/lib/markdown";
import styles from "./RichText.module.css";

type RichTextSize = "sm" | "md" | "lg";

interface RichTextInputProps {
  /** Markdown in the subset lib/markdown.ts defines. */
  value: string;
  onChange: (markdown: string) => void;
  /** "inline" allows bold, italic and underline; "rich" adds links and lists. */
  variant: MarkdownVariant;
  /** Enter does nothing and pasted lines are joined, for a title. */
  singleLine?: boolean;
  label?: string;
  error?: string;
  placeholder?: string;
  fullWidth?: boolean;
  size?: RichTextSize;
  locked?: boolean;
  /** Fires once focus leaves the field, its toolbar and its link editor. */
  onBlur?: () => void;
  style?: CSSProperties;
  "data-focus"?: string;
}

// Heights match Input's scale: padding + line height + the 1px borders.
const SIZE_MAP: Record<RichTextSize, CSSProperties> = {
  sm: { padding: "5px 10px", fontSize: "13px", lineHeight: "16px", minHeight: "28px" },
  md: { padding: "7px 16px", fontSize: "14px", lineHeight: "20px", minHeight: "36px" },
  lg: { padding: "13px 20px", fontSize: "15px", lineHeight: "20px", minHeight: "48px" },
};

const MOD =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

// Tiptap's Bold also claims `__x__`, which is underline here.
const BoldMark = Bold.extend({
  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});

const UnderlineMark = Underline.extend({
  addInputRules() {
    return [markInputRule({ find: underscoreInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: underscorePasteRegex, type: this.type })];
  },
});

const FlatListItem = ListItem.extend({ content: "paragraph" });

// Only a target for pasted <br>s, which splitPastedLines turns into separate
// lines — so no Shift+Enter to type one.
const PastedLineBreak = HardBreak.extend({ addKeyboardShortcuts: () => ({}) });

const SingleLineKeymap = Extension.create({
  name: "singleLineKeymap",
  addKeyboardShortcuts: () => ({ Enter: () => true }),
});

function buildExtensions(variant: MarkdownVariant, singleLine: boolean, placeholder: string) {
  const extensions: Extensions = [
    singleLine ? Document.extend({ content: "paragraph" }) : Document,
    Paragraph,
    Text,
    BoldMark,
    Italic,
    UnderlineMark,
    PastedLineBreak,
    UndoRedo,
    Placeholder.configure({ placeholder, emptyEditorClass: styles.emptyEditor }),
  ];
  if (singleLine) extensions.push(SingleLineKeymap);
  if (variant === "rich") {
    extensions.push(
      Link.configure({
        openOnClick: false,
        defaultProtocol: "https",
        // Autolinking checks the typed text, so a bare email arrives here without its mailto:.
        isAllowedUri: (url) => isSafeHref(url) || isEmailAddress(url),
        // Matches lib/markdown.ts, which links bare URLs only when they have a scheme.
        shouldAutoLink: (url) => /^https?:\/\//i.test(url) || isEmailAddress(url),
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
      }),
      BulletList,
      OrderedList,
      FlatListItem,
      ListKeymap,
    );
  }
  return extensions;
}

function spansToContent(spans: Span[]): JSONContent[] | undefined {
  if (!spans.length) return undefined;
  return spans.map((span) => ({
    type: "text",
    text: span.text,
    marks: [
      ...span.marks.map((mark) => ({ type: mark })),
      ...(span.href ? [{ type: "link", attrs: { href: span.href } }] : []),
    ],
  }));
}

function markdownToDoc(markdown: string, variant: MarkdownVariant, singleLine: boolean) {
  const source = singleLine ? markdown.replace(/\s*\n\s*/g, " ") : markdown;
  const content = parseMarkdown(source, variant).map((block): JSONContent => {
    if (block.type === "line") return { type: "paragraph", content: spansToContent(block.spans) };
    const items = block.items.map((spans) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: spansToContent(spans) }],
    }));
    return block.type === "bullet"
      ? { type: "bulletList", content: items }
      : { type: "orderedList", attrs: { start: block.start }, content: items };
  });
  return { type: "doc", content };
}

function nodeSpans(node: ProseMirrorNode): Span[] {
  const spans: Span[] = [];
  node.forEach((child) => {
    if (!child.text) return;
    const marks = INLINE_MARKS.filter((name) => child.marks.some((m) => m.type.name === name));
    const href = child.marks.find((m) => m.type.name === "link")?.attrs.href;
    spans.push(href ? { text: child.text, marks, href } : { text: child.text, marks });
  });
  return spans;
}

function docToMarkdown(doc: ProseMirrorNode, variant: MarkdownVariant): string {
  const blocks: Block[] = [];
  doc.forEach((node) => {
    if (node.type.name === "paragraph") {
      blocks.push({ type: "line", spans: nodeSpans(node) });
      return;
    }
    const items: Span[][] = [];
    node.forEach((item) => {
      items.push(item.firstChild ? nodeSpans(item.firstChild) : []);
    });
    blocks.push(
      node.type.name === "orderedList"
        ? { type: "ordered", start: node.attrs.start ?? 1, items }
        : { type: "bullet", items },
    );
  });
  return serializeMarkdown(blocks, variant).replace(/\n+$/, "");
}

// ProseMirror's own plain-text parser merges runs of newlines, dropping blank lines.
function parsePastedText(text: string, context: ResolvedPos, schema: Schema): Slice {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const marks = context.marks();
  const paragraphs = lines.map((line) =>
    schema.nodes.paragraph.create(null, line ? schema.text(line, marks) : null),
  );
  return new Slice(Fragment.from(paragraphs), 1, 1);
}

function splitAtLineBreaks(textblock: ProseMirrorNode): ProseMirrorNode[] {
  const lines: ProseMirrorNode[][] = [[]];
  textblock.forEach((child) => {
    if (child.type.name === "hardBreak") lines.push([]);
    else lines[lines.length - 1].push(child);
  });
  // A <br> closing a block draws no extra line in the browser either.
  if (lines.length > 1 && !lines[lines.length - 1].length) lines.pop();
  return lines.map((line) => textblock.type.create(textblock.attrs, line));
}

// Pasted HTML breaks lines with <br>. Stored text has a line per paragraph, so
// each textblock splits at its breaks, and a list item into one item per line.
function splitPastedLines(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.isTextblock) nodes.push(...splitAtLineBreaks(node));
    else if (node.type.name === "listItem") {
      splitPastedLines(node.content).forEach((line) => {
        nodes.push(node.type.create(node.attrs, line));
      });
    } else nodes.push(node.copy(splitPastedLines(node.content)));
  });
  return Fragment.from(nodes);
}

function transformPastedLines(slice: Slice, schema: Schema): Slice {
  if (!slice.content.firstChild?.isInline) {
    return new Slice(splitPastedLines(slice.content), slice.openStart, slice.openEnd);
  }
  const paragraph = schema.nodes.paragraph.create(null, slice.content);
  return new Slice(Fragment.from(splitAtLineBreaks(paragraph)), 1, 1);
}

// Pasting several paragraphs into a one-paragraph document would fail to fit,
// so their inline content is joined with spaces first.
function joinPastedLines(slice: Slice, schema: Schema): Slice {
  const inline: ProseMirrorNode[] = [];
  const add = (node: ProseMirrorNode) => {
    inline.push(node.type.name === "hardBreak" ? schema.text(" ") : node);
  };
  if (slice.content.firstChild?.isInline) slice.content.forEach(add);
  slice.content.descendants((node) => {
    if (!node.isTextblock) return !node.isInline;
    if (inline.length && node.childCount) inline.push(schema.text(" "));
    node.forEach(add);
    return false;
  });
  return new Slice(Fragment.from(schema.nodes.paragraph.create(null, inline)), 1, 1);
}

function clearFormatting(editor: Editor) {
  const { from, empty } = editor.state.selection;
  const chain = editor.chain().focus();
  if (empty) chain.selectAll();
  chain.unsetAllMarks().clearNodes();
  if (empty) {
    chain.command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(from))));
      return true;
    });
  }
  chain.run();
}

function linkHrefAt(position: ResolvedPos): string | undefined {
  return position.marks().find((mark) => mark.type.name === "link")?.attrs.href;
}

function normalizeHref(input: string): string {
  const href = input.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  return isEmailAddress(href) ? `mailto:${href}` : `https://${href}`;
}

function applyLink(editor: Editor, href: string) {
  const chain = editor.chain().focus();
  if (editor.isActive("link")) chain.extendMarkRange("link").setLink({ href });
  else if (editor.state.selection.empty) {
    chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] });
  } else chain.setLink({ href });
  chain.run();
}

function LinkForm({
  initialHref,
  autoFocus,
  onApply,
  onRemove,
  onCancel,
}: {
  initialHref: string;
  autoFocus: boolean;
  onApply: (href: string) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [href, setHref] = useState(initialHref);
  const [error, setError] = useState<string | undefined>(undefined);

  function submit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeHref(href);
    if (!href.trim() || !isSafeHref(normalized)) {
      setError("Enter a web address or an email address.");
      return;
    }
    onApply(normalized);
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "10px" }}
    >
      <Input
        value={href}
        onChange={(e) => {
          setHref(e.target.value);
          setError(undefined);
        }}
        placeholder="https://"
        size="sm"
        fullWidth
        error={error}
        autoFocus={autoFocus}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm">
          Apply
        </Button>
      </div>
    </form>
  );
}

function ToolbarButton({
  title,
  active = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "primary" : "ghost"}
      size="xs"
      iconOnly
      title={title}
      aria-pressed={active}
      // Keeps focus, and so the selection, in the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function ToolbarDivider() {
  return (
    <span
      style={{
        width: "1px",
        alignSelf: "stretch",
        margin: "3px 2px",
        background: "var(--color-border)",
      }}
    />
  );
}

export function RichTextInput({
  value,
  onChange,
  variant,
  singleLine = false,
  label,
  error,
  placeholder = "",
  fullWidth,
  size = "md",
  locked = false,
  onBlur,
  style,
  "data-focus": dataFocus,
}: RichTextInputProps) {
  const labelId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const emitted = useRef(value);
  const focusedRef = useRef(false);
  const [focused, setFocused] = useState(false);
  // Non-null while the link editor is open. `autoFocus` is false when it was
  // opened by clicking a link, so the caret stays in the text.
  const [linkDraft, setLinkDraft] = useState<{ href: string; autoFocus: boolean } | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !locked,
    extensions: buildExtensions(variant, singleLine, placeholder),
    content: markdownToDoc(value, variant, singleLine),
    editorProps: {
      attributes: {
        class: `${styles.prose} ${styles.editor}`,
        role: "textbox",
        "aria-multiline": String(!singleLine),
        ...(label ? { "aria-labelledby": labelId } : {}),
        ...(dataFocus ? { "data-focus": dataFocus } : {}),
      },
      clipboardTextParser: (text, context, _plain, view) =>
        parsePastedText(text, context, view.state.schema),
      transformPasted: (slice, view) =>
        singleLine
          ? joinPastedLines(slice, view.state.schema)
          : transformPastedLines(slice, view.state.schema),
      handleKeyDown: (view, event) => {
        if (variant !== "rich" || !(event.metaKey || event.ctrlKey) || event.key !== "k") {
          return false;
        }
        setLinkDraft({ href: linkHrefAt(view.state.selection.$from) ?? "", autoFocus: true });
        return true;
      },
      handleClick: (view, pos) => {
        const href = linkHrefAt(view.state.doc.resolve(pos));
        if (href !== undefined) setLinkDraft({ href, autoFocus: false });
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const next = docToMarkdown(editor.state.doc, variant);
      if (next === emitted.current) return;
      emitted.current = next;
      onChange(next);
    },
  });

  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(markdownToDoc(value, variant, singleLine), { emitUpdate: false });
  }, [editor, value, variant, singleLine]);

  useEffect(() => {
    editor?.setEditable(!locked);
  }, [editor, locked]);

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      underline: editor?.isActive("underline") ?? false,
      link: editor?.isActive("link") ?? false,
      bulletList: editor?.isActive("bulletList") ?? false,
      orderedList: editor?.isActive("orderedList") ?? false,
    }),
  });

  function leave() {
    if (!focusedRef.current) return;
    focusedRef.current = false;
    setFocused(false);
    onBlur?.();
  }

  function closeLink() {
    setLinkDraft(null);
    // An outside click can unmount the link editor's focused input without a
    // focusout reaching the wrapper, so check where focus ended up instead.
    requestAnimationFrame(() => {
      if (!wrapperRef.current?.contains(document.activeElement)) leave();
    });
  }

  const sizing = SIZE_MAP[size];
  const showToolbar = !!editor && !locked && (focused || linkDraft !== null);

  return (
    <div
      ref={wrapperRef}
      onFocus={() => {
        focusedRef.current = true;
        setFocused(true);
      }}
      onBlur={(e) => {
        if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) leave();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {label && (
        <div
          id={labelId}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "11px",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--color-text-tertiary)",
          }}
        >
          {label}
        </div>
      )}
      <div style={{ position: "relative" }}>
        <div
          className={styles.box}
          data-error={error ? "" : undefined}
          style={{
            ...sizing,
            boxSizing: "border-box",
            fontFamily: "var(--font-sans)",
            background: locked
              ? "var(--color-accent-subtle)"
              : error
                ? "var(--color-danger-subtle)"
                : "var(--color-bg)",
            color: locked ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
            borderRadius: "var(--radius-md)",
            cursor: locked ? "not-allowed" : "text",
            overflowWrap: "anywhere",
            ...style,
          }}
        >
          <EditorContent editor={editor} />
        </div>
        {showToolbar && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              gap: "2px",
              padding: "3px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <ToolbarButton
              title={`Bold (${MOD}B)`}
              active={active?.bold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <IconBold size={12} />
            </ToolbarButton>
            <ToolbarButton
              title={`Italic (${MOD}I)`}
              active={active?.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <IconItalic size={12} />
            </ToolbarButton>
            <ToolbarButton
              title={`Underline (${MOD}U)`}
              active={active?.underline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            >
              <IconUnderline size={12} />
            </ToolbarButton>
            {variant === "rich" && (
              <>
                <ToolbarDivider />
                <FormPopover
                  width={280}
                  align="left"
                  open={linkDraft !== null}
                  onOpenChange={(open) =>
                    open
                      ? setLinkDraft({
                          href: linkHrefAt(editor.state.selection.$from) ?? "",
                          autoFocus: true,
                        })
                      : closeLink()
                  }
                  trigger={
                    <ToolbarButton title={`Link (${MOD}K)`} active={active?.link}>
                      <IconLink size={12} />
                    </ToolbarButton>
                  }
                >
                  {() =>
                    linkDraft && (
                      <LinkForm
                        initialHref={linkDraft.href}
                        autoFocus={linkDraft.autoFocus}
                        onApply={(href) => {
                          applyLink(editor, href);
                          setLinkDraft(null);
                        }}
                        onRemove={
                          active?.link
                            ? () => {
                                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                                setLinkDraft(null);
                              }
                            : undefined
                        }
                        onCancel={() => {
                          editor.commands.focus();
                          setLinkDraft(null);
                        }}
                      />
                    )
                  }
                </FormPopover>
                <ToolbarButton
                  title="Bulleted list"
                  active={active?.bulletList}
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                >
                  <IconBulletList size={12} />
                </ToolbarButton>
                <ToolbarButton
                  title="Numbered list"
                  active={active?.orderedList}
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                >
                  <IconNumberedList size={12} />
                </ToolbarButton>
              </>
            )}
            <ToolbarDivider />
            <ToolbarButton title="Clear formatting" onClick={() => clearFormatting(editor)}>
              <IconClearFormatting size={12} />
            </ToolbarButton>
          </div>
        )}
      </div>
      {error && (
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
