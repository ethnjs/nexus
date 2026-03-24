// frontend/components/ui/Icons.tsx
// Centralized SVG icon components used across NEXUS.
// All icons accept optional size (default 16) and className/style props.

import { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

// ─── Navigation / Layout ──────────────────────────────────────────────────────

export function IconHome({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 18v-6h6v6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function IconAssignments({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <rect x="2" y="3" width="16" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="9" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="2" y="15" width="12" height="2" rx="1" fill="currentColor" />
      <circle cx="16" cy="14" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14.5 14l1 1 2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEvents({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 2v4M13 2v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 9h14" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="12" width="3" height="2" rx="0.5" fill="currentColor" />
      <rect x="11" y="12" width="3" height="2" rx="0.5" fill="currentColor" />
    </svg>
  );
}

export function IconVolunteers({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 17c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 17c0-2.21-1.343-4-3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconSheets({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="10" y1="8" x2="10" y2="17" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function IconSettings({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconSync({ size = 14, ...props }: IconProps) {
  // Circle made of two opposing arrows
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      {/* Top arc — left to right */}
      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Arrowhead pointing right on top arc */}
      <path d="M10.5 2.5l1.5 1.7-2 .3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Bottom arc — right to left */}
      <path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Arrowhead pointing left on bottom arc */}
      <path d="M5.5 13.5l-1.5-1.7 2-.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconLogout({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M5 2H3a1 1 0 00-1 1v8a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowLeft({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEdit({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H2v-3L11.5 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
 
export function IconTrash({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
 
export function IconDotsVertical({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <circle cx="8" cy="3" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="13" r="1.25" fill="currentColor" />
    </svg>
  );
}
 
export function IconExport({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Directional ─────────────────────────────────────────────────────────────

export function IconChevronDown({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronRight({ size = 14, expanded = false, ...props }: IconProps & { expanded?: boolean }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 14 14" fill="none"
      style={{ flexShrink: 0, transition: "transform 0.2s ease", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", ...props.style }}
      className={props.className}
    >
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowDown({ size = 22, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" style={props.style} className={props.className}>
      <path d="M11 4v14M4 11l7 7 7-7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Status / Feedback ────────────────────────────────────────────────────────

export function IconCheckCircle({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconWarning({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path
        d="M7.08 2.48a1.05 1.05 0 0 1 1.84 0l5.6 9.8A1.05 1.05 0 0 1 13.6 14H2.4a1.05 1.05 0 0 1-.92-1.72l5.6-9.8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

export function IconCalendar({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 1v3M11 1v3M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconLocation({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M8 1.5A4.5 4.5 0 003.5 6c0 3 4.5 8.5 4.5 8.5S12.5 9 12.5 6A4.5 4.5 0 008 1.5z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}