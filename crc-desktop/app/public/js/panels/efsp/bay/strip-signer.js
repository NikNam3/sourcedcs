'use strict';

// The slot for the render signature (a leaf, so it is initialised whichever module a graph is entered from). The signature
// reads strip-view.js's alerts, and strip-view.js imports strip-element.js, so strip-element.js cannot import it: bay-view.js
// registers `_stripRenderSignature` here and strip-element.js stamps `el.dataset.sig` through it.
let _signer = null;
export function setStripSigner(fn) { _signer = fn; }
export function stripSigner() { return _signer; }
