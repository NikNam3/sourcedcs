/**
 * Fits the fixed-width page (1280 px, TOLD 10.1) to a narrower window: sets the CSS custom property `--page-scale`
 * on the page (1 at or above the width, smaller below), on load and on every resize. The page CSS applies it (e.g.
 * `zoom: var(--page-scale, 1)`), and print CSS can ignore it. Touches `window` only when called.
 */
export function fitPage(page: HTMLElement, widthPx = 1280): () => void {
  const apply = (): void => {
    const scale = Math.min(1, window.innerWidth / widthPx);
    page.style.setProperty('--page-scale', String(scale));
  };
  apply();
  window.addEventListener('resize', apply);
  return () => {
    window.removeEventListener('resize', apply);
    page.style.removeProperty('--page-scale');
  };
}
