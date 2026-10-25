// Cross-component navigation on the one page, through the URL and window
// events, so components don't import each other.

/**
 * Shows the home screen's E-posta tab, from a notification or an email push
 * (/?tab=email). The URL carries it in case the home screen isn't mounted yet.
 */
export function openEmailTab() {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "email");
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event("ledger:open-email"));
}
