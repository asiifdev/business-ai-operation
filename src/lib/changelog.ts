import { readFileSync } from 'node:fs';

export interface ChangelogGroup {
  title: string;
  items: string[];
}

/** Reads CHANGELOG.md at build time so the public changelog is the real one (BR-M16-25). */
export function readChangelog(path = 'CHANGELOG.md'): { unreleased: ChangelogGroup[] } {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { unreleased: [] };
  }
  const section = /## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/.exec(text)?.[1] ?? '';
  const groups: ChangelogGroup[] = [];
  let current: ChangelogGroup | null = null;
  for (const line of section.split('\n')) {
    const h = /^###\s+(.+)$/.exec(line);
    if (h) {
      current = { title: h[1].trim(), items: [] };
      groups.push(current);
      continue;
    }
    const item = /^-\s+(.+)$/.exec(line);
    if (item && current) current.items.push(item[1].trim());
  }
  return { unreleased: groups.filter((g) => g.items.length > 0) };
}

/** Escapes text and turns `code` spans into <code>. Input is our own changelog, still escaped for safety. */
export function inlineMarkup(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/`([^`]+)`/g, '<code>$1</code>');
}
