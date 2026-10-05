/**
 * A custom Umami event, when Umami is loaded (`Analytics`); otherwise a
 * no-op. Properties are counts and choices only — never a username, a key or
 * anything the visitor typed.
 */

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
  }
}

export function track(event: string, data?: Record<string, string | number | boolean>): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // Blocked or broken analytics must never touch the app.
  }
}
