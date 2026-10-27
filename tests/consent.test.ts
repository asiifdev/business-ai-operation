import { describe, expect, it, vi } from 'vitest';
import { CONSENT_KEY, createConsent } from '../src/lib/consent';

/** D-031, BR-M16-30: nothing is requested from Google before the visitor accepts. */
function setup(initial?: string) {
  const store = new Map<string, string>(initial ? [[CONSENT_KEY, initial]] : []);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const loadScript = vi.fn();
  const gtag = vi.fn();
  const clearCookies = vi.fn();
  const consent = createConsent({ storage, measurementId: 'G-TEST123', loadScript, gtag, clearCookies });
  return { consent, store, loadScript, gtag, clearCookies };
}

describe('analytics consent', () => {
  it('sets every storage type to denied and loads nothing on a first visit', () => {
    const { consent, loadScript, gtag } = setup();
    expect(consent.init()).toBeNull();
    expect(loadScript).not.toHaveBeenCalled();
    expect(gtag).toHaveBeenCalledWith('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  });

  it('loads the Google script only after Accept, and only once', () => {
    const { consent, loadScript } = setup();
    consent.init();
    consent.accept();
    consent.accept();
    expect(loadScript).toHaveBeenCalledTimes(1);
    expect(loadScript.mock.calls[0][0]).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST123');
  });

  it('keeps ad personalisation and Google signals off even after Accept', () => {
    const { consent, gtag } = setup();
    consent.init();
    consent.accept();
    expect(gtag).toHaveBeenCalledWith('config', 'G-TEST123', { allow_google_signals: false, allow_ad_personalization_signals: false });
    expect(gtag).not.toHaveBeenCalledWith('consent', 'update', expect.objectContaining({ ad_storage: 'granted' }));
  });

  it('never loads Google after Decline, and remembers the choice', () => {
    const { consent, loadScript, store } = setup();
    consent.init();
    consent.decline();
    expect(loadScript).not.toHaveBeenCalled();
    expect(store.get(CONSENT_KEY)).toBe('denied');
  });

  it('does not load Google on a later visit when the choice was Decline', () => {
    const { consent, loadScript } = setup('denied');
    expect(consent.init()).toBe('denied');
    expect(loadScript).not.toHaveBeenCalled();
  });

  it('loads Google on a later visit only when consent was granted before', () => {
    const { consent, loadScript } = setup('granted');
    expect(consent.init()).toBe('granted');
    expect(loadScript).toHaveBeenCalledTimes(1);
  });

  it('revokes consent and clears the analytics cookies when the visitor declines later', () => {
    const { consent, gtag, clearCookies } = setup('granted');
    consent.init();
    consent.decline();
    expect(gtag).toHaveBeenCalledWith('consent', 'update', { analytics_storage: 'denied' });
    expect(clearCookies).toHaveBeenCalledTimes(1);
  });

  it('sends events only while consent is granted', () => {
    const declined = setup('denied');
    declined.consent.init();
    declined.consent.track('cta_click', { cta: 'register' });
    expect(declined.gtag).not.toHaveBeenCalledWith('event', 'cta_click', expect.anything());

    const granted = setup();
    granted.consent.init();
    granted.consent.accept();
    granted.consent.track('cta_click', { cta: 'register' });
    expect(granted.gtag).toHaveBeenCalledWith('event', 'cta_click', { cta: 'register' });
  });

  it('does nothing without a measurement id', () => {
    const loadScript = vi.fn();
    const gtag = vi.fn();
    const consent = createConsent({ storage: null, measurementId: undefined, loadScript, gtag, clearCookies: vi.fn() });
    consent.init();
    consent.accept();
    expect(loadScript).not.toHaveBeenCalled();
    expect(gtag).not.toHaveBeenCalledWith('config', expect.anything(), expect.anything());
  });
});
