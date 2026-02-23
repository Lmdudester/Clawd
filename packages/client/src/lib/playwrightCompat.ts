/**
 * Playwright MCP compatibility bridge for React 19.
 *
 * React 19 attaches event delegation to the React root element, not `document`.
 * Playwright MCP's `browser_click` dispatches native click events that may not
 * trigger React's synthetic event handlers. This bridge listens for click events
 * in the capture phase and directly invokes React's onClick handlers via the
 * internal `__reactProps$` fiber properties on DOM elements.
 */
export function installPlaywrightCompat() {
  document.addEventListener('click', (e) => {
    // Only intercept programmatic clicks (isTrusted=false) from Playwright's
    // dispatchEvent. Real user clicks and CDP-simulated input (isTrusted=true)
    // are already handled by React's own event delegation.
    if (e.isTrusted) return;

    let el = e.target as HTMLElement | null;
    while (el) {
      const reactPropsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (reactPropsKey) {
        const props = (el as any)[reactPropsKey];
        if (props?.onClick) {
          props.onClick(e);
          break;
        }
      }
      el = el.parentElement;
    }
  }, true); // capture phase

  // Also handle form submissions — Playwright's click on submit buttons
  // may not trigger React's onSubmit handler on the parent form.
  document.addEventListener('submit', (e) => {
    if (e.isTrusted) return;
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    const reactPropsKey = Object.keys(form).find(k => k.startsWith('__reactProps$'));
    if (reactPropsKey) {
      const props = (form as any)[reactPropsKey];
      if (props?.onSubmit) {
        props.onSubmit(e);
      }
    }
  }, true);
}
