import type { IconName } from '../../lib/nav';

const paths: Record<IconName, string> = {
  home: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5h4v5',
  clients: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6',
  pipeline: 'M4 5h4.5v14H4zM9.75 5h4.5v9.5h-4.5zM15.5 5H20v6h-4.5z',
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
  mic: 'M12 3.5a3 3 0 0 0-3 3V12a3 3 0 0 0 6 0V6.5a3 3 0 0 0-3-3M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6',
  send: 'M20.5 3.5 3.5 10.5l6.5 2.5 2.5 6.5zM10 13l4.5-4.5',
  tasks: 'M10 6.5h10M10 12h10M10 17.5h10M4 6.5l1.25 1.25L7.5 5.5M4 12l1.25 1.25L7.5 11M4 17.5l1.25 1.25L7.5 16.5',
  invoice: 'M6 3.5h9l3 3V20.5H6zM14.5 3.5v3.5h3.5M9 11.5h6M9 14.5h6M9 17.5h3.5',
  repeat: 'M17 4l3 3-3 3M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M7 20l-3-3 3-3M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0',
  chevron: 'M8 10l4 4 4-4',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
  moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z',
  language: 'M4 6h9M8.5 4v2M6 6c.5 3.5 3 6 6 7M12 6c-.5 3-3 6-7 8M13 20l4-9 4 9M14.5 17h5',
  history: 'M12 7v5l3 2M4 12a8 8 0 1 0 2.5-5.8M4 5v4h4',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  edit: 'M5 19l1-4L16.5 4.5a2 2 0 0 1 3 3L9 18zM14.5 6.5l3 3',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10 11v6M14 11v6',
  building: 'M5 20V5.5L12 3l7 2.5V20M3.5 20h17M9 9h1.5M13.5 9H15M9 13h1.5M13.5 13H15M10.5 20v-3h3v3',
  attach: 'M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  briefing: 'M12 4v2M5.6 7.6 7 9M18.4 7.6 17 9M4 15h16M7 15a5 5 0 0 1 10 0M8 19h8',
};

/** One stroke style for every app icon, drawn on a 24 grid. Decorative: the label next to it carries the meaning. */
export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
