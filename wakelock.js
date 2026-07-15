// ── SCREEN WAKE LOCK ──────────────────────────────────────────────
// Keeps the screen awake while this device's team has a challenge
// attempt in progress (so a countdown doesn't tick away behind a
// locked screen). Best-effort: silently does nothing where the Wake
// Lock API is unavailable (e.g. older iOS).

let lock   = null;
let wanted = false;

async function acquire() {
  if (lock || !navigator.wakeLock) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch (e) {
    lock = null; // denied (low battery etc.) — not fatal
  }
}

export function setWakeLock(on) {
  wanted = on;
  if (on) acquire();
  else if (lock) {
    lock.release().catch(() => {});
    lock = null;
  }
}

// The lock is auto-released when the tab is backgrounded; re-acquire
// when the player comes back mid-attempt
document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') acquire();
});
