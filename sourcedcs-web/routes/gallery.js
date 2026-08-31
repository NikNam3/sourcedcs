'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const store = require('../store');
const auth = require('../auth');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

/* ── Gallery (public read, admin write + image upload) ── */
const MAX_GALLERY_SRC_LEN = 512;
const MAX_GALLERY_TEXT_LEN = 200;
const MAX_GALLERY_ITEMS = 100;

router.get('/gallery', (_req, res) => res.json(store.state.gallery));

router.put('/gallery', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected array' });
  if (req.body.length > MAX_GALLERY_ITEMS) return res.status(400).json({ error: 'Too many gallery items' });
  store.state.gallery = req.body.map(s => ({
    src: store.sanitizeStr(s.src, MAX_GALLERY_SRC_LEN),
    alt: store.sanitizeStr(s.alt, MAX_GALLERY_TEXT_LEN),
    caption: store.sanitizeStr(s.caption, MAX_GALLERY_TEXT_LEN),
  }));
  try { store.saveJSON(store.GALLERY_FILE, store.state.gallery); } catch (err) {
    return res.status(500).json({ error: 'Failed to save gallery: ' + err.message });
  }
  res.json(store.state.gallery);
});

router.post('/gallery/upload', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, store.upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  res.json({ src: '/gallery-uploads/' + req.file.filename });
});

router.delete('/gallery/:idx', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  const gallery = store.state.gallery;
  if (isNaN(idx) || idx < 0 || idx >= gallery.length) {
    return res.status(400).json({ error: 'Invalid index' });
  }
  const [removed] = gallery.splice(idx, 1);
  try { store.saveJSON(store.GALLERY_FILE, gallery); } catch (err) {
    gallery.splice(idx, 0, removed); /* roll back in-memory change */
    return res.status(500).json({ error: 'Failed to save gallery: ' + err.message });
  }
  /* Clean up uploaded file from the volume (ignore public static assets) */
  if (removed.src && removed.src.startsWith('/gallery-uploads/')) {
    const filename = path.basename(removed.src);
    /* Guard against path traversal */
    if (filename && !filename.includes('/') && !filename.includes('..')) {
      const filepath = path.join(store.UPLOADS_DIR, filename);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* ignore */ }
    }
  }
  res.json({ ok: true });
});

/* ── Hero image (public read, admin write + image upload) ── */
const MAX_HERO_SRC_LEN = 512;
const MAX_HERO_TEXT_LEN = 200;

router.get('/hero-image', (_req, res) => res.json(store.state.heroImage));

router.put('/hero-image', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Expected object' });
  }
  store.state.heroImage = {
    src: store.sanitizeStr(req.body.src, MAX_HERO_SRC_LEN),
    alt: store.sanitizeStr(req.body.alt, MAX_HERO_TEXT_LEN),
    caption: store.sanitizeStr(req.body.caption, MAX_HERO_TEXT_LEN),
  };
  try { store.saveJSON(store.HERO_FILE, store.state.heroImage); } catch (err) {
    return res.status(500).json({ error: 'Failed to save hero image: ' + err.message });
  }
  res.json(store.state.heroImage);
});

router.post('/hero-image/upload', writeOpsLimiter, auth.requireAuth, auth.requireAdmin, store.upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  res.json({ src: '/gallery-uploads/' + req.file.filename });
});

module.exports = router;
