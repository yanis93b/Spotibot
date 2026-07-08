'use client';

import { useEffect } from 'react';

/**
 * Registers the SpotiBot service worker (`/sw.js`) when running in the browser.
 *
 * Renders nothing — this is a side-effect-only component. Drop it anywhere in
 * the tree (typically near the root layout) and it will register the SW once on
 * mount. Success and failure are logged to the console only; we never surface
 * registration errors to the user because PWA is a progressive enhancement.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        console.info(
          '[PWA] Service worker registered (scope:',
          registration.scope,
          ')'
        );
      } catch (error) {
        console.error('[PWA] Service worker registration failed:', error);
      }
    };

    // Register after the window has loaded so it never competes with
    // first-paint critical work.
    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}

export default RegisterSW;
