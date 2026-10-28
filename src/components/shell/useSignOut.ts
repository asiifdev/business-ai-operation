import { useState } from 'react';

/** Signs the person out and returns to the sign-in page, even if the request fails. */
export function useSignOut() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin' });
    } finally {
      window.location.assign('/login');
    }
  }
  return { signOut, busy };
}
