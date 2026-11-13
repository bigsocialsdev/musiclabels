/** Small inline icons for the storefront (no icon package). Decorative: the buttons carry the labels. */
const base = { 'aria-hidden': true, viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const PlayIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>
);
export const PauseIcon = ({ size = 14 }: { size?: number }) => (
  <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>
);
export const SearchIcon = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const PulseIcon = () => (
  <svg {...base}><path d="M2 12h3l3-8 4 16 3-8h7" /></svg>
);
