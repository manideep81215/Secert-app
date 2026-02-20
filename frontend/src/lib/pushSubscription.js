/**
 * pushSubscription.js
 *
 * Handles frontend push subscription lifecycle:
 * - Creating/reusing push subscription with VAPID key from backend
 * - Sending subscription to backend
 * - Re-subscribing when SW reports pushsubscriptionchange
 * - Reading IndexedDB telemetry for debug panel
 * - Reset subscription helper
 */

const PUSH_SUBSCRIBE_URL   = '/api/app/push/subscribe';
const PUSH_PUBLIC_KEY_URL  = '/api/app/push/public-key';
const PUSH_UNSUBSCRIBE_URL = '/api/app/push/subscribe'; // DELETE method

// ── Main: Ensure Push Subscription ───────────────────────────────

/**
 * Call this on app load, focus, and online events.
 * Idempotent — safe to call multiple times.
 *
 * @param {string} token — JWT auth token for backend API calls
 * @returns {Promise<boolean>} true if subscription is active
 */
export async function ensurePushSubscription(token) {
  try {
    if (!token) {
      console.warn('[Push] No auth token — skipping subscription');
      return false;
    }

    // FIX 1: Check all prerequisites before attempting subscription
    if (!isSecureContext) {
      console.warn('[Push] Not a secure context (HTTPS required)');
      return false;
    }

    if (!('serviceWorker' in navigator)) {
      console.warn('[Push] Service workers not supported');
      return false;
    }

    if (!('PushManager' in window)) {
      console.warn('[Push] PushManager not supported');
      return false;
    }

    if (!('Notification' in window)) {
      console.warn('[Push] Notifications not supported');
      return false;
    }

    // FIX 2: Check permission FIRST — never call subscribe() without it
    if (Notification.permission !== 'granted') {
      console.warn('[Push] Notification permission not granted:', Notification.permission);
      return false;
    }

    // Get active service worker registration
    const registration = await getActiveRegistration();
    if (!registration) {
      console.warn('[Push] No active service worker registration');
      return false;
    }

    // Check if push is enabled on backend and get VAPID key
    const keyInfo = await fetchVapidPublicKey(token);
    if (!keyInfo.enabled || !keyInfo.publicKey) {
      console.warn('[Push] Backend push not enabled or no public key');
      return false;
    }

    const applicationServerKey = urlBase64ToUint8Array(keyInfo.publicKey);

    // FIX 3: Get existing subscription or create new one
    let subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Verify the subscription uses the same VAPID key
      // If keys changed (e.g. after server restart with runtime keys), re-subscribe
      const subKey = subscription.options?.applicationServerKey;
      const newKey = applicationServerKey;

      if (subKey && !uint8ArraysEqual(new Uint8Array(subKey), newKey)) {
        console.warn('[Push] VAPID key mismatch — re-subscribing');
        await subscription.unsubscribe();
        subscription = null;
      }
    }

    if (!subscription) {
      console.log('[Push] Creating new push subscription...');
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,           // REQUIRED — must be true for Chrome
        applicationServerKey,
      });
      console.log('[Push] New subscription created');
    } else {
      console.log('[Push] Reusing existing subscription');
    }

    // FIX 4: Always sync subscription to backend on each call
    // This ensures backend has the latest subscription even after rotation
    await sendSubscriptionToBackend(subscription, token);

    return true;

  } catch (err) {
    // FIX 5: Specific error handling — don't let one failure break the whole app
    if (err.name === 'NotAllowedError') {
      console.warn('[Push] Permission denied by user');
    } else if (err.name === 'AbortError') {
      console.warn('[Push] Subscription aborted — push service may be unavailable');
    } else if (err.name === 'InvalidStateError') {
      console.warn('[Push] Invalid state — service worker may not be ready');
    } else {
      console.error('[Push] ensurePushSubscription error:', err);
    }
    return false;
  }
}

// ── Request Notification Permission ──────────────────────────────

/**
 * Request notification permission from the user.
 * Call this in response to a user gesture (button click).
 * Browsers block this if called without user interaction.
 *
 * @returns {Promise<NotificationPermission>} 'granted' | 'denied' | 'default'
 */
export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') {
    console.warn('[Push] Notification permission previously denied — user must reset in browser settings');
    return 'denied';
  }

  try {
    const result = await Notification.requestPermission();
    console.log('[Push] Permission result:', result);
    return result;
  } catch (err) {
    console.error('[Push] requestPermission error:', err);
    return 'default';
  }
}

// ── Reset Subscription (force re-subscribe) ───────────────────────

/**
 * FIX 6: Reset push subscription.
 * Unsubscribes from browser PushManager + notifies backend to delete,
 * then creates a fresh subscription.
 *
 * Use this when:
 * - "Send Test" works but no notification appears
 * - Debug panel shows "Subscription: Yes" but push never arrives
 * - After changing VAPID keys on the server
 *
 * @param {string} token — JWT auth token
 * @returns {Promise<boolean>} true if reset succeeded
 */
export async function resetPushSubscription(token) {
  try {
    console.log('[Push] Resetting push subscription...');

    const registration = await getActiveRegistration();
    if (!registration) return false;

    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Remove from backend first
      await fetch(PUSH_UNSUBSCRIBE_URL, {
        method:  'DELETE',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      // Unsubscribe from browser
      await subscription.unsubscribe();
      console.log('[Push] Old subscription removed');
    }

    // Wait a moment then re-subscribe
    await sleep(500);
    const result = await ensurePushSubscription(token);
    console.log('[Push] Re-subscription result:', result);
    return result;

  } catch (err) {
    console.error('[Push] resetPushSubscription error:', err);
    return false;
  }
}

// ── Listen for SW Messages ────────────────────────────────────────

/**
 * FIX 7: Listen for messages from sw.js.
 * The SW sends PUSH_SUBSCRIPTION_CHANGED when the subscription expires.
 * We re-subscribe when this happens.
 *
 * Call this once on app startup.
 *
 * @param {string|function} tokenOrGetter — JWT token or function that returns it
 */
export function listenForSwMessages(tokenOrGetter) {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    if (!event.data) return;
    const { type } = event.data;

    console.log('[Push] SW message received:', type);

    switch (type) {
      case 'PUSH_RECEIVED': {
        // SW received a push — show in-app notification if app is foreground
        // You can dispatch a custom event here for your React app to handle
        window.dispatchEvent(new CustomEvent('push-notification-received', {
          detail: event.data,
        }));
        break;
      }

      case 'PUSH_SUBSCRIPTION_CHANGED': {
        // Subscription expired — re-subscribe
        console.log('[Push] Subscription changed — re-subscribing...');
        const token = typeof tokenOrGetter === 'function'
          ? tokenOrGetter()
          : tokenOrGetter;
        if (token) {
          await ensurePushSubscription(token);
        }
        break;
      }

      case 'PONG': {
        console.log('[Push] SW pong received, version:', event.data.version);
        break;
      }
    }
  });
}

// ── Debug Info for Debug Panel ─────────────────────────────────────

/**
 * Get current push debug state for the debug panel.
 * Reads from browser APIs + IndexedDB telemetry.
 *
 * @param {string} token
 * @returns {Promise<PushDebugInfo>}
 */
export async function getPushDebugInfo(token) {
  const info = {
    permission:       Notification.permission,           // 'granted' | 'denied' | 'default'
    swActive:         false,
    subscription:     false,
    subscriptionEndpoint: null,
    pushEnabled:      false,
    pushKey:          false,
    lastPushReceived: null,                              // from IndexedDB telemetry
    lastSync:         new Date().toISOString(),
    error:            null,
  };

  try {
    const reg = await getActiveRegistration();
    info.swActive = !!reg;

    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      info.subscription = !!sub;
      if (sub) {
        info.subscriptionEndpoint = sub.endpoint.substring(0, 50) + '...';
      }
    }

    if (token) {
      const keyInfo = await fetchVapidPublicKey(token);
      info.pushEnabled = keyInfo.enabled;
      info.pushKey     = !!keyInfo.publicKey;
    }

    // FIX 8: Read last push received time from IndexedDB (written by SW)
    info.lastPushReceived = await readTelemetry('lastPushReceived');

  } catch (err) {
    info.error = err.message;
  }

  return info;
}

// ── Local / Foreground Notification ──────────────────────────────

/**
 * Show a local browser notification (foreground fallback).
 * This is NOT a server push — it only works when the app is open.
 *
 * @param {string} title
 * @param {string} body
 * @param {string} url — route to navigate to on click
 */
export async function pushNotify(title, body, url = '/') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const reg = await getActiveRegistration();
    if (reg) {
      // Use service worker notification — more reliable, supports requireInteraction
      await reg.showNotification(title, {
        body,
        icon:               '/icons/icon-192x192.png',
        badge:              '/icons/badge-72x72.png',
        tag:                'chat-local',
        requireInteraction: false,               // false for foreground — don't be annoying
        data:               { url },
      });
    } else {
      // Fallback to basic Notification API
      new Notification(title, { body, icon: '/icons/icon-192x192.png' });
    }
  } catch (err) {
    console.warn('[Push] pushNotify error:', err);
  }
}

// ── Private Helpers ───────────────────────────────────────────────

async function getActiveRegistration() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    // Find the registration that controls the current page
    const active = registrations.find(r => r.active);
    return active || (registrations.length > 0 ? registrations[0] : null);
  } catch {
    return null;
  }
}

async function fetchVapidPublicKey(token) {
  try {
    const res = await fetch(PUSH_PUBLIC_KEY_URL, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { enabled: false, publicKey: null };
    const data = await res.json();
    return {
      enabled:   data.enabled   ?? false,
      publicKey: data.publicKey ?? data.key ?? null,
    };
  } catch {
    return { enabled: false, publicKey: null };
  }
}

async function sendSubscriptionToBackend(subscription, token) {
  const key  = subscription.getKey('p256dh');
  const auth = subscription.getKey('auth');

  const body = {
    endpoint: subscription.endpoint,
    p256dh:   key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
    auth:     auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
  };

  const res = await fetch(PUSH_SUBSCRIBE_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Backend subscription save failed: ${res.status}`);
  }

  console.log('[Push] Subscription synced to backend');
}

/**
 * Convert VAPID public key from URL-safe base64 to Uint8Array.
 * Required by PushManager.subscribe({ applicationServerKey }).
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

function uint8ArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── IndexedDB Telemetry Reader ────────────────────────────────────
// The SW writes to IndexedDB (it can't use localStorage).
// The app reads from IndexedDB here to show in the debug panel.

async function readTelemetry(key) {
  try {
    const db    = await openTelemetryDb();
    const tx    = db.transaction('telemetry', 'readonly');
    const store = tx.objectStore('telemetry');
    const result = await idbGet(store, key);
    return result ? result.value : null;
  } catch {
    return null;
  }
}

function openTelemetryDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sw-telemetry', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('telemetry', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbGet(store, key) {
  return new Promise((resolve, reject) => {
    const req     = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}