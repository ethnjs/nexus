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
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M2 6h12M6 6v8" />
    </svg>
  );
}

export function IconUpload({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M8 10V2M5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.5-3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.5 2.5l1.5 1.7-2 .3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.5 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={props.style} className={props.className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.56078 20.2501L20.5608 8.25011L15.7501 3.43945L3.75012 15.4395V20.2501H8.56078ZM15.7501 5.56077L18.4395 8.25011L16.5001 10.1895L13.8108 7.50013L15.7501 5.56077ZM12.7501 8.56079L15.4395 11.2501L7.93946 18.7501H5.25012L5.25012 16.0608L12.7501 8.56079Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconTrash({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M2 4.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 4.5l.75 8.25A1 1 0 005.25 13.5h5.5a1 1 0 001-.75L12.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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

export function IconSwitch({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <path d="M2 5h10M9 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11H4M7 8l-3 3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
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

/**
 * Circle with an X inside — X has breathing room from the circle edge.
 * Used for error states in banners and feedback UI.
 */
export function IconErrorCircle({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      {/* Outer circle — slightly thinner so it doesn't visually merge with the X */}
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
      {/* X — inset from the circle so there's clear space between them */}
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Warning triangle — slightly larger exclamation mark for better legibility.
 * Used for warning states in banners and feedback UI.
 */
export function IconWarningBanner({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={props.style} className={props.className}>
      <path
        d="M8.13 2.4a1.05 1.05 0 0 1 1.74 0l6.3 10.5A1.05 1.05 0 0 1 15.3 14.5H2.7a1.05 1.05 0 0 1-.87-1.6L8.13 2.4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Taller stem for better legibility */}
      <path d="M9 7v3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="12.25" r="0.85" fill="currentColor" />
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

export function IconSearch({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 11l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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

export function IconLayoutCards({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconLayoutTable({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <rect x="2" y="2" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="7" width="12" height="2.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="11.5" width="12" height="2.5" rx="0.75" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}