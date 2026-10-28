/**
 * Amounts, dates and counts in an answer must come from tool results, not from the model's own arithmetic (BR-M07-10,
 * CR-05). This lists the numbers in `answer` that appear in none of the `sources`: a flag for the caller, who decides
 * (M08 builds the card text from the tool values and shows the model's text only as explanation).
 */
const NUMBER = /(?<![\w.,])\d+(?:[.,]\d+)*(?![\w])/g;
const LIST_MARKER = /^\s*\d+[.)]\s+/gm;

/** `12.500.000` and `12,500,000` both become `12500000`; a short fraction such as `3,5` stays `3.5`. */
export function normalizeNumber(token: string): string {
  if (/^\d{1,3}([.,]\d{3})+$/.test(token)) return token.replace(/[.,]/g, '');
  if (/^\d+[.,]\d{1,2}$/.test(token)) return token.replace(',', '.');
  return token.replace(/[.,]/g, '');
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => m[0].replace(/[.,]+$/, ''));
}

export function findUnverifiedNumbers(answer: string, sources: readonly string[], trusted: readonly string[] = []): string[] {
  const known = new Set<string>();
  for (const source of [...sources, ...trusted]) for (const token of numbersIn(source)) known.add(normalizeNumber(token));
  const unverified = new Set<string>();
  for (const token of numbersIn(answer.replace(LIST_MARKER, ''))) {
    if (!known.has(normalizeNumber(token))) unverified.add(token);
  }
  return [...unverified];
}
