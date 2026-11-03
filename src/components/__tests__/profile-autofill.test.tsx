import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProfileAutofill } from '../settings/ProfileAutofill';

const empty = { tagline: '', industry: '', description: '', targetAudience: '', valueProps: '', website: '', contactEmail: '', contactPhone: '', address: '', socials: {} };

describe('ProfileAutofill', () => {
  // It always sits inside the profile form. A <form> here would be nested, and its button would submit the outer form and reload the page.
  it('holds no <form> of its own and its button never submits', () => {
    const out = renderToStaticMarkup(<ProfileAutofill current={empty} onApply={() => undefined} />);
    expect(out).not.toContain('<form');
    expect(out).toContain('type="button"');
    expect(out).not.toContain('type="submit"');
  });
});
