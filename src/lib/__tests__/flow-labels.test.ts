import { describe, expect, it } from 'vitest';
import { describeFields } from '../../domain/flows/tools/describe';
import { TOOLS } from '../../domain/flows/tools';
import { FIELD_TEXT, fieldText, optionLabel } from '../flow-labels';

const LOCALES = ['id', 'en'] as const;

describe('words for every flow tool setting', () => {
  it('every setting of every tool has a label and a help in both languages', () => {
    for (const tool of TOOLS) {
      for (const field of describeFields(tool)) {
        for (const locale of LOCALES) {
          const words = fieldText(locale, tool.id, field.key);
          expect(words, `${tool.id}:${field.key} (${locale}) has no words in src/lib/flow-labels.ts`).not.toBeNull();
          expect(words!.label.trim().length).toBeGreaterThan(2);
          expect(words!.label, `${tool.id}:${field.key} still shows the key`).not.toBe(field.key);
          expect(words!.help.trim().length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('every fixed choice of a setting has its own words in both languages', () => {
    for (const tool of TOOLS) {
      for (const field of describeFields(tool)) {
        for (const option of field.options ?? []) {
          for (const locale of LOCALES) {
            expect(optionLabel(locale, field.key, option), `${field.key}:${option} (${locale})`).not.toBe(option);
          }
        }
      }
    }
  });

  it('has no entry for a setting no tool has (a rename must not leave dead words behind)', () => {
    const live = new Set(TOOLS.flatMap((tool) => describeFields(tool).flatMap((f) => [f.key, `${tool.id}:${f.key}`])));
    for (const locale of LOCALES) {
      for (const key of Object.keys(FIELD_TEXT[locale])) expect(live.has(key), `${locale}: ${key} matches no tool setting`).toBe(true);
    }
  });

  it('both languages cover the same settings', () => {
    expect(Object.keys(FIELD_TEXT.id).sort()).toEqual(Object.keys(FIELD_TEXT.en).sort());
  });
});
