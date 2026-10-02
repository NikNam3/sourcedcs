'use strict';

// The op table (docs/adr/0095): one module per Strip op kind, `{kind, authorize?, apply(ctx, strip, op, meta)}`.
// BoardStore (board-store.js) passes this list to StripOps; an op reaches another only through `ctx.run(kind, ...)`.

const MODULES = [
  require('./create-strip'),
  require('./move-strip'),
  require('./set-block'),
  require('./transfer-strip'),
  require('./set-flag'),
  require('./set-state'),
  require('./invoke-nla'),
  require('./undo'),
  require('./drop-strip'),
  require('./coordination'),
  require('./tofi'),
  require('./convert-to-arrival'),
  require('./approve-airspace-entry'),
  require('./clear-airspace-entry'),
  require('./carrier-handoff'),
  require('./sfa-rotation'),
  require('./split-formation'),
  require('./join-formation'),
];

module.exports = MODULES.flatMap(m => (Array.isArray(m) ? m : [m]));
