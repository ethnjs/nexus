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

export function IconShield({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M10 2l7 3v5c0 4.5-3 7.5-7 8-4-0.5-7-3.5-7-8V5l7-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
    <svg width={size} height={size} viewBox="0 0 640 640" style={props.style} className={props.className}>
      <path
        d="M416.9 85.2L372 130.1L509.9 268L554.8 223.1C568.4 209.6 576 191.2 576 172C576 152.8 568.4 134.4 554.8 120.9L519.1 85.2C505.6 71.6 487.2 64 468 64C448.8 64 430.4 71.6 416.9 85.2zM338.1 164L122.9 379.1C112.2 389.8 104.4 403.2 100.3 417.8L64.9 545.6C62.6 553.9 64.9 562.9 71.1 569C77.3 575.1 86.2 577.5 94.5 575.2L222.3 539.7C236.9 535.6 250.2 527.9 261 517.1L476 301.9L338.1 164z"
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

export function IconChevronLeft({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM438 209.7C427.3 201.9 412.3 204.3 404.5 215L285.1 379.2L233 327.1C223.6 317.7 208.4 317.7 199.1 327.1C189.8 336.5 189.7 351.7 199.1 361L271.1 433C276.1 438 282.9 440.5 289.9 440C296.9 439.5 303.3 435.9 307.4 430.2L443.3 243.2C451.1 232.5 448.7 217.5 438 209.7z" />
    </svg>
  );
}

export function IconXCircle({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM435.3 204.7C424.6 194 407.4 194 396.7 204.7L320 281.4L243.3 204.7C232.6 194 215.4 194 204.7 204.7C194 215.4 194 232.6 204.7 243.3L281.4 320L204.7 396.7C194 407.4 194 424.6 204.7 435.3C215.4 446 232.6 446 243.3 435.3L320 358.6L396.7 435.3C407.4 446 424.6 446 435.3 435.3C446 424.6 446 407.4 435.3 396.7L358.6 320L435.3 243.3C446 232.6 446 215.4 435.3 204.7z" />
    </svg>
  );
}

export function IconWarning({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M320 64C334.7 64 348.2 72.1 355.2 85L571.2 485C577.9 497.4 577.6 512.4 570.4 524.5C563.2 536.6 550.1 544 536 544L104 544C89.9 544 76.8 536.6 69.6 524.5C62.4 512.4 62.1 497.4 68.8 485L284.8 85C291.8 72.1 305.3 64 320 64zM320 416C302.3 416 288 430.3 288 448C288 465.7 302.3 480 320 480C337.7 480 352 465.7 352 448C352 430.3 337.7 416 320 416zM320 224C301.8 224 287.3 239.5 288.6 257.7L296 361.7C296.9 374.2 307.4 384 319.9 384C332.5 384 342.9 374.3 343.8 361.7L351.2 257.7C352.5 239.5 338.1 224 319.8 224z" />
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

export function IconX({ size = 12, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M504.6 148.5C515.9 134.9 514.1 114.7 500.5 103.4C486.9 92.1 466.7 93.9 455.4 107.5L320 270L184.6 107.5C173.3 93.9 153.1 92.1 139.5 103.4C125.9 114.7 124.1 134.9 135.4 148.5L278.3 320L135.4 491.5C124.1 505.1 125.9 525.3 139.5 536.6C153.1 547.9 173.3 546.1 184.6 532.5L320 370L455.4 532.5C466.7 546.1 486.9 547.9 500.5 536.6C514.1 525.3 515.9 505.1 504.6 491.5L361.7 320L504.6 148.5z" />
    </svg>
  );
}

export function IconInfo({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M320 576C461.4 576 576 461.4 576 320C576 178.6 461.4 64 320 64C178.6 64 64 178.6 64 320C64 461.4 178.6 576 320 576zM288 224C288 206.3 302.3 192 320 192C337.7 192 352 206.3 352 224C352 241.7 337.7 256 320 256C302.3 256 288 241.7 288 224zM280 288L328 288C341.3 288 352 298.7 352 312L352 400L360 400C373.3 400 384 410.7 384 424C384 437.3 373.3 448 360 448L280 448C266.7 448 256 437.3 256 424C256 410.7 266.7 400 280 400L304 400L304 336L280 336C266.7 336 256 325.3 256 312C256 298.7 266.7 288 280 288z" />
    </svg>
  );
}

export function IconUser({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={props.style} className={props.className}>
      <path
        d="M463 448.2C440.9 409.8 399.4 384 352 384L288 384C240.6 384 199.1 409.8 177 448.2C212.2 487.4 263.2 512 320 512C376.8 512 427.8 487.3 463 448.2zM64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576C178.6 576 64 461.4 64 320zM320 336C359.8 336 392 303.8 392 264C392 224.2 359.8 192 320 192C280.2 192 248 224.2 248 264C248 303.8 280.2 336 320 336z"
        fill="currentColor"
      />
    </svg>
  );
}