/* gallery.js — Flight gallery page logic
   getToken, loginWithCasdoor, isAdminRole, hasAnyRole, getUser, logout, setTheme
   are provided by auth.js
   ─────────────────────────────────────────────────────────────────────────── */

/* ── Apply external links from config ── */
(function() {
  function setLink(id, url) { var el = document.getElementById(id); if (el && url) el.href = url; }
  setLink('footerDiscordLink', typeof DISCORD_URL !== 'undefined' ? DISCORD_URL : null);
  setLink('footerWikiLink',    typeof WIKI_URL    !== 'undefined' ? WIKI_URL    : null);
  setLink('footerGithubLink',  typeof GITHUB_URL  !== 'undefined' ? GITHUB_URL  : null);
})();

/* ── Auth / login button ── */
(function() {
  var token = getToken();
  var user  = getUser();
  if (!token) return;
  var name = (user && user.name) ? user.name.toUpperCase() : 'USER';
  var btn = document.getElementById('loginBtn');
  if (btn) { btn.textContent = name + ' \u23FB'; btn.title = 'Click to log out'; btn.classList.add('login-btn--logout'); btn.onclick = logout; }
})();

/* ── Hamburger menu ── */
(function() {
  var btn = document.getElementById('hamburgerBtn');
  var nav = document.getElementById('mainNav');
  if (!btn || !nav) return;
  btn.addEventListener('click', function() {
    var open = nav.classList.toggle('nav-open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  });
})();

/* ── isAdmin detection ── */
var isAdmin = isAdminRole(getToken());

/* ═══════════════════════════════════════════════════════════
   GALLERY PAGE — cinematic full-screen slideshow
   ═══════════════════════════════════════════════════════════ */
var galleryData = [];
var galSlides   = [];
var galDots     = [];
var galCurrent  = 0;
var galEditMode = false;

/* ── Fetch helper: parses JSON or throws a readable error ── */
function parseJSONResponse(r, defaultMsg) {
  if (!r.ok) {
    return r.json()
      .catch(function() { throw new Error(defaultMsg + ' (HTTP ' + r.status + ')'); })
      .then(function(d) { throw new Error(d.error || defaultMsg); });
  }
  return r.json().catch(function() { throw new Error(defaultMsg); });
}

/* Fisher-Yates shuffle (returns a new array) */
function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

(function initGallery() {
  var prevBtn = document.getElementById('slidePrev');
  var nextBtn = document.getElementById('slideNext');
  var ss      = document.getElementById('gallerySlideshow');
  if (!ss) return;

  fetch('/api/gallery')
    .then(function(r) { return r.json(); })
    .then(function(shots) {
      galBuild(shuffleArray(shots));
      if (isAdmin) document.getElementById('galleryAdminBar').style.display = '';
    })
    .catch(function() {
      var track = document.getElementById('slideshowTrack');
      if (track) track.innerHTML = '<div class="ops-preview-empty" style="padding:80px 24px;text-align:center">Gallery unavailable.</div>';
    });

  if (prevBtn) prevBtn.addEventListener('click', function() { galShow(galCurrent - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function() { galShow(galCurrent + 1); });

  /* Touch/swipe */
  var touchStartX = null;
  ss.addEventListener('touchstart', function(e) { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
  ss.addEventListener('touchend', function(e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { galShow(dx < 0 ? galCurrent + 1 : galCurrent - 1); }
    touchStartX = null;
  }, { passive: true });
})();

function galBuild(shots) {
  if (!Array.isArray(shots)) shots = [];
  var track    = document.getElementById('slideshowTrack');
  var dotsWrap = document.getElementById('slideshowDots');
  var counter  = document.getElementById('galCounter');
  if (!track || !dotsWrap) return;

  galleryData = shots;
  galSlides   = [];
  galDots     = [];
  galCurrent  = 0;
  track.innerHTML    = '';
  dotsWrap.innerHTML = '';

  if (counter) counter.textContent = shots.length + ' SHOT' + (shots.length !== 1 ? 'S' : '');

  if (!shots.length) {
    track.innerHTML = '<div class="ops-preview-empty" style="padding:80px 24px;text-align:center">No gallery photos yet.' +
      (isAdmin ? ' Add one with the button above.' : '') + '</div>';
    return;
  }

  shots.forEach(function(shot, idx) {
    /* Slide */
    var div = document.createElement('div');
    div.className = 'slide' + (idx === 0 ? ' active' : '');
    div.setAttribute('data-index', idx);

    var img = document.createElement('img');
    img.src = shot.src;
    img.alt = shot.alt || '';
    img.className = 'slide-img';
    img.loading = idx === 0 ? 'eager' : 'lazy';

    var cap = document.createElement('div');
    cap.className = 'slide-caption';
    cap.textContent = shot.caption || '';

    div.appendChild(img);
    div.appendChild(cap);

    /* Admin overlay (shown in edit mode) */
    if (isAdmin) {
      var overlay = document.createElement('div');
      overlay.className = 'gallery-admin-overlay' + (galEditMode ? ' visible' : '');
      (function(i) {
        var editBtn = document.createElement('button');
        editBtn.className = 'admin-edit-btn';
        editBtn.textContent = '\u270E CAPTION';
        editBtn.addEventListener('click', function(e) { e.stopPropagation(); openGalEditModal(i); });

        var delBtn = document.createElement('button');
        delBtn.className = 'admin-delete-btn';
        delBtn.textContent = '\u2715 REMOVE';
        delBtn.addEventListener('click', function(e) { e.stopPropagation(); deleteGalleryShot(i); });

        overlay.appendChild(editBtn);
        overlay.appendChild(delBtn);
      })(idx);
      div.appendChild(overlay);
    }

    track.appendChild(div);
    galSlides.push(div);

    /* Dot */
    var dot = document.createElement('button');
    dot.className = 'slideshow-dot' + (idx === 0 ? ' active' : '');
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', 'Slide ' + (idx + 1));
    (function(i) {
      dot.addEventListener('click', function() { galShow(i); });
    })(idx);
    dotsWrap.appendChild(dot);
    galDots.push(dot);
  });

}

function galShow(idx) {
  if (!galSlides.length) return;
  galSlides[galCurrent].classList.remove('active', 'slide-fade-in');
  galDots[galCurrent].classList.remove('active');
  galCurrent = (idx + galSlides.length) % galSlides.length;
  galSlides[galCurrent].classList.add('active', 'slide-fade-in');
  galDots[galCurrent].classList.add('active');
}

/* ── Admin: toggle edit mode ── */
function toggleGalleryEdit() {
  galEditMode = !galEditMode;
  var btn    = document.getElementById('galleryEditBtn');
  var addBtn = document.getElementById('galleryAddBtn');
  btn.textContent = galEditMode ? '\u2612 EXIT EDIT' : '\u270E EDIT GALLERY';
  btn.classList.toggle('active', galEditMode);
  addBtn.style.display = galEditMode ? '' : 'none';
  document.querySelectorAll('.gallery-admin-overlay').forEach(function(el) {
    el.classList.toggle('visible', galEditMode);
  });
}

/* ── Admin: edit caption modal ── */
function openGalEditModal(idx) {
  document.getElementById('galEditIdx').value     = idx;
  document.getElementById('galEditCaption').value = galleryData[idx].caption || '';
  document.getElementById('galEditAlt').value     = galleryData[idx].alt     || '';
  document.getElementById('galEditModalOverlay').style.display = '';
}
function closeGalEditModal() {
  document.getElementById('galEditModalOverlay').style.display = 'none';
}
function submitGalEdit(e) {
  e.preventDefault();
  var idx     = parseInt(document.getElementById('galEditIdx').value, 10);
  var caption = document.getElementById('galEditCaption').value.trim();
  var alt     = document.getElementById('galEditAlt').value.trim();
  var updated = galleryData.map(function(s, i) {
    return i === idx ? { src: s.src, alt: alt, caption: caption } : s;
  });
  fetch('/api/gallery', {
    method:  'PUT',
    headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
    body:    JSON.stringify(updated),
  })
    .then(function(r) { return parseJSONResponse(r, 'Save failed'); })
    .then(function(saved) { closeGalEditModal(); galBuild(saved); })
    .catch(function(err) { alert('Save failed: ' + err.message); });
}
document.getElementById('galEditModalOverlay').addEventListener('click', function(e) { if (e.target === this) closeGalEditModal(); });

/* ── Admin: add photo modal ── */
function openGalAddModal() {
  document.getElementById('galAddForm').reset();
  var btn = document.getElementById('galAddSaveBtn');
  btn.disabled    = false;
  btn.textContent = '\u2295 UPLOAD';
  document.getElementById('galAddModalOverlay').style.display = '';
}
function closeGalAddModal() {
  document.getElementById('galAddModalOverlay').style.display = 'none';
}
function submitGalAdd(e) {
  e.preventDefault();
  var file    = document.getElementById('galAddFile').files[0];
  var caption = document.getElementById('galAddCaption').value.trim();
  var alt     = document.getElementById('galAddAlt').value.trim();
  if (!file) return;

  var saveBtn = document.getElementById('galAddSaveBtn');
  saveBtn.disabled    = true;
  saveBtn.textContent = 'UPLOADING\u2026';

  var fd = new FormData();
  fd.append('image', file);

  fetch('/api/gallery/upload', {
    method:  'POST',
    headers: authHeaders(),
    body:    fd,
  })
    .then(function(r) { return parseJSONResponse(r, 'Upload failed'); })
    .then(function(resp) {
      if (resp.error) throw new Error(resp.error);
      var newEntry = { src: resp.src, alt: alt || file.name, caption: caption };
      return fetch('/api/gallery', {
        method:  'PUT',
        headers: authHeaders(getToken(), { 'Content-Type': 'application/json' }),
        body:    JSON.stringify(galleryData.concat([newEntry])),
      });
    })
    .then(function(r) { return parseJSONResponse(r, 'Gallery save failed'); })
    .then(function(updated) { closeGalAddModal(); galBuild(updated); })
    .catch(function(err) { alert('Upload failed: ' + err.message); })
    .finally(function() {
      saveBtn.disabled    = false;
      saveBtn.textContent = '\u2295 UPLOAD';
    });
}
document.getElementById('galAddModalOverlay').addEventListener('click', function(e) { if (e.target === this) closeGalAddModal(); });

/* ── Admin: delete shot ── */
function deleteGalleryShot(idx) {
  if (!confirm('Remove this photo from the gallery?')) return;
  fetch('/api/gallery/' + idx, {
    method:  'DELETE',
    headers: authHeaders(),
  })
    .then(function(r) { return parseJSONResponse(r, 'Delete failed'); })
    .then(function(resp) {
      if (resp.error) throw new Error(resp.error);
      return fetch('/api/gallery').then(function(r) { return r.json(); });
    })
    .then(function(updated) { galBuild(updated); })
    .catch(function(err) { alert('Delete failed: ' + err.message); });
}
