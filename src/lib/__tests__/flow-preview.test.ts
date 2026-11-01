import { describe, expect, it } from 'vitest';
import { previewValue } from '../flow-preview';

const words = { secret: '(rahasia)', stepResult: '(hasil langkah)', fromProduct: '(dari produk)' };

describe('approval screen values', () => {
  it('shows what the person typed in place of a params reference', () => {
    expect(previewValue('{{params.folder_root}}/{{params.domain}}', { folder_root: '/www/wwwroot', domain: 'kafe.example.com' }, words)).toBe('/www/wwwroot/kafe.example.com');
  });

  it('says when a secret or an earlier step result will exist instead of showing the reference', () => {
    expect(previewValue('DB_PASSWORD={{secrets.db_password}} PORT={{nodes.port.port}}', {}, words)).toBe('DB_PASSWORD=(rahasia) PORT=(hasil langkah)');
    expect(previewValue('{{product.repo}}', {}, words)).toBe('(dari produk)');
  });

  it('leaves a reference it cannot fill as it is, and plain text untouched', () => {
    expect(previewValue('{{params.missing}}', { other: 'x' }, words)).toBe('{{params.missing}}');
    expect(previewValue('APP_ENV=production', {}, words)).toBe('APP_ENV=production');
  });

  it('turns numbers and flags typed as parameters into text', () => {
    expect(previewValue('{{params.port}}-{{params.tls}}', { port: 6001, tls: true }, words)).toBe('6001-true');
  });
});
