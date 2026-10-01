/* A fresh instance of the client module graph per test (ESM-1, S-ESM1b).
 *
 * ES modules are singletons: a second `import` of efsp-state.js returns the same Maps. The old vm loaders built a
 * new sandbox per test; this is the module equivalent. Each freshGraph() is a new generation: every client module
 * imported through it (and every client module those import) is a new instance, shared within the generation:
 *
 *     import './helpers/client-env.mjs';
 *     import { freshGraph } from './helpers/fresh-graph.mjs';
 *     const g = freshGraph();
 *     const state = await g.import('panels/efsp/efsp-state.js');   // path relative to app/public/js
 *     const view  = await g.import('panels/efsp/bay-view.js');     // sees the same efsp-state.js instance
 *
 * Globals (client-env.mjs) are not per generation: reset what a test changes. Old generations stay in memory until
 * the test process ends, which is fine for a test file.
 */

import { register } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

register('./fresh-graph-hooks.mjs', import.meta.url);

export const CLIENT_JS = path.join(import.meta.dirname, '../../app/public/js');
let generation = 0;

export function freshGraph() {
  const gen = ++generation;
  return {
    gen,
    /** Imports a client module (path relative to app/public/js, or absolute) in this generation. */
    import(file) {
      const abs = path.isAbsolute(file) ? file : path.join(CLIENT_JS, file);
      return import(`${pathToFileURL(abs).href}?gen=${gen}`);
    },
  };
}
