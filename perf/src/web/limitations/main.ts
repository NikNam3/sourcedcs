/**
 * The Limitations page (TOLD 1.8): static notes in limitations.html; this fills the app version, the dataset and
 * its data version from the manifest (a load failure leaves "unknown"), keeps the TOLD page's hash on the link back,
 * and fits the page to the window.
 */
import { loadData } from '../load.ts';
import { fitPage } from '../scale.ts';
import { APP_VERSION } from '../version.ts';

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el !== null) el.textContent = text;
}

function keepHash(): void {
  const back = document.getElementById('back-link');
  if (back instanceof HTMLAnchorElement) back.href = `./${window.location.hash}`;
}

async function main(): Promise<void> {
  const page = document.getElementById('page');
  if (page !== null) fitPage(page);
  setText('app-version', APP_VERSION);
  keepHash();
  window.addEventListener('hashchange', keepHash);
  try {
    const { manifest } = await loadData();
    setText('dataset', manifest.dataset);
    setText('data-version', String(manifest.dataVersion));
  } catch {
    // The data did not load: the version stays "unknown".
  }
}

void main();
