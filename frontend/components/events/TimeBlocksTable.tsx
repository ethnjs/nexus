"use client";

import { TimeBlock, Event } from "@/lib/api";
import { fmtTime, fmtDate } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";
import { IconPlus, IconEdit, IconTrash } from "@/components/ui/Icons";

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
          <Button size="sm" onClick={onAdd}>
            <IconPlus size={12} />
            Add block
          </Button>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEdit(block)}
                          title="Edit block"
                          style={{ padding: "0 8px" }}
                        >
                          <IconEdit size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(block)}
                          title="Delete block"
                          style={{ padding: "0 8px", color: "var(--color-danger)" }}
                        >
                          <IconTrash size={14} />
                        </Button>
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

