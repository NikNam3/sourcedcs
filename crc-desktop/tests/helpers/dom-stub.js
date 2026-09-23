'use strict';

/* The DOM stub the client tests render the real panel against.
 *
 * Lifted here because there were already two hand-maintained copies —
 * efsp-ui-reachability.test.js's and efsp-stereo-panel.test.js's — and the
 * briefing's own rule is that two is the point at which lifting it out is
 * worth doing and the third should not be written. This is that lift.
 *
 * Deliberately NOT a DOM implementation. It is the smallest surface
 * bay-view.js and efsp-panel.js actually touch, which is what keeps these
 * tests honest about being wiring tests: they prove the right op is
 * dispatched, never that anything is laid out or visible.
 *
 * Two behaviours worth knowing before asserting against it:
 *  - `removeChild` drops the node from its parent's `children` but leaves
 *    `parentNode` set, unlike a real DOM. Test attachment by membership in
 *    `descendants(root)`, not by `node.parentNode`.
 *  - a `<select>` reports its first appended `<option>`'s value until one is
 *    chosen, mirroring a real one; without that every picker reads as empty.
 */

function makeElement(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', title: '', value: '', disabled: false, hidden: false,
    children: [], dataset: {}, style: {}, _listeners: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); }, toggle() {},
    },
    appendChild(c) {
      this.children.push(c); c.parentNode = this;
      if (this.tagName === 'select' && c.tagName === 'option' && this.value === '') this.value = c.value;
      return c;
    },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceWith(next) {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.map(x => (x === this ? next : x));
        next.parentNode = this.parentNode;
      }
    },
    closest() { return null; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener() {},
    contains(other) { return this === other || this.children.some(c => c.contains && c.contains(other)); },
    querySelector(sel) {
      // Enough for `.class` lookups, which is all the panel uses — notably
      // _isProtectedStripEl's `.efsp-block-input` check, which silently could
      // not fire while this returned null and so was untestable.
      if (typeof sel !== 'string' || !sel.startsWith('.')) return null;
      const want = sel.slice(1);
      const hit = (n) => (n.className || '').split(/\s+/).includes(want)
        ? n : n.children.reduce((found, c) => found || hit(c), null);
      return this.children.reduce((found, c) => found || hit(c), null);
    },
    getBoundingClientRect() { return { top: 0, bottom: 10, left: 0, right: 10, height: 10, width: 10 }; },
    focus() {}, select() {}, setAttribute() {}, removeAttribute() {},
    set innerHTML(v) { if (v === '') this.children = []; },
    get innerHTML() { return ''; },
  };
  return el;
}

/** Every descendant, flattened — a rendered Strip or toolbar is a small tree. */
function descendants(el) {
  return el.children.flatMap(c => [c, ...descendants(c)]);
}

module.exports = { makeElement, descendants };
