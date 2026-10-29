// Íconos SVG en línea (trazo de 1.6 px, 24x24). Sin librerías: pocos, simples y coherentes.
import type { ReactNode } from "react";

export type IconName =
  | "mail"
  | "shield"
  | "shield-off"
  | "check"
  | "x"
  | "ban"
  | "eye-off"
  | "bolt"
  | "flag"
  | "clock"
  | "minus"
  | "agent"
  | "policy"
  | "tool"
  | "report"
  | "play"
  | "compare";

const PATHS: Record<IconName, ReactNode> = {
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  shield: <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z" />,
  "shield-off": (
    <>
      <path d="M9 4.6 12 3l7.5 3v5.5c0 1.6-.4 3-1.1 4.3M6.6 6.9 4.5 6v5.5c0 4.5 3 8 7.5 9.5 1.5-.5 2.8-1.2 3.9-2.2" />
      <path d="m4 4 16 16" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="m4 4 16 16" />
    </>
  ),
  bolt: <path d="M13 3 5 13.500h6L10.5 21 19 10h-6.200L13 3Z" />,
  flag: <path d="M6 21V4m0 0h11l-2.5 4.500L17 13H6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.500V12l3 2" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  agent: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 4v4M9.5 13h.01M14.5 13h.01" />
    </>
  ),
  policy: (
    <>
      <path d="M5 6.500h14M5 12h7M5 17.500h14" />
      <path d="m15 12 2 2 3.5-4" />
    </>
  ),
  tool: <path d="M14.5 5.500a4 4 0 0 0-5 5L4 16l4 4 5.5-5.500a4 4 0 0 0 5-5L16 12l-3-3 1.5-3.500Z" />,
  report: (
    <>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  play: <path d="M8 5.500v13l11-6.5-11-6.500Z" />,
  compare: (
    <>
      <path d="M8 4v16M16 4v16" />
      <path d="m5 7 3-3 3 3M13 17l3 3 3-3" />
    </>
  ),
};

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Marca de InboxEye: un ojo dentro de un escudo (inspecciona lo que entra, protege al agente). */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <path d="M16 3 5.5 7v8.500C5.5 21.5 9.5 26 16 29c6.5-3 10.5-7.5 10.5-13.500V7L16 3Z" fill="var(--surface-2)" stroke="var(--info)" strokeWidth="1.6" />
      <path d="M9.5 16.200S12 11.8 16 11.800s6.5 4.4 6.5 4.400S20 20.6 16 20.6 9.5 16.2 9.5 16.200Z" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="16" cy="16.2" r="2.2" fill="var(--info)" />
    </svg>
  );
}
