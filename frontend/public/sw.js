/* ============================================================
   sw.js  —  Service Worker for Push Notifications
   
   KEY FIXES for background / locked-screen delivery:
   1. event.waitUntil() wraps ALL async work so SW stays alive
   2. showNotification() uses correct options for Android + iOS
   3. requireInteraction keeps notification visible until tapped
   4. notificationclick deep-links to the correct chat route
   5. pushsubscriptionchange re-syncs subscription with backend
   6. Telemetry stored in localStorage for debug panel
   ============================================================ */

const SW_VERSION = 'v3-bg-fix';
const APP_ORIGIN = self.location.origin;

// ── Install & Activate ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', SW_VERSION);
  // Take over immediately — don't wait for old SW to finish
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    // Claim all clients immediately so push works right after update
    self.clients.claim()
  );
});

// ── Push Event ────────────────────────────────────────────────────
// FIX 1: event.waitUntil() is MANDATORY.
// Without it the SW is killed before showNotification() completes,
// which is the #1 cause of "works foreground, fails background".
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  event.waitUntil(
    handlePush(event)
  );
});

async function handlePush(event) {
  try {
    // Parse payload sent from PushNotificationService.java
    let data = {};
    if (event.data) {
      try {
        data = event.data.json();
      } catch {
        // Fallback if payload is plain text
        data = { title: 'New Message', body: event.data.text() || '', url: '/' };
      }
    }

    const title   = data.title || 'New Message';
    const body    = data.body  || 'You have a new message';
    const url     = data.url   || '/';
    const timestamp = data.timestamp || Date.now();

    // FIX 2: Notification options tuned for Android + iOS background delivery.
    //
    // requireInteraction: true  → notification stays on screen until tapped
    //                             (Android Chrome, desktop Chrome)
    //                             iOS ignores this but it doesn't hurt.
    //
    // icon + badge             → required for Android to show image in status bar
    //                             badge is the small monochrome icon in notification bar
    //
    // vibrate                  → Android haptic pattern
    //
    // tag                      → deduplicates notifications from same sender.
    //                             Change tag per-conversation if you want separate notifs.
    //
    // renotify: true           → re-vibrates even if tag already exists (new message)
    //
    // silent: false            → explicitly allow sound (some Android ROMs default silent)
    //
    // data: { url }            → passed through to notificationclick handler
    const notificationOptions = {
      body,
      icon:               '/icons/icon-192x192.png',  // adjust to your actual icon path
      badge:              '/icons/badge-72x72.png',    // monochrome, shown in Android status bar
      image:              undefined,                   // optional large image
      tag:                'chat-message',              // change to sender ID for per-chat notifs
      renotify:           true,                        // re-alert even if tag matches
      requireInteraction: true,                        // stays on screen — critical for iOS/Android
      silent:             false,                       // allow sound & vibration
      vibrate:            [200, 100, 200],             // haptic pattern: buzz-pause-buzz
      timestamp,
      data: {
        url,                                           // used by notificationclick to navigate
        timestamp,
      },
      // actions — optional quick-reply buttons (Android only)
      // actions: [
      //   { action: 'open', title: '💬 Open Chat' },
      //   { action: 'dismiss', title: 'Dismiss' },
      // ],
    };

    // FIX 3: Store telemetry for debug panel
    // The app reads this from localStorage to show "Last Push Received"
    await storeTelemetry(timestamp);

    // FIX 4: Notify any open app windows so they can update UI in foreground
    await notifyClients({ type: 'PUSH_RECEIVED', title, body, url, timestamp });

    // FIX 5: Show the notification — this is what actually appears on screen
    await self.registration.showNotification(title, notificationOptions);

    console.log('[SW] Notification shown:', title);

  } catch (err) {
    console.error('[SW] handlePush error:', err);

    // Fallback notification so the user still gets SOMETHING if parsing failed
    await self.registration.showNotification('New Message', {
      body:               'You have a new message. Tap to open.',
      icon:               '/icons/icon-192x192.png',
      badge:              '/icons/badge-72x72.png',
      requireInteraction: true,
      tag:                'chat-fallback',
      data:               { url: '/' },
    });
  }
}

// ── Notification Click ────────────────────────────────────────────
// FIX 6: Deep-link to correct chat route when notification is tapped.
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked, action:', event.action);

  event.notification.close();

  // Handle action buttons if you add them later
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  const fullUrl = targetUrl.startsWith('http')
    ? targetUrl
    : APP_ORIGIN + targetUrl;

  event.waitUntil(
    openOrFocusClient(fullUrl)
  );
});

async function openOrFocusClient(url) {
  try {
    // FIX 7: Check if app is already open — focus it instead of opening new tab
    const allClients = await self.clients.matchAll({
      type:           'window',
      includeUncontrolled: true,
    });

    // Try to find an existing window with this app
    for (const client of allClients) {
      if (client.url.startsWith(APP_ORIGIN)) {
        // App is open — navigate it to the target URL and focus
        await client.navigate(url);
        await client.focus();
        return;
      }
    }

    // App is not open — open a new window
    await self.clients.openWindow(url);

  } catch (err) {
    console.error('[SW] openOrFocusClient error:', err);
    // Last resort
    await self.clients.openWindow(url);
  }
}

// ── Notification Close ────────────────────────────────────────────
self.addEventListener('notificationclose', (event) => {
  // Optional: track dismissals for analytics
  console.log('[SW] Notification dismissed');
});

// ── Push Subscription Change ──────────────────────────────────────
// FIX 8: Handle subscription expiry/rotation.
// Browsers periodically rotate push subscriptions.
// Without this handler, the old (invalid) subscription stays in the backend
// and ALL future pushes silently fail until user re-installs the PWA.
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('[SW] Push subscription changed — re-subscribing...');

  event.waitUntil(
    handleSubscriptionChange(event)
  );
});

async function handleSubscriptionChange(event) {
  try {
    // Get the VAPID public key from the old subscription's server
    // We need it to create the new subscription
    const registration = self.registration;

    // Get the application server key from the old subscription if available
    let applicationServerKey = null;
    if (event.oldSubscription && event.oldSubscription.options) {
      applicationServerKey = event.oldSubscription.options.applicationServerKey;
    }

    // Unsubscribe old (already expired, but clean up)
    if (event.oldSubscription) {
      try {
        await event.oldSubscription.unsubscribe();
      } catch { /* ignore */ }
    }

    // FIX 9: Notify the app window to re-subscribe with fresh key from backend.
    // The app (pushSubscription.js) handles the actual re-subscription.
    // We do this because the SW doesn't have access to the auth token.
    await notifyClients({
      type:    'PUSH_SUBSCRIPTION_CHANGED',
      message: 'Push subscription expired. Re-subscribing...',
    });

    console.log('[SW] Notified app of subscription change');

  } catch (err) {
    console.error('[SW] handleSubscriptionChange error:', err);
  }
}

// ── Message Handler (from app window) ────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data) return;
  const { type } = event.data;
  console.log('[SW] Message from app:', type);

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'PING':
      event.source?.postMessage({ type: 'PONG', version: SW_VERSION });
      break;
  }
});

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Broadcast a message to all open app windows.
 * Used to notify the React app of push events.
 */
async function notifyClients(data) {
  try {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of allClients) {
      client.postMessage(data);
    }
  } catch (err) {
    console.warn('[SW] notifyClients error:', err);
  }
}

/**
 * Store push telemetry in IndexedDB (since SW can't access localStorage).
 * The app reads this via IndexedDB to show "Last Push Received" in debug panel.
 *
 * NOTE: If your app already uses IndexedDB, integrate with that store.
 * This creates a simple dedicated "sw-telemetry" DB.
 */
async function storeTelemetry(timestamp) {
  try {
    const db = await openTelemetryDb();
    const tx = db.transaction('telemetry', 'readwrite');
    tx.objectStore('telemetry').put({ key: 'lastPushReceived', value: timestamp });
    await txComplete(tx);
  } catch (err) {
    // Non-critical — don't let telemetry failure break push delivery
    console.warn('[SW] storeTelemetry error:', err);
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

function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}