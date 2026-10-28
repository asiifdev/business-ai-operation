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
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  alert: 'M12 4 3 19.5h18zM12 10v4.5M12 17.2h.01',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0',
  chevron: 'M8 10l4 4 4-4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z',
  language: 'M4 6h9M8.5 4v2M6 6c.5 3.5 3 6 6 7M12 6c-.5 3-3 6-7 8M13 20l4-9 4 9M14.5 17h5',
};

/** One stroke style for every app icon, drawn on a 24 grid. Decorative: the label next to it carries the meaning. */
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
