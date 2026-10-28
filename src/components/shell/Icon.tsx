import type { IconName } from '../../lib/nav';

const paths: Record<IconName, string> = {
  home: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5h4v5',
  clients: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  products: 'M12 3 4 7.5v9L12 21l8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  assistant: 'M4 5.5h16v11H10l-4.5 3.5v-3.5H4zM8 10h8M8 13h5',
  usage: 'M4.5 17a7.5 7.5 0 1 1 15 0M12 17l3.5-5M7 17h.01M17 17h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  signout: 'M14 4h5.5v16H14M10 8l-4 4 4 4M6 12h10',
  close: 'M6 6l12 12M18 6 6 18',
};

/** One stroke style for every app icon, drawn on a 24 grid. Decorative: the label next to it carries the meaning. */
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
