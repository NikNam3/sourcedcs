'use strict';

const express = require('express');
const store = require('../store');
const auth = require('../auth');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

/* ── Squadrons (public read, admin write) ── */
router.get('/squadrons', (_req, res) => {
  res.json(store.state.squadrons);
});

router.get('/squadrons/:id', (req, res) => {
  const sq = store.state.squadrons.find(s => s.id === req.params.id);
  if (!sq) return res.status(404).json({ error: 'Squadron not found' });
  res.json(sq);
});

router.put('/squadrons/:id', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const squadrons = store.state.squadrons;
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  const allowed = ['designator', 'name', 'airframe', 'tags', 'shortDesc', 'fullDesc', 'image'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) squadrons[idx][key] = req.body[key];
  }
  store.saveJSON(store.SQUADRONS_FILE, squadrons);
  res.json(squadrons[idx]);
});

router.post('/squadrons', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { id, designator, name, airframe, tags, shortDesc, fullDesc, image } = req.body;
  if (!id || !designator || !name) return res.status(400).json({ error: 'id, designator and name are required' });
  const squadrons = store.state.squadrons;
  if (squadrons.find(s => s.id === id)) return res.status(409).json({ error: 'Squadron ID already exists' });
  const sq = {
    id: store.sanitizeStr(id, 16),
    designator: store.sanitizeStr(designator, 16),
    name: store.sanitizeStr(name, 32),
    airframe: store.sanitizeStr(airframe, 64),
    tags: Array.isArray(tags) ? tags.map(t => store.sanitizeStr(t, 16)) : [],
    shortDesc: store.sanitizeStr(shortDesc, 500),
    fullDesc: store.sanitizeStr(fullDesc, 2000),
    image: store.sanitizeStr(image, 256),
  };
  squadrons.push(sq);
  store.saveJSON(store.SQUADRONS_FILE, squadrons);
  res.status(201).json(sq);
});

router.delete('/squadrons/:id', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const squadrons = store.state.squadrons;
  const idx = squadrons.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Squadron not found' });
  squadrons.splice(idx, 1);
  store.saveJSON(store.SQUADRONS_FILE, squadrons);
  res.json({ ok: true });
});

module.exports = router;
