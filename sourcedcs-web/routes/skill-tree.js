'use strict';

const express = require('express');
const skillsCore = require('../public/js/skills-core.js');
const store = require('../store');
const auth = require('../auth');
const discordClient = require('../discord-client');
const { writeOpsLimiter } = require('../rate-limiters');

const router = express.Router();

/* ── Skill Tree (public read, admin write) ── */
router.get('/skill-tree', (_req, res) => {
  res.json(store.state.skillTree);
});

router.put('/skill-tree', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const tree = req.body;
  const err = skillsCore.validateTree(tree);
  if (err) return res.status(400).json({ error: err });
  store.state.skillTree = tree;
  store.saveJSON(store.SKILL_TREE_FILE, store.state.skillTree);
  res.json(store.state.skillTree);
});

/* ── Skill Grades ── */
router.get('/skill-grades', auth.requireAuth, (req, res) => {
  const sub = req.user.sub;
  const roles = Array.isArray(req.user?.roles) ? req.user.roles : [];
  const isAdm = roles.some(r => auth.SKILL_ADMIN_ROLES.includes(typeof r === 'string' ? r : (r?.name || '')));

  if (isAdm) {
    res.json(store.state.skillGrades);
  } else {
    res.json({ [sub]: store.state.skillGrades[sub] || {} });
  }
});

router.get('/skill-grades/:pilotId', auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  res.json(store.state.skillGrades[req.params.pilotId] || {});
});

const MAX_GRADE_NOTES_LEN = 500;
router.put('/skill-grades/:pilotId/:itemId', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const { pilotId, itemId } = req.params;
  const { grade, notes } = req.body;

  if (!grade || !store.VALID_GRADES.has(grade)) {
    return res.status(400).json({ error: 'grade must be one of U, F, G, E' });
  }

  const graderSub = req.user.sub;
  const graderName = req.user.name || req.user.preferred_username || graderSub || '';

  const skillGrades = store.state.skillGrades;
  if (!skillGrades[pilotId]) skillGrades[pilotId] = {};
  skillGrades[pilotId][itemId] = {
    grade,
    notes: store.sanitizeStr(notes || '', MAX_GRADE_NOTES_LEN),
    graded_at: new Date().toISOString(),
    graded_by: graderName,
  };
  store.saveJSON(store.SKILL_GRADES_FILE, skillGrades);

  /* Auto-remove any open/claimed grading request for this pilot+module, but
     only once EVERY grading item belonging to that module now has a grade —
     a multi-item module (e.g. 3 levels) shouldn't close the request after
     just one item is graded. */
  const index = skillsCore.buildIndex(store.state.skillTree);
  const parentModuleId = index.itemOwner[itemId] || itemId;
  const parentModule = index.modules[parentModuleId];
  const fullyGraded = !parentModule || (parentModule.gradingItems || []).every(
    it => skillGrades[pilotId] && skillGrades[pilotId][it.id]
  );

  const removedReqs = [];
  if (fullyGraded) {
    store.state.gradingRequests = store.state.gradingRequests.filter(r => {
      if (r.pilot_id === pilotId && (r.module_id === parentModuleId || !r.module_id)) {
        removedReqs.push(r);
        return false;
      }
      return true;
    });
  }
  if (removedReqs.length) {
    store.saveJSON(store.GRADING_REQS_FILE, store.state.gradingRequests);
    removedReqs.forEach(r => {
      if (r.discord_message_id && discordClient.DISCORD_BOT_TOKEN && discordClient.GRADING_CHANNEL_ID) {
        discordClient.discordDelete('/channels/' + discordClient.GRADING_CHANNEL_ID + '/messages/' + r.discord_message_id)
          .catch(err => console.error('[grading] Discord message delete failed:', err.message));
      }
    });
  }

  res.json(skillGrades[pilotId][itemId]);
});

router.delete('/skill-grades/:pilotId/:itemId', writeOpsLimiter, auth.requireAuth, auth.requireSkillAdmin, (req, res) => {
  const { pilotId, itemId } = req.params;
  const skillGrades = store.state.skillGrades;
  if (!skillGrades[pilotId] || !skillGrades[pilotId][itemId]) {
    return res.status(404).json({ error: 'Grade not found' });
  }
  delete skillGrades[pilotId][itemId];
  store.saveJSON(store.SKILL_GRADES_FILE, skillGrades);
  res.json({ ok: true });
});

module.exports = router;
