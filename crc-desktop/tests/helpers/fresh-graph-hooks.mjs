/* Resolve hook for fresh-graph.mjs (registered by it; not imported by tests).
 * A client module imported as `…/app/public/js/x.js?gen=N` passes `?gen=N` on to every client module it imports, so
 * the whole client graph below it is a new set of module instances. Modules outside app/public/js are shared. */
const CLIENT = '/app/public/js/';

export async function resolve(specifier, context, nextResolve) {
  const r = await nextResolve(specifier, context);
  const parent = context.parentURL || '';
  const m = /[?&]gen=(\d+)/.exec(parent);
  if (m && parent.includes(CLIENT) && r.url.startsWith('file:') && r.url.includes(CLIENT) && !/[?&]gen=/.test(r.url)) {
    return { ...r, url: `${r.url}${r.url.includes('?') ? '&' : '?'}gen=${m[1]}` };
  }
  return r;
}
