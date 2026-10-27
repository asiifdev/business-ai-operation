/** MIME-based validation for FileInput (BR-M14-07). The server must still verify content; the browser's `file.type` is a hint. */

export type FileProblem = { file: File; reason: 'type' | 'size' };

/** accept entries: "image/png", "image/*", "audio/*". Extensions are intentionally not accepted. */
export function matchesAccept(mime: string, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const type = mime.toLowerCase();
  return accept.some((rule) => {
    const r = rule.toLowerCase();
    return r.endsWith('/*') ? type.startsWith(r.slice(0, -1)) : type === r;
  });
}

export function checkFiles(files: readonly File[], accept: readonly string[], maxBytes?: number) {
  const accepted: File[] = [];
  const problems: FileProblem[] = [];
  for (const file of files) {
    if (!matchesAccept(file.type, accept)) problems.push({ file, reason: 'type' });
    else if (maxBytes !== undefined && file.size > maxBytes) problems.push({ file, reason: 'size' });
    else accepted.push(file);
  }
  return { accepted, problems };
}
