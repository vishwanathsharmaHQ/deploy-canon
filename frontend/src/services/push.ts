function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Register the service worker and subscribe to push notifications. */
export async function subscribeToPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported');
    return false;
  }

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Get VAPID public key from server
    const resp = await fetch(`/api/push/vapid-key`);
    const { publicKey } = await resp.json();

    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Subscribe
      const applicationServerKey = urlBase64ToUint8Array(publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // Send subscription to server
    await fetch(`/api/push/subscribe`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });

    return true;
  } catch (err) {
    console.error('Push subscription failed:', err);
    return false;
  }
}

/** Unsubscribe from push notifications. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    await fetch(`/api/push/subscribe`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ endpoint }),
    });
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
}

/** Check if currently subscribed to push. */
export async function isPushSubscribed(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/** Check if push is supported on this device. */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
