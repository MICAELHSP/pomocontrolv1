// Ícones do protótipo (traço 24x24).
import type { JSX } from 'react';

const P = (d: JSX.Element) => () => <svg viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;

export const I = {
  play: () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" /></svg>,
  pause: P(<path d="M8 5v14M16 5v14" />),
  stop: P(<rect x="6" y="6" width="12" height="12" rx="1.5" />),
  skip: P(<path d="M6 5l9 7-9 7zM18 5v14" />),
  grid: P(<><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 4v17M13 4v17M3 14h18" /></>),
  check: P(<path d="M5 12l5 5 9-10" />),
  lock: P(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>),
  x: P(<path d="M6 6l12 12M18 6L6 18" />),
  cal: P(<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>),
  list: P(<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />),
  repeat: P(<path d="M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4" />),
  timer: P(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>),
  warn: P(<><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5h.01" /></>),
  sub: P(<path d="M6 4v10a3 3 0 003 3h9M15 14l3 3-3 3" />),
  cl: P(<path d="M4 7l2 2 4-4M4 16l2 2 4-4M13 7h7M13 16h7" />),
  plus: P(<path d="M12 5v14M5 12h14" />),
  trash: P(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
  out: P(<path d="M15 4h4v16h-4M10 16l-4-4 4-4M6 12h10" />),
  spark: P(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />),
  gear: P(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
  eye: P(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeoff: P(<path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2" />),
  grip: () => <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="4" cy="2.5" r="1.1" /><circle cx="8" cy="2.5" r="1.1" /><circle cx="4" cy="6" r="1.1" /><circle cx="8" cy="6" r="1.1" /><circle cx="4" cy="9.5" r="1.1" /><circle cx="8" cy="9.5" r="1.1" /></svg>,
  up: P(<path d="M12 19V5M6 11l6-6 6 6" />),
  down: P(<path d="M12 5v14M6 13l6 6 6-6" />),
};
