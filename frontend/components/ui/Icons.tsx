// frontend/components/ui/Icons.tsx
// Centralized SVG icon components used across NEXUS.
// All icons accept optional size (default 16) and className/style props.

import { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

// -------------------------------------------------------------------------
// Navigation / Layout
// -------------------------------------------------------------------------

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
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        fill="currentColor"
        d="M384 64L224 64C206.3 64 192 78.3 192 96C192 113.7 206.3 128 224 128L224 279.5L103.5 490.3C98.6 499 96 508.7 96 518.7C96 550.4 121.6 576 153.3 576L486.7 576C518.3 576 544 550.4 544 518.7C544 508.7 541.4 498.9 536.5 490.3L416 279.5L416 128C433.7 128 448 113.7 448 96C448 78.3 433.7 64 416 64L384 64zM288 279.5L288 128L352 128L352 279.5C352 290.6 354.9 301.6 360.4 311.3L402 384L238 384L279.6 311.3C285.1 301.6 288 290.7 288 279.5z"
      />
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

export function IconForms({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M128 128C128 92.7 156.7 64 192 64L341.5 64C358.5 64 374.8 70.7 386.8 82.7L493.3 189.3C505.3 201.3 512 217.6 512 234.6L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 128zM336 122.5L336 216C336 229.3 346.7 240 360 240L453.5 240L336 122.5zM248 320C234.7 320 224 330.7 224 344C224 357.3 234.7 368 248 368L392 368C405.3 368 416 357.3 416 344C416 330.7 405.3 320 392 320L248 320zM248 416C234.7 416 224 426.7 224 440C224 453.3 234.7 464 248 464L392 464C405.3 464 416 453.3 416 440C416 426.7 405.3 416 392 416L248 416z" />
    </svg>
  );
}

export function IconMembers({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M320 80C377.4 80 424 126.6 424 184C424 241.4 377.4 288 320 288C262.6 288 216 241.4 216 184C216 126.6 262.6 80 320 80zM96 152C135.8 152 168 184.2 168 224C168 263.8 135.8 296 96 296C56.2 296 24 263.8 24 224C24 184.2 56.2 152 96 152zM0 480C0 409.3 57.3 352 128 352C140.8 352 153.2 353.9 164.9 357.4C132 394.2 112 442.8 112 496L112 512C112 523.4 114.4 534.2 118.7 544L32 544C14.3 544 0 529.7 0 512L0 480zM521.3 544C525.6 534.2 528 523.4 528 512L528 496C528 442.8 508 394.2 475.1 357.4C486.8 353.9 499.2 352 512 352C582.7 352 640 409.3 640 480L640 512C640 529.7 625.7 544 608 544L521.3 544zM472 224C472 184.2 504.2 152 544 152C583.8 152 616 184.2 616 224C616 263.8 583.8 296 544 296C504.2 296 472 263.8 472 224zM160 496C160 407.6 231.6 336 320 336C408.4 336 480 407.6 480 496L480 512C480 529.7 465.7 544 448 544L192 544C174.3 544 160 529.7 160 512L160 496z" />
    </svg>
  );
}

export function IconUpload({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M342.6 73.4C330.1 60.9 309.8 60.9 297.3 73.4L169.3 201.4C156.8 213.9 156.8 234.2 169.3 246.7C181.8 259.2 202.1 259.2 214.6 246.7L288 173.3L288 384C288 401.7 302.3 416 320 416C337.7 416 352 401.7 352 384L352 173.3L425.4 246.7C437.9 259.2 458.2 259.2 470.7 246.7C483.2 234.2 483.2 213.9 470.7 201.4L342.7 73.4zM160 416C160 398.3 145.7 384 128 384C110.3 384 96 398.3 96 416L96 480C96 533 139 576 192 576L448 576C501 576 544 533 544 480L544 416C544 398.3 529.7 384 512 384C494.3 384 480 398.3 480 416L480 480C480 497.7 465.7 512 448 512L192 512C174.3 512 160 497.7 160 480L160 416z" />
    </svg>
  );
}

export function IconSettings({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        d="M259.1 73.5C262.1 58.7 275.2 48 290.4 48L350.2 48C365.4 48 378.5 58.7 381.5 73.5L396 143.5C410.1 149.5 423.3 157.2 435.3 166.3L503.1 143.8C517.5 139 533.3 145 540.9 158.2L570.8 210C578.4 223.2 575.7 239.8 564.3 249.9L511 297.3C511.9 304.7 512.3 312.3 512.3 320C512.3 327.7 511.8 335.3 511 342.7L564.4 390.2C575.8 400.3 578.4 417 570.9 430.1L541 481.9C533.4 495 517.6 501.1 503.2 496.3L435.4 473.8C423.3 482.9 410.1 490.5 396.1 496.6L381.7 566.5C378.6 581.4 365.5 592 350.4 592L290.6 592C275.4 592 262.3 581.3 259.3 566.5L244.9 496.6C230.8 490.6 217.7 482.9 205.6 473.8L137.5 496.3C123.1 501.1 107.3 495.1 99.7 481.9L69.8 430.1C62.2 416.9 64.9 400.3 76.3 390.2L129.7 342.7C128.8 335.3 128.4 327.7 128.4 320C128.4 312.3 128.9 304.7 129.7 297.3L76.3 249.8C64.9 239.7 62.3 223 69.8 209.9L99.7 158.1C107.3 144.9 123.1 138.9 137.5 143.7L205.3 166.2C217.4 157.1 230.6 149.5 244.6 143.4L259.1 73.5zM320.3 400C364.5 399.8 400.2 363.9 400 319.7C399.8 275.5 363.9 239.8 319.7 240C275.5 240.2 239.8 276.1 240 320.3C240.2 364.5 276.1 400.2 320.3 400z"
        fill="currentColor"
      />
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

export function IconUserShield({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        fill="currentColor"
        d="M256 312C322.3 312 376 258.3 376 192C376 125.7 322.3 72 256 72C189.7 72 136 125.7 136 192C136 258.3 189.7 312 256 312zM226.3 368C127.8 368 48 447.8 48 546.3C48 562.7 61.3 576 77.7 576L329.2 576C293 533.4 272 478.5 272 420.4L272 389.3C272 382 273 374.8 274.9 368L226.3 368zM477.3 552.5L464 558.8L464 370.7L560 402.7L560 422.3C560 478.1 527.8 528.8 477.3 552.6zM453.9 323.5L341.9 360.8C328.8 365.2 320 377.4 320 391.2L320 422.3C320 496.7 363 564.4 430.2 596L448.7 604.7C453.5 606.9 458.7 608.1 463.9 608.1C469.1 608.1 474.4 606.9 479.1 604.7L497.6 596C565 564.3 608 496.6 608 422.2L608 391.1C608 377.3 599.2 365.1 586.1 360.7L474.1 323.4C467.5 321.2 460.4 321.2 453.9 323.4z"
      />
    </svg>
  );
}

export function IconMenu({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        d="M96 160C96 142.3 110.3 128 128 128L512 128C529.7 128 544 142.3 544 160C544 177.7 529.7 192 512 192L128 192C110.3 192 96 177.7 96 160zM96 320C96 302.3 110.3 288 128 288L512 288C529.7 288 544 302.3 544 320C544 337.7 529.7 352 512 352L128 352C110.3 352 96 337.7 96 320zM544 480C544 497.7 529.7 512 512 512L128 512C110.3 512 96 497.7 96 480C96 462.3 110.3 448 128 448L512 448C529.7 448 544 462.3 544 480z"
        fill="currentColor"
      />
    </svg>
  );
}

// display_style toggle between a plain radio/checkbox list and a
// ButtonGroup pill layout — a "power button" glyph rather than IconMenu's
// hamburger, since it reads closer to "toggle" than "more options."
export function IconButton({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        fill="currentColor"
        d="M352 64C352 46.3 337.7 32 320 32C302.3 32 288 46.3 288 64L288 320C288 337.7 302.3 352 320 352C337.7 352 352 337.7 352 320L352 64zM210.3 162.4C224.8 152.3 228.3 132.3 218.2 117.8C208.1 103.3 188.1 99.8 173.6 109.9C107.4 156.1 64 233 64 320C64 461.4 178.6 576 320 576C461.4 576 576 461.4 576 320C576 233 532.6 156.1 466.3 109.9C451.8 99.8 431.9 103.3 421.7 117.8C411.5 132.3 415.1 152.2 429.6 162.4C479.4 197.2 511.9 254.8 511.9 320C511.9 426 425.9 512 319.9 512C213.9 512 128 426 128 320C128 254.8 160.5 197.1 210.3 162.4z"
      />
    </svg>
  );
}

// The field_key editor's toolbar trigger — a literal key, echoing "this is
// the identifier", distinct from IconPresets below.
export function IconKey({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        fill="currentColor"
        d="M400 416C497.2 416 576 337.2 576 240C576 142.8 497.2 64 400 64C302.8 64 224 142.8 224 240C224 258.7 226.9 276.8 232.3 293.7L71 455C66.5 459.5 64 465.6 64 472L64 552C64 565.3 74.7 576 88 576L168 576C181.3 576 192 565.3 192 552L192 512L232 512C245.3 512 256 501.3 256 488L256 448L296 448C302.4 448 308.5 445.5 313 441L346.3 407.7C363.2 413.1 381.3 416 400 416zM440 160C462.1 160 480 177.9 480 200C480 222.1 462.1 240 440 240C417.9 240 400 222.1 400 200C400 177.9 417.9 160 440 160z"
      />
    </svg>
  );
}

// The reserved-preset picker's toolbar trigger (availability/event
// preference/lunch) — a folder of templates, distinct from IconKey above.
export function IconPresets({ size = 18, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path
        fill="currentColor"
        d="M88 289.6L64.4 360.2L64.4 160C64.4 124.7 93.1 96 128.4 96L267.1 96C280.9 96 294.4 100.5 305.5 108.8L343.9 137.6C349.4 141.8 356.2 144 363.1 144L480.4 144C515.7 144 544.4 172.7 544.4 208L544.4 224L179 224C137.7 224 101 250.4 87.9 289.6zM509.8 512L131 512C98.2 512 75.1 479.9 85.5 448.8L133.5 304.8C140 285.2 158.4 272 179 272L557.8 272C590.6 272 613.7 304.1 603.3 335.2L555.3 479.2C548.8 498.8 530.4 512 509.8 512z"
      />
    </svg>
  );
}

// -------------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------------

export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M352 128C352 110.3 337.7 96 320 96C302.3 96 288 110.3 288 128L288 288L128 288C110.3 288 96 302.3 96 320C96 337.7 110.3 352 128 352L288 352L288 512C288 529.7 302.3 544 320 544C337.7 544 352 529.7 352 512L352 352L512 352C529.7 352 544 337.7 544 320C544 302.3 529.7 288 512 288L352 288L352 128z" />
    </svg>
  );
}

// Toggle a description input on/below a field.
export function IconDescription({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M256 64L512 64C529.7 64 544 78.3 544 96C544 113.7 529.7 128 512 128L480 128L480 544C480 561.7 465.7 576 448 576C430.3 576 416 561.7 416 544L416 128L368 128L368 544C368 561.7 353.7 576 336 576C318.3 576 304 561.7 304 544L304 384L256 384C167.6 384 96 312.4 96 224C96 135.6 167.6 64 256 64z" />
    </svg>
  );
}

export function IconMinus({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M96 320C96 302.3 110.3 288 128 288L512 288C529.7 288 544 302.3 544 320C544 337.7 529.7 352 512 352L128 352C110.3 352 96 337.7 96 320z" />
    </svg>
  );
}

export function IconSave({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M160 96C124.7 96 96 124.7 96 160L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 237.3C544 220.3 537.3 204 525.3 192L448 114.7C436 102.7 419.7 96 402.7 96L160 96zM192 192C192 174.3 206.3 160 224 160L384 160C401.7 160 416 174.3 416 192L416 256C416 273.7 401.7 288 384 288L224 288C206.3 288 192 273.7 192 256L192 192zM320 352C355.3 352 384 380.7 384 416C384 451.3 355.3 480 320 480C284.7 480 256 451.3 256 416C256 380.7 284.7 352 320 352z" />
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

export function IconExpand({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={props.style} className={props.className}>
      <path
        d="M384 64C366.3 64 352 78.3 352 96C352 113.7 366.3 128 384 128L466.7 128L265.3 329.4C252.8 341.9 252.8 362.2 265.3 374.7C277.8 387.2 298.1 387.2 310.6 374.7L512 173.3L512 256C512 273.7 526.3 288 544 288C561.7 288 576 273.7 576 256L576 96C576 78.3 561.7 64 544 64L384 64zM144 160C99.8 160 64 195.8 64 240L64 496C64 540.2 99.8 576 144 576L400 576C444.2 576 480 540.2 480 496L480 416C480 398.3 465.7 384 448 384C430.3 384 416 398.3 416 416L416 496C416 504.8 408.8 512 400 512L144 512C135.2 512 128 504.8 128 496L128 240C128 231.2 135.2 224 144 224L224 224C241.7 224 256 209.7 256 192C256 174.3 241.7 160 224 160L144 160z"
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
 
export function IconCopy({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M288 64C252.7 64 224 92.7 224 128L224 384C224 419.3 252.7 448 288 448L480 448C515.3 448 544 419.3 544 384L544 183.4C544 166 536.9 149.3 524.3 137.2L466.6 81.8C454.7 70.4 438.8 64 422.3 64L288 64zM160 192C124.7 192 96 220.7 96 256L96 512C96 547.3 124.7 576 160 576L352 576C387.3 576 416 547.3 416 512L416 496L352 496L352 512L160 512L160 256L176 256L176 192L160 192z" />
    </svg>
  );
}

export function IconBranch({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M176 168C189.3 168 200 157.3 200 144C200 130.7 189.3 120 176 120C162.7 120 152 130.7 152 144C152 157.3 162.7 168 176 168zM256 144C256 176.8 236.3 205 208 217.3L208 288L384 288C410.5 288 432 266.5 432 240L432 217.3C403.7 205 384 176.8 384 144C384 99.8 419.8 64 464 64C508.2 64 544 99.8 544 144C544 176.8 524.3 205 496 217.3L496 240C496 301.9 445.9 352 384 352L208 352L208 422.7C236.3 435 256 463.2 256 496C256 540.2 220.2 576 176 576C131.8 576 96 540.2 96 496C96 463.2 115.7 435 144 422.7L144 217.4C115.7 205 96 176.8 96 144C96 99.8 131.8 64 176 64C220.2 64 256 99.8 256 144zM488 144C488 130.7 477.3 120 464 120C450.7 120 440 130.7 440 144C440 157.3 450.7 168 464 168C477.3 168 488 157.3 488 144zM176 520C189.3 520 200 509.3 200 496C200 482.7 189.3 472 176 472C162.7 472 152 482.7 152 496C152 509.3 162.7 520 176 520z" />
    </svg>
  );
}

export function IconSwap({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M566.6 214.6L470.6 310.6C461.4 319.8 447.7 322.5 435.7 317.5C423.7 312.5 416 300.9 416 288L416 224L96 224C78.3 224 64 209.7 64 192C64 174.3 78.3 160 96 160L416 160L416 96C416 83.1 423.8 71.4 435.8 66.4C447.8 61.4 461.5 64.2 470.7 73.3L566.7 169.3C579.2 181.8 579.2 202.1 566.7 214.6zM169.3 566.6L73.3 470.6C60.8 458.1 60.8 437.8 73.3 425.3L169.3 329.3C178.5 320.1 192.2 317.4 204.2 322.4C216.2 327.4 224 339.1 224 352L224 416L544 416C561.7 416 576 430.3 576 448C576 465.7 561.7 480 544 480L224 480L224 544C224 556.9 216.2 568.6 204.2 573.6C192.2 578.6 178.5 575.8 169.3 566.7z" />
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
 
export function IconLock({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconEye({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" style={props.style} className={props.className}>
      <path
        fill="currentColor"
        d="M320 96C239.2 96 174.5 132.8 127.4 176.6C80.6 220.1 49.3 272 34.4 307.7C31.1 315.6 31.1 324.4 34.4 332.3C49.3 368 80.6 420 127.4 463.4C174.5 507.1 239.2 544 320 544C400.8 544 465.5 507.2 512.6 463.4C559.4 419.9 590.7 368 605.6 332.3C608.9 324.4 608.9 315.6 605.6 307.7C590.7 272 559.4 220 512.6 176.6C465.5 132.9 400.8 96 320 96zM176 320C176 240.5 240.5 176 320 176C399.5 176 464 240.5 464 320C464 399.5 399.5 464 320 464C240.5 464 176 399.5 176 320zM320 256C320 291.3 291.3 320 256 320C244.5 320 233.7 317 224.3 311.6C223.3 322.5 224.2 333.7 227.2 344.8C240.9 396 293.6 426.4 344.8 412.7C396 399 426.4 346.3 412.7 295.1C400.5 249.4 357.2 220.3 311.6 224.3C316.9 233.6 320 244.4 320 256z"
      />
    </svg>
  );
}

export function IconSearch({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.5 13.5l-2.8-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconFilter({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M96 128C83.1 128 71.4 135.8 66.4 147.8C61.4 159.8 64.2 173.5 73.4 182.6L256 365.3L256 480C256 488.5 259.4 496.6 265.4 502.6L329.4 566.6C338.6 575.8 352.3 578.5 364.3 573.5C376.3 568.5 384 556.9 384 544L384 365.3L566.6 182.7C575.8 173.5 578.5 159.8 573.5 147.8C568.5 135.8 556.9 128 544 128L96 128z" />
    </svg>
  );
}

export function IconGripVertical({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={props.style} className={props.className}>
      <circle cx="6" cy="3.5" r="1.1" fill="currentColor" />
      <circle cx="10" cy="3.5" r="1.1" fill="currentColor" />
      <circle cx="6" cy="8" r="1.1" fill="currentColor" />
      <circle cx="10" cy="8" r="1.1" fill="currentColor" />
      <circle cx="6" cy="12.5" r="1.1" fill="currentColor" />
      <circle cx="10" cy="12.5" r="1.1" fill="currentColor" />
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

// -------------------------------------------------------------------------
// Directional
// -------------------------------------------------------------------------

export function IconArrowLeft({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronDown({ size = 14, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={props.style} className={props.className}>
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconChevronRight({ size = 14, ...props }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 14 14" fill="none"
      style={{ flexShrink: 0, transition: "transform 0.2s ease", ...props.style }}
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

// -------------------------------------------------------------------------
// Status / Feedback
// -------------------------------------------------------------------------

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

export function IconArchive({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M64 128C64 110.3 78.3 96 96 96L544 96C561.7 96 576 110.3 576 128L576 160C576 177.7 561.7 192 544 192L96 192C78.3 192 64 177.7 64 160L64 128zM96 240L544 240L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 240zM248 304C234.7 304 224 314.7 224 328C224 341.3 234.7 352 248 352L392 352C405.3 352 416 341.3 416 328C416 314.7 405.3 304 392 304L248 304z" />
    </svg>
  );
}

// Counter-clockwise arrow — undoing/bringing something back, paired with
// IconArchive wherever an archive can be reversed.
export function IconRestore({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M136 128C136 114.7 125.3 104 112 104C98.7 104 88 114.7 88 128L88 256C88 269.3 98.7 280 112 280L240 280C253.3 280 264 269.3 264 256C264 242.7 253.3 232 240 232L166.6 232C201.5 176.6 263.4 140 334 140C443.4 140 532 228.6 532 338C532 447.4 443.4 536 334 536C280.6 536 232.3 514.9 196.8 480.6C187.3 471.4 172.1 471.7 162.9 481.2C153.7 490.7 154 505.9 163.5 515.1C207.6 557.7 267.8 584 334 584C469.9 584 580 473.9 580 338C580 202.1 469.9 92 334 92C252.9 92 181 131.2 136 191.6L136 128z" />
    </svg>
  );
}

export function IconInvite({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M285.7 368C384.2 368 464 447.8 464 546.3C464 562.7 450.7 576 434.3 576L77.7 576C61.3 576 48 562.7 48 546.3C48 447.8 127.8 368 226.3 368L285.7 368zM528 144C541.3 144 552 154.7 552 168L552 216L600 216C613.3 216 624 226.7 624 240C624 253.3 613.3 264 600 264L552 264L552 312C552 325.3 541.3 336 528 336C514.7 336 504 325.3 504 312L504 264L456 264C442.7 264 432 253.3 432 240C432 226.7 442.7 216 456 216L504 216L504 168C504 154.7 514.7 144 528 144zM256 312C189.7 312 136 258.3 136 192C136 125.7 189.7 72 256 72C322.3 72 376 125.7 376 192C376 258.3 322.3 312 256 312z" />
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

// -------------------------------------------------------------------------
// Content
// -------------------------------------------------------------------------

export function IconCalendar({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={{ flexShrink: 0, ...props.style }} className={props.className}>
      <path d="M224 64C206.3 64 192 78.3 192 96L192 128L160 128C124.7 128 96 156.7 96 192L96 240L544 240L544 192C544 156.7 515.3 128 480 128L448 128L448 96C448 78.3 433.7 64 416 64C398.3 64 384 78.3 384 96L384 128L256 128L256 96C256 78.3 241.7 64 224 64zM96 288L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 288L96 288z" />
    </svg>
  );
}


export function IconLocation({ size = 13, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 640 640" fill="currentColor" style={props.style} className={props.className}>
      <path d="M128 252.6C128 148.4 214 64 320 64C426 64 512 148.4 512 252.6C512 371.9 391.8 514.9 341.6 569.4C329.8 582.2 310.1 582.2 298.3 569.4C248.1 514.9 127.9 371.9 127.9 252.6zM320 320C355.3 320 384 291.3 384 256C384 220.7 355.3 192 320 192C284.7 192 256 220.7 256 256C256 291.3 284.7 320 320 320z" />
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