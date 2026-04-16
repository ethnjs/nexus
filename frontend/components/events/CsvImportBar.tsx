"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import {
  IconUpload, IconExport, IconSheets, IconWarning, IconChevronDown, IconTemplate,
} from "@/components/ui/Icons";
import {
  eventsApi, timeBlocksApi, categoriesApi,
  EventCreate, TimeBlock, TournamentCategory, Event,
} from "@/lib/api";
import { parseApiError } from "@/lib/errors";
import { useTournament } from "@/lib/useTournament";

// ─── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const fields: string[] = [];
    let inQuotes = false;
    let field = "";
    for (let i = 0; i < rawLine.length; i++) {
      const ch = rawLine[i];
      if (ch === '"') {
        if (inQuotes && rawLine[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    rows.push(fields);
  }
  return rows;
}

// ─── Events import types + parser ────────────────────────────────────────────

interface ParsedEventRow {
  rowNum:           number;
  name:             string;
  category:         string;
  division:         "B" | "C" | null;
  eventType:        "standard" | "trial";
  building:         string;
  room:             string;
  floor:            string;
  volunteersNeeded: number;
  blockLabels:      string[];
}

interface EventParseResult {
  valid:         ParsedEventRow[];
  errors:        Array<{ rowNum: number; message: string }>;
  newCategories: string[];
  unknownBlocks: string[];
}

function parseEventsCSV(
  text: string,
  categories: TournamentCategory[],
  timeBlocks: TimeBlock[],
): EventParseResult {
  const rows = parseCSVText(text);
  if (rows.length === 0) {
    return { valid: [], errors: [], newCategories: [], unknownBlocks: [] };
  }

  const headers    = rows[0].map((h) => h.toLowerCase().trim());
  const col        = (name: string) => headers.indexOf(name);
  const nameIdx    = col("name");
  const catIdx     = col("category");
  const divIdx     = col("division");
  const typeIdx    = col("type");
  const bldIdx     = col("building");
  const roomIdx    = col("room");
  const floorIdx   = col("floor");
  const volIdx     = col("volunteers_needed");
  const blocksIdx  = col("blocks");

  const knownCatNames    = new Set(categories.map((c) => c.name.toLowerCase()));
  const knownBlockLabels = new Set(timeBlocks.map((b) => b.label.toLowerCase()));

  const valid:             ParsedEventRow[]                            = [];
  const errors:            Array<{ rowNum: number; message: string }> = [];
  const newCategoriesSet = new Set<string>();
  const unknownBlocksSet = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i;
    const get    = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : "");

    const name = get(nameIdx).trim();
    if (!name) {
      errors.push({ rowNum, message: "Missing required field: name" });
      continue;
    }

    const rawType = get(typeIdx).trim().toLowerCase();
    if (rawType && rawType !== "standard" && rawType !== "trial") {
      errors.push({ rowNum, message: `Invalid type "${get(typeIdx)}". Must be "standard" or "trial".` });
      continue;
    }

    const rawVol = get(volIdx).trim();
    let volunteersNeeded = 2;
    if (rawVol !== "") {
      const n = parseInt(rawVol, 10);
      if (isNaN(n) || n < 1 || String(n) !== rawVol) {
        errors.push({ rowNum, message: `Invalid volunteers_needed "${rawVol}". Must be an integer ≥ 1.` });
        continue;
      }
      volunteersNeeded = n;
    }

    const rawDiv = get(divIdx).trim().toUpperCase();
    let division: "B" | "C" | null = null;
    if (rawDiv === "B") division = "B";
    else if (rawDiv === "C") division = "C";
    else if (rawDiv !== "") {
      errors.push({ rowNum, message: `Invalid division "${get(divIdx)}". Must be "B", "C", or empty.` });
      continue;
    }

    const categoryName = get(catIdx).trim();
    if (categoryName && !knownCatNames.has(categoryName.toLowerCase())) {
      newCategoriesSet.add(categoryName);
    }

    const rawBlocks  = get(blocksIdx).trim();
    const allLabels  = rawBlocks
      ? rawBlocks.split(";").map((l) => l.trim()).filter(Boolean)
      : [];
    for (const label of allLabels) {
      if (!knownBlockLabels.has(label.toLowerCase())) unknownBlocksSet.add(label);
    }

    valid.push({
      rowNum,
      name,
      category:         categoryName,
      division,
      eventType:        rawType === "trial" ? "trial" : "standard",
      building:         get(bldIdx).trim(),
      room:             get(roomIdx).trim(),
      floor:            get(floorIdx).trim(),
      volunteersNeeded,
      blockLabels:      allLabels.filter((l) => knownBlockLabels.has(l.toLowerCase())),
    });
  }

  return {
    valid,
    errors,
    newCategories: [...newCategoriesSet],
    unknownBlocks: [...unknownBlocksSet],
  };
}

// ─── Time blocks import types + parser ───────────────────────────────────────

interface ParsedTimeBlockRow {
  rowNum: number;
  label:  string;
  date:   string;
  start:  string;
  end:    string;
}

interface TimeBlockParseResult {
  valid:  ParsedTimeBlockRow[];
  errors: Array<{ rowNum: number; message: string }>;
}

function parseTimeBlocksCSV(text: string): TimeBlockParseResult {
  const rows = parseCSVText(text);
  if (rows.length === 0) return { valid: [], errors: [] };

  const headers   = rows[0].map((h) => h.toLowerCase().trim());
  const col       = (name: string) => headers.indexOf(name);
  const labelIdx  = col("label");
  const dateIdx   = col("date");
  const startIdx  = col("start");
  const endIdx    = col("end");

  const valid:  ParsedTimeBlockRow[]                            = [];
  const errors: Array<{ rowNum: number; message: string }> = [];

  for (let i = 1; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i;
    const get    = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : "");

    const label = get(labelIdx).trim();
    const date  = get(dateIdx).trim();
    const start = get(startIdx).trim();
    const end   = get(endIdx).trim();

    if (!label) { errors.push({ rowNum, message: "Missing required field: label" }); continue; }
    if (!date)  { errors.push({ rowNum, message: "Missing required field: date" });  continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ rowNum, message: `Invalid date "${date}". Must be YYYY-MM-DD (e.g. 2025-03-15).` });
      continue;
    }
    if (!start) { errors.push({ rowNum, message: "Missing required field: start" }); continue; }
    if (!/^\d{2}:\d{2}$/.test(start)) {
      errors.push({ rowNum, message: `Invalid start time "${start}". Must be HH:MM (e.g. 09:00).` });
      continue;
    }
    if (!end) { errors.push({ rowNum, message: "Missing required field: end" }); continue; }
    if (!/^\d{2}:\d{2}$/.test(end)) {
      errors.push({ rowNum, message: `Invalid end time "${end}". Must be HH:MM (e.g. 11:00).` });
      continue;
    }

    valid.push({ rowNum, label, date, start, end });
  }

  return { valid, errors };
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function escapeCSVField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function todayStr(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildEventsCSV(
  events: Event[],
  categories: TournamentCategory[],
  timeBlocks: TimeBlock[],
): string {
  const catMap   = new Map(categories.map((c) => [c.id, c.name]));
  const blockMap = new Map(timeBlocks.map((b) => [b.id, b.label]));
  const rows = [
    ["name", "category", "division", "type", "building", "room", "floor", "volunteers_needed", "blocks"],
    ...events.map((e) => [
      e.name,
      catMap.get(e.category_id ?? -1) ?? "",
      e.division ?? "",
      e.event_type,
      e.building ?? "",
      e.room ?? "",
      e.floor ?? "",
      String(e.volunteers_needed),
      (e.time_block_ids ?? []).map((id) => blockMap.get(id) ?? "").filter(Boolean).join(";"),
    ]),
  ];
  return rows.map((r) => r.map(escapeCSVField).join(",")).join("\r\n");
}

function buildTimeBlocksCSV(timeBlocks: TimeBlock[], events: Event[]): string {
  const rows = [
    ["label", "date", "start", "end", "event_count"],
    ...timeBlocks.map((b) => [
      b.label,
      b.date,
      b.start,
      b.end,
      String(events.filter((e) => (e.time_block_ids ?? []).includes(b.id)).length),
    ]),
  ];
  return rows.map((r) => r.map(escapeCSVField).join(",")).join("\r\n");
}

// ─── Templates ────────────────────────────────────────────────────────────────

const EVENTS_CSV_TEMPLATE = [
  "name,category,division,type,building,room,floor,volunteers_needed,blocks",
  '"Sample Event A",Science,B,standard,Main Building,101,1,3,"Morning A;Afternoon B"',
  '"Sample Event B",,C,trial,,,,2,',
].join("\r\n");

const TIME_BLOCKS_CSV_TEMPLATE = [
  "label,date,start,end",
  "Morning A,2025-03-15,09:00,11:00",
  "Afternoon B,2025-03-15,13:00,15:30",
].join("\r\n");

// ─── Help content ─────────────────────────────────────────────────────────────

const EVENTS_HELP_COLUMNS = [
  { col: "name",              req: true,  desc: "Event name. Required." },
  { col: "category",         req: false, desc: "Category name. Unrecognized values are auto-created as custom categories." },
  { col: "division",         req: false, desc: "B, C, or leave empty." },
  { col: "type",             req: false, desc: "standard or trial. Defaults to standard." },
  { col: "building",         req: false, desc: "Building name. Free text." },
  { col: "room",             req: false, desc: "Room identifier. Free text." },
  { col: "floor",            req: false, desc: "Floor identifier. Free text." },
  { col: "volunteers_needed",req: false, desc: "Integer ≥ 1. Defaults to 2." },
  { col: "blocks",           req: false, desc: 'Semicolon-separated block labels. Unrecognized labels are skipped.' },
];

const TIME_BLOCKS_HELP_COLUMNS = [
  { col: "label", req: true, desc: "Block label (e.g. Morning A). Required." },
  { col: "date",  req: true, desc: "Date in YYYY-MM-DD format (e.g. 2025-03-15). Required." },
  { col: "start", req: true, desc: "Start time in HH:MM 24-hour format (e.g. 09:00). Required." },
  { col: "end",   req: true, desc: "End time in HH:MM 24-hour format (e.g. 11:00). Required." },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  tournamentId:     number;
  events:           Event[];
  categories:       TournamentCategory[];
  timeBlocks:       TimeBlock[];
  onImportComplete: () => Promise<void>;
}

// ─── Dropdown menu ────────────────────────────────────────────────────────────

type MenuItem = { label: string; icon?: React.ReactNode; onClick: () => void } | "separator";

function DropdownMenu({ items }: { items: MenuItem[] }) {
  return (
    <div
      style={{
        position:     "absolute",
        top:          "calc(100% + 4px)",
        left:         0,
        zIndex:       101,
        minWidth:     "190px",
        background:   "var(--color-surface)",
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        boxShadow:    "var(--shadow-lg)",
        overflow:     "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <div
            key={i}
            style={{ height: "1px", background: "var(--color-border)", margin: "3px 0" }}
          />
        ) : (
          <button
            key={i}
            onClick={item.onClick}
            style={{
              display:    "flex",
              alignItems: "center",
              gap:        "7px",
              width:      "100%",
              padding:    "7px 12px",
              fontFamily: "var(--font-sans)",
              fontSize:   "12px",
              color:      "var(--color-text-primary)",
              background: "none",
              border:     "none",
              cursor:     "pointer",
              textAlign:  "left",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--color-bg)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ─── Error row list (shared between event + time block preview modals) ────────

function ErrorRowList({ errors }: { errors: Array<{ rowNum: number; message: string }> }) {
  return (
    <div
      style={{
        border:       "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        overflow:     "hidden",
        marginBottom: "16px",
      }}
    >
      <div
        style={{
          padding:       "7px 12px",
          background:    "var(--color-surface)",
          borderBottom:  "1px solid var(--color-border)",
          fontFamily:    "var(--font-sans)",
          fontSize:      "11px",
          fontWeight:    600,
          color:         "var(--color-text-secondary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Row errors
      </div>
      <div style={{ maxHeight: "160px", overflowY: "auto" }}>
        {errors.map((err) => (
          <div
            key={err.rowNum}
            style={{
              display:      "flex",
              gap:          "10px",
              padding:      "7px 12px",
              borderBottom: "1px solid var(--color-border)",
              fontFamily:   "var(--font-sans)",
              fontSize:     "12px",
            }}
          >
            <span style={{ color: "var(--color-text-tertiary)", fontWeight: 600, flexShrink: 0, minWidth: "44px" }}>
              Row {err.rowNum}
            </span>
            <span style={{ color: "var(--color-danger)" }}>{err.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CsvImportBar ─────────────────────────────────────────────────────────────

export function CsvImportBar({
  tournamentId,
  events,
  categories,
  timeBlocks,
  onImportComplete,
}: Props) {
  const { selectedTournament } = useTournament();
  const tournamentSlug = selectedTournament
    ? selectedTournament.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : `tournament-${tournamentId}`;

  type OpenMenu = "import" | "export" | "help" | null;
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

  const eventsFileRef     = useRef<HTMLInputElement>(null);
  const timeBlocksFileRef = useRef<HTMLInputElement>(null);

  type PreviewState =
    | { kind: "events";     result: EventParseResult }
    | { kind: "timeblocks"; result: TimeBlockParseResult }
    | null;

  const [preview,        setPreview]        = useState<PreviewState>(null);
  const [importing,      setImporting]      = useState(false);
  const [importError,    setImportError]    = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  const toggle = (menu: Exclude<OpenMenu, null>) =>
    setOpenMenu((prev) => (prev === menu ? null : menu));

  // ── File handling ────────────────────────────────────────────────────────

  const handleEventsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseEventsCSV(ev.target?.result as string, categories, timeBlocks);
      setPreview({ kind: "events", result });
      setImportError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleTimeBlocksFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = parseTimeBlocksCSV(ev.target?.result as string);
      setPreview({ kind: "timeblocks", result });
      setImportError(null);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── Import execution ─────────────────────────────────────────────────────

  const handleImportEvents = async (result: EventParseResult) => {
    setImporting(true);
    setImportError(null);
    setImportProgress({ done: 0, total: result.valid.length });
    try {
      const catMap = new Map<string, number | null>(
        categories.map((c) => [c.name.toLowerCase(), c.id])
      );
      for (const catName of result.newCategories) {
        const created = await categoriesApi.create(tournamentId, catName);
        catMap.set(catName.toLowerCase(), created.id);
      }
      const blockMap = new Map<string, number>(timeBlocks.map((b) => [b.label.toLowerCase(), b.id]));

      for (let i = 0; i < result.valid.length; i++) {
        const row = result.valid[i];
        const body: EventCreate = {
          name:              row.name,
          division:          row.division,
          event_type:        row.eventType,
          category_id:       row.category ? (catMap.get(row.category.toLowerCase()) ?? null) : null,
          building:          row.building  || null,
          room:              row.room      || null,
          floor:             row.floor     || null,
          volunteers_needed: row.volunteersNeeded,
          time_block_ids:    row.blockLabels
            .map((l) => blockMap.get(l.toLowerCase()))
            .filter((id): id is number => id !== undefined),
        };
        await eventsApi.create(tournamentId, body);
        setImportProgress({ done: i + 1, total: result.valid.length });
      }
      setPreview(null);
      await onImportComplete();
    } catch (err) {
      setImportError(parseApiError(err));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleImportTimeBlocks = async (result: TimeBlockParseResult) => {
    setImporting(true);
    setImportError(null);
    setImportProgress({ done: 0, total: result.valid.length });
    try {
      for (let i = 0; i < result.valid.length; i++) {
        const row = result.valid[i];
        await timeBlocksApi.create(tournamentId, {
          label: row.label,
          date:  row.date,
          start: row.start,
          end:   row.end,
        });
        setImportProgress({ done: i + 1, total: result.valid.length });
      }
      setPreview(null);
      await onImportComplete();
    } catch (err) {
      setImportError(parseApiError(err));
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleImport = () => {
    if (!preview) return;
    if (preview.kind === "events")     handleImportEvents(preview.result);
    if (preview.kind === "timeblocks") handleImportTimeBlocks(preview.result);
  };

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExportEvents = () => {
    downloadCSV(buildEventsCSV(events, categories, timeBlocks), `${tournamentSlug}-events-${todayStr()}.csv`);
    setOpenMenu(null);
  };

  const handleExportTimeBlocks = () => {
    downloadCSV(buildTimeBlocksCSV(timeBlocks, events), `${tournamentSlug}-time-blocks-${todayStr()}.csv`);
    setOpenMenu(null);
  };

  // ── Import menu items ─────────────────────────────────────────────────────

  const importItems: MenuItem[] = [
    {
      label: "Events",
      icon:  <IconUpload size={14} />,
      onClick: () => { setOpenMenu(null); eventsFileRef.current?.click(); },
    },
    {
      label: "Time Blocks",
      icon:  <IconUpload size={14} />,
      onClick: () => { setOpenMenu(null); timeBlocksFileRef.current?.click(); },
    },
    "separator",
    {
      label: "Events template",
      icon:  <IconTemplate size={14} />,
      onClick: () => {
        downloadCSV(EVENTS_CSV_TEMPLATE, "events-import-template.csv");
        setOpenMenu(null);
      },
    },
    {
      label: "Time Blocks template",
      icon:  <IconTemplate size={14} />,
      onClick: () => {
        downloadCSV(TIME_BLOCKS_CSV_TEMPLATE, "time-blocks-import-template.csv");
        setOpenMenu(null);
      },
    },
  ];

  const exportItems: MenuItem[] = [
    {
      label: "Events",
      icon:  <IconExport size={14} />,
      onClick: handleExportEvents,
    },
    {
      label: "Time Blocks",
      icon:  <IconExport size={14} />,
      onClick: handleExportTimeBlocks,
    },
  ];

  // ── Shared button style ──────────────────────────────────────────────────

  const menuBtnStyle = (active: boolean): React.CSSProperties => ({
    display:      "flex",
    alignItems:   "center",
    gap:          "5px",
    fontFamily:   "var(--font-sans)",
    fontSize:     "12px",
    fontWeight:   500,
    color:        active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
    background:   active ? "var(--color-accent-subtle)" : "none",
    border:       "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding:      "4px 10px",
    cursor:       "pointer",
    transition:   "background var(--transition-fast)",
    userSelect:   "none",
    position:     "relative",
  });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          "8px",
          padding:      "10px 14px",
          background:   "var(--color-surface)",
          border:       "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          marginBottom: "20px",
        }}
      >
        {/* ── Import ── */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => toggle("import")}
            style={menuBtnStyle(openMenu === "import")}
          >
            <IconUpload size={14} />
            Import CSV
            <IconChevronDown size={11} style={{ marginLeft: "1px", opacity: 0.6 }} />
          </button>
          {openMenu === "import" && <DropdownMenu items={importItems} />}
        </div>

        {/* ── Export ── */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => toggle("export")}
            style={menuBtnStyle(openMenu === "export")}
          >
            <IconExport size={14} />
            Export CSV
            <IconChevronDown size={11} style={{ marginLeft: "1px", opacity: 0.6 }} />
          </button>
          {openMenu === "export" && <DropdownMenu items={exportItems} />}
        </div>

        {/* ── Help popover ── */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => toggle("help")}
            title="CSV import help"
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              width:          "22px",
              height:         "22px",
              borderRadius:   "50%",
              border:         "1px solid var(--color-border)",
              background:     openMenu === "help" ? "var(--color-accent-subtle)" : "none",
              cursor:         "pointer",
              color:          "var(--color-text-tertiary)",
              fontFamily:     "var(--font-sans)",
              fontSize:       "11px",
              fontWeight:     600,
              flexShrink:     0,
            }}
          >
            ?
          </button>

          {openMenu === "help" && (
            <div
              style={{
                position:     "absolute",
                top:          "calc(100% + 8px)",
                left:         0,
                zIndex:       101,
                width:        "420px",
                background:   "var(--color-surface)",
                border:       "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                boxShadow:    "var(--shadow-lg)",
                padding:      "16px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  CSV Import Guide
                </span>
                <button
                  onClick={() => setOpenMenu(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "16px", lineHeight: 1, padding: "0 2px" }}
                >
                  ×
                </button>
              </div>

              <HelpTable title="Events" columns={EVENTS_HELP_COLUMNS} />
              <div style={{ marginTop: "14px" }}>
                <HelpTable title="Time Blocks" columns={TIME_BLOCKS_HELP_COLUMNS} />
              </div>

              <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "10px", lineHeight: 1.4 }}>
                Headers are case-insensitive and order-independent.
              </p>
            </div>
          )}
        </div>

        <div style={{ width: "1px", height: "18px", background: "var(--color-border)", margin: "0 4px" }} />

        {/* ── Google Sheets — disabled ── */}
        <button
          disabled
          title="Connect Google Sheets (coming soon)"
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          "5px",
            fontFamily:   "var(--font-sans)",
            fontSize:     "12px",
            fontWeight:   500,
            color:        "var(--color-text-tertiary)",
            background:   "none",
            border:       "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding:      "4px 10px",
            cursor:       "not-allowed",
            opacity:      0.6,
          }}
        >
          <IconSheets size={12} />
          Google Sheets
        </button>
      </div>

      {/* Backdrop — closes any open menu */}
      {openMenu !== null && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 100 }}
          onClick={() => setOpenMenu(null)}
        />
      )}

      {/* Hidden file inputs */}
      <input ref={eventsFileRef}     type="file" accept=".csv" style={{ display: "none" }} onChange={handleEventsFile} />
      <input ref={timeBlocksFileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleTimeBlocksFile} />

      {/* Import preview modal */}
      {preview && (
        <ImportPreviewModal
          preview={preview}
          importing={importing}
          progress={importProgress}
          error={importError}
          onImport={handleImport}
          onCancel={() => { setPreview(null); setImportError(null); }}
        />
      )}
    </>
  );
}

// ─── Help table ───────────────────────────────────────────────────────────────

function HelpTable({
  title,
  columns,
}: {
  title:   string;
  columns: Array<{ col: string; req: boolean; desc: string }>;
}) {
  return (
    <>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
        {title}
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", fontFamily: "var(--font-sans)" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", color: "var(--color-text-secondary)", fontWeight: 600, padding: "3px 0", borderBottom: "1px solid var(--color-border)", paddingRight: "8px" }}>Column</th>
            <th style={{ textAlign: "center", color: "var(--color-text-secondary)", fontWeight: 600, padding: "3px 8px", borderBottom: "1px solid var(--color-border)", width: "28px" }}>Req</th>
            <th style={{ textAlign: "left", color: "var(--color-text-secondary)", fontWeight: 600, padding: "3px 0", borderBottom: "1px solid var(--color-border)" }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.col}>
              <td style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-primary)", padding: "4px 8px 4px 0", verticalAlign: "top", borderBottom: "1px solid var(--color-border)", whiteSpace: "nowrap" }}>
                {c.col}
              </td>
              <td style={{ textAlign: "center", padding: "4px 8px", verticalAlign: "top", borderBottom: "1px solid var(--color-border)" }}>
                {c.req && <span style={{ color: "var(--color-danger)", fontWeight: 700, fontSize: "13px" }}>✱</span>}
              </td>
              <td style={{ color: "var(--color-text-secondary)", padding: "4px 0", verticalAlign: "top", borderBottom: "1px solid var(--color-border)", lineHeight: 1.4 }}>
                {c.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ─── Import preview modal ─────────────────────────────────────────────────────

interface PreviewModalProps {
  preview:   NonNullable<{ kind: "events"; result: EventParseResult } | { kind: "timeblocks"; result: TimeBlockParseResult }>;
  importing: boolean;
  progress:  { done: number; total: number } | null;
  error:     string | null;
  onImport:  () => void;
  onCancel:  () => void;
}

function ImportPreviewModal({ preview, importing, progress, error, onImport, onCancel }: PreviewModalProps) {
  const isEvents = preview.kind === "events";
  const valid    = preview.result.valid;
  const errors   = preview.result.errors;
  const noun     = isEvents ? "event" : "block";

  const newCategories = isEvents ? (preview.result as EventParseResult).newCategories : [];
  const unknownBlocks = isEvents ? (preview.result as EventParseResult).unknownBlocks : [];
  const hasWarnings   = newCategories.length > 0 || unknownBlocks.length > 0;

  const title = isEvents ? "Import events — preview" : "Import time blocks — preview";

  return (
    <Modal title={title} onClose={onCancel} width={500}>
      {/* Summary */}
      <div style={{ marginBottom: "16px" }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", marginBottom: errors.length > 0 ? "4px" : 0 }}>
          {valid.length === 0
            ? `No valid ${noun}s found in the file.`
            : `${valid.length} ${noun}${valid.length !== 1 ? "s" : ""} ready to import.`}
        </p>
        {errors.length > 0 && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {errors.length} row{errors.length !== 1 ? "s" : ""} with errors will be skipped.
          </p>
        )}
      </div>

      {/* Warnings (events only) */}
      {hasWarnings && (
        <div style={{ padding: "12px 14px", background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning)", borderRadius: "var(--radius-md)", marginBottom: "14px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <IconWarning size={15} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }} />
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)", lineHeight: 1.5 }}>
            {newCategories.length > 0 && (
              <p style={{ marginBottom: unknownBlocks.length > 0 ? "6px" : 0 }}>
                <strong>New categories will be created:</strong> {newCategories.join(", ")}
              </p>
            )}
            {unknownBlocks.length > 0 && (
              <p>
                <strong>Unknown block labels will be skipped:</strong> {unknownBlocks.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Row errors */}
      {errors.length > 0 && <ErrorRowList errors={errors} />}

      {/* Progress */}
      {progress && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "12px" }}>
          Importing… {progress.done} / {progress.total}
        </p>
      )}

      {/* API error */}
      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)", marginBottom: "12px" }}>
          {error}
        </p>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onImport}
          disabled={valid.length === 0}
          loading={importing}
        >
          {importing && progress
            ? `Importing ${progress.done}/${progress.total}…`
            : `Import ${valid.length} ${noun}${valid.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </Modal>
  );
}
