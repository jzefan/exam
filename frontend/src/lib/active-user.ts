/**
 * Per-account UI preferences.
 *
 * Theme color and light/dark mode are stored per logged-in user so a shared (or
 * just reused) browser never leaks one user's customization onto the next. A
 * brand-new or un-customized user therefore always starts on the default (blue)
 * theme — for both the student and teacher ends.
 *
 * Login/logout are SPA navigations (Refine `redirectTo`), not full page reloads,
 * so the theme providers can't rely on remounting to notice the new user. Every
 * auth mutation calls `notifyAuthChanged()`; the providers listen for
 * `AUTH_CHANGED_EVENT` and reload that user's stored preference.
 */
export const AUTH_CHANGED_EVENT = "auth-user-changed";

/** Logged-in user's id, or `"guest"` when nobody is signed in. */
export function getActiveUserId(): string {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string };
      if (parsed?.id) return parsed.id;
    }
  } catch {
    // Malformed payload — treat as a guest.
  }
  return "guest";
}

/** Tell theme providers to reload preferences for the now-current user. */
export function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}
