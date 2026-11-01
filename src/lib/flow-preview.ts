/**
 * What a person reads on the approval screen. A step's settings hold template references (`{{params.domain}}`); showing
 * them raw asks the Owner to approve something unreadable. Values the person typed are shown as typed; a secret or a
 * result of an earlier step does not exist yet, so it says when it will.
 */
export interface PreviewWords {
  secret: string;
  stepResult: string;
  fromProduct: string;
}

const REF = /\{\{\s*([a-z_]+)\.([A-Za-z0-9_.]+)\s*\}\}/g;

export function previewValue(template: string, params: Record<string, unknown>, words: PreviewWords): string {
  return template.replace(REF, (whole, scope: string, path: string) => {
    if (scope === 'params') {
      const value = params[path];
      return value === undefined || value === null || value === '' ? whole : String(value);
    }
    if (scope === 'secrets') return words.secret;
    if (scope === 'nodes') return words.stepResult;
    if (scope === 'product') return words.fromProduct;
    return whole;
  });
}
