"use client";

import { TimeBlock, Event } from "@/lib/api";
import { fmtTime, fmtDate } from "@/lib/formatters";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  timeBlocks:  TimeBlock[];
  events:      Event[];
  isReadOnly?: boolean;
  onAdd:       () => void;
  onEdit:      (block: TimeBlock) => void;
  onDelete:    (block: TimeBlock) => void;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  fontFamily:    "var(--font-sans)",
  fontSize:      "11px",
  fontWeight:    600,
  color:         "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding:       "9px 14px",
  textAlign:     "left",
  borderBottom:  "1px solid var(--color-border)",
  whiteSpace:    "nowrap",
  background:    "var(--color-surface)",
};

const tdStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize:   "13px",
  color:      "var(--color-text-primary)",
  padding:    "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};

// ─── Day separator row ────────────────────────────────────────────────────────

function DaySeparator({ date }: { date: string }) {
  return (
    <tr>
      <td
        colSpan={5}
        style={{
          fontFamily:      "var(--font-sans)",
          fontSize:        "11px",
          fontWeight:      600,
          color:           "var(--color-text-secondary)",
          textTransform:   "uppercase",
          letterSpacing:   "0.06em",
          padding:         "8px 14px 6px",
          background:      "var(--color-bg)",
          borderBottom:    "1px solid var(--color-border)",
          borderTop:       "1px solid var(--color-border)",
        }}
      >
        {fmtDate(date)}
      </td>
    </tr>
  );
}

// ─── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  children,
  onClick,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        fontFamily:  "var(--font-sans)",
        fontSize:    "12px",
        fontWeight:  500,
        color:       danger ? "var(--color-danger)" : "var(--color-text-secondary)",
        background:  "none",
        border:      "none",
        padding:     "3px 8px",
        borderRadius: "var(--radius-sm)",
        cursor:      "pointer",
        transition:  "background var(--transition-fast), color var(--transition-fast)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? "var(--color-danger-subtle)"
          : "var(--color-accent-subtle)";
        (e.currentTarget as HTMLButtonElement).style.color = danger
          ? "var(--color-danger)"
          : "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "none";
        (e.currentTarget as HTMLButtonElement).style.color = danger
          ? "var(--color-danger)"
          : "var(--color-text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TimeBlocksTable({
  timeBlocks,
  events,
  isReadOnly = false,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  // Count how many events are assigned to each block
  const eventCount = (blockId: number) =>
    events.filter((e) => e.time_block_ids.includes(blockId)).length;

  // Group blocks by date (already ordered by date then start from API)
  const rows: Array<{ type: "separator"; date: string } | { type: "block"; block: TimeBlock }> = [];
  let lastDate = "";
  for (const block of timeBlocks) {
    if (block.date !== lastDate) {
      rows.push({ type: "separator", date: block.date });
      lastDate = block.date;
    }
    rows.push({ type: "block", block });
  }

  return (
    <div>
      {/* ── Toolbar ── */}
      <div
        style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          marginBottom:   "14px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize:   "13px",
            color:      "var(--color-text-secondary)",
          }}
        >
          {timeBlocks.length} block{timeBlocks.length !== 1 ? "s" : ""}
        </span>

        {!isReadOnly && (
          <button
            onClick={onAdd}
            style={{
              display:      "flex",
              alignItems:   "center",
              gap:          "5px",
              fontFamily:   "var(--font-sans)",
              fontSize:     "13px",
              fontWeight:   500,
              color:        "var(--color-text-inverse)",
              background:   "var(--color-accent)",
              border:       "none",
              borderRadius: "var(--radius-md)",
              padding:      "6px 14px",
              cursor:       "pointer",
              transition:   "background var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-accent-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--color-accent)";
            }}
          >
            <PlusIcon />
            Add block
          </button>
        )}
      </div>

      {/* ── Empty state ── */}
      {timeBlocks.length === 0 ? (
        <div
          style={{
            display:        "flex",
            flexDirection:  "column",
            alignItems:     "center",
            justifyContent: "center",
            padding:        "60px 0",
            border:         "1px dashed var(--color-border)",
            borderRadius:   "var(--radius-lg)",
            background:     "var(--color-surface)",
            textAlign:      "center",
            gap:            "6px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize:   "18px",
              color:      "var(--color-text-primary)",
            }}
          >
            No time blocks yet
          </p>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize:   "13px",
              color:      "var(--color-text-secondary)",
            }}
          >
            {isReadOnly
              ? "No blocks have been scheduled for this tournament."
              : "Add a block to start scheduling events."}
          </p>
        </div>
      ) : (
        /* ── Table ── */
        <div
          style={{
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            overflowX:    "auto",
            background:   "var(--color-surface)",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Day</th>
                <th style={thStyle}>Time range</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Events</th>
                {!isReadOnly && (
                  <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                if (row.type === "separator") {
                  return <DaySeparator key={`sep-${row.date}`} date={row.date} />;
                }

                const { block } = row;
                const count = eventCount(block.id);
                const isLast = i === rows.length - 1;

                return (
                  <tr
                    key={block.id}
                    style={{ transition: "background var(--transition-fast)" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        "var(--color-bg)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.background =
                        "transparent";
                    }}
                  >
                    {/* Label */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", fontWeight: 500 }}>
                      {block.label}
                    </td>

                    {/* Day */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                      {fmtDate(block.date)}
                    </td>

                    {/* Time range */}
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)" }}>
                      {fmtTime(block.start)}
                      <span style={{ color: "var(--color-text-tertiary)", margin: "0 5px" }}>–</span>
                      {fmtTime(block.end)}
                    </td>

                    {/* Events count */}
                    <td
                      style={{
                        ...tdStyle,
                        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
                        textAlign: "center",
                      }}
                    >
                      {count > 0 ? (
                        <span
                          style={{
                            display:      "inline-flex",
                            alignItems:   "center",
                            justifyContent: "center",
                            minWidth:     "22px",
                            height:       "22px",
                            padding:      "0 6px",
                            borderRadius: "var(--radius-sm)",
                            background:   "var(--color-accent-subtle)",
                            fontFamily:   "var(--font-sans)",
                            fontSize:     "11px",
                            fontWeight:   600,
                            color:        "var(--color-text-primary)",
                          }}
                        >
                          {count}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>
                          —
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    {!isReadOnly && (
                      <td
                        style={{
                          ...tdStyle,
                          borderBottom: isLast ? "none" : "1px solid var(--color-border)",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <ActionBtn onClick={() => onEdit(block)} title="Edit block">
                          Edit
                        </ActionBtn>
                        <ActionBtn
                          onClick={() => onDelete(block)}
                          danger
                          title="Delete block"
                        >
                          Delete
                        </ActionBtn>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 1v10M1 6h10" />
    </svg>
  );
}
