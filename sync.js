/* ========================================
   Cloud Sync + Accounts (Firebase Auth + Firestore)

   Local-first design: localStorage stays the source of truth
   for the UI. This layer mirrors the progress keys to a
   Firestore doc (users/{uid}/apps/{appId}) and merges remote
   changes back in, in realtime, so progress follows the
   account across phone / laptop without reloads.

   Merges are union/max based (never destructive), so two
   devices editing offline converge without losing progress,
   and a first sign-in folds existing on-device progress into
   the account instead of overwriting it.

   This file is identical in every sadhana app. Everything
   app-specific - the localStorage key names and how each one
   merges - lives in firebase-config.js.

   Loaded as a classic script; the Firebase SDK is pulled in
   via dynamic import so an offline or blocked network can
   never break the core app - sync just stays dormant.
   ======================================== */

(function () {
  'use strict';

  var CFG = window.SADHANA_SYNC_CONFIG;
  var SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';
  var UPLOAD_DEBOUNCE_MS = 800;

  var FIELDS = (CFG && CFG.fields) || [];
  var SYNC_KEYS = FIELDS.map(function (f) { return f.key; });
  var DEVICE_KEY = (CFG && CFG.deviceKey) || 'sync_device_id';
  var EV_LOCAL = 'sync:local-change';
  var EV_REMOTE = 'sync:remote-applied';

  var fb = null; // loaded firebase modules { auth fns, firestore fns }
  var auth = null;
  var db = null;
  var user = null;
  var unsubscribe = null;
  var uploadTimer = null;
  var firstSnapshot = true;
  var lastSyncedAt = null;
  var syncStatus = 'idle'; // idle | syncing | synced | offline | error
  var emailMode = 'signin'; // signin | create

  // ---- Device id (distinguishes this browser in echo detection) ----
  function getDeviceId() {
    var id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
    if (!id) {
      id = 'd-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(DEVICE_KEY, id); } catch (e) { /* ignore */ }
    }
    return id;
  }
  var deviceId = getDeviceId();

  /* ========================================
     Field types

     Each entry knows how to produce an empty value, coerce
     whatever it finds (localStorage or Firestore) into a sane
     shape, and merge two of them. Every merge is commutative
     and idempotent, so any pair of devices converges on the
     same result no matter which order they sync in.
     ======================================== */

  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }

  var TYPES = {
    // Set of ids the user has completed / learned. Union only.
    idset: {
      empty: function () { return []; },
      coerce: function (v) {
        if (!Array.isArray(v)) return [];
        return v.filter(function (n) { return typeof n === 'number' || typeof n === 'string'; });
      },
      merge: function (a, b) {
        var out = [];
        var seen = Object.create(null);
        a.concat(b).forEach(function (n) {
          var k = typeof n + ':' + n;
          if (!seen[k]) { seen[k] = true; out.push(n); }
        });
        out.sort(function (x, y) {
          if (typeof x === 'number' && typeof y === 'number') return x - y;
          return String(x).localeCompare(String(y));
        });
        return out;
      },
    },

    // Spaced-repetition schedule, keyed by name id.
    // Keep whichever card is further along.
    srs: {
      empty: function () { return {}; },
      coerce: function (v) { return isObj(v) ? v : {}; },
      merge: function (a, b) {
        var out = {};
        Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
          if (out[k] !== undefined) return;
          var x = a[k];
          var y = b[k];
          if (!x) { out[k] = y; return; }
          if (!y) { out[k] = x; return; }
          var nx = x.nextReview || '';
          var ny = y.nextReview || '';
          if (nx > ny) out[k] = x;
          else if (ny > nx) out[k] = y;
          else out[k] = ((x.repetitions || 0) >= (y.repetitions || 0)) ? x : y;
        });
        return out;
      },
    },

    // Free-text notes keyed by name id. Longer text wins a conflict,
    // on the assumption that a note grows as it is worked on.
    notes: {
      empty: function () { return {}; },
      coerce: function (v) { return isObj(v) ? v : {}; },
      merge: function (a, b) {
        var out = {};
        Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
          if (out[k] !== undefined) return;
          var x = String(a[k] || '');
          var y = String(b[k] || '');
          var winner = x.length >= y.length ? x : y;
          if (winner) out[k] = winner;
        });
        return out;
      },
    },

    // Recitation log: { total, log: [{date, count}] }. Per-date max,
    // and the running total can never go backwards.
    sadhana: {
      empty: function () { return { total: 0, log: [] }; },
      coerce: function (v) {
        if (!isObj(v)) return { total: 0, log: [] };
        var total = typeof v.total === 'number' ? v.total : 0;
        var log = Array.isArray(v.log) ? v.log.filter(function (e) {
          return e && typeof e.date === 'string';
        }).map(function (e) {
          return { date: e.date, count: typeof e.count === 'number' ? e.count : 0 };
        }) : [];
        return { total: total, log: log };
      },
      merge: function (a, b) {
        var byDate = Object.create(null);
        a.log.concat(b.log).forEach(function (e) {
          if (byDate[e.date] === undefined || byDate[e.date] < e.count) byDate[e.date] = e.count;
        });
        var log = Object.keys(byDate).sort().map(function (date) {
          return { date: date, count: byDate[date] };
        });
        var logSum = log.reduce(function (s, e) { return s + e.count; }, 0);
        return { total: Math.max(a.total, b.total, logSum), log: log };
      },
    },

    // "Where I was up to" bookmark. Not progress, so the newest
    // writer wins rather than the highest number - jumping back to
    // re-chant an earlier verse has to survive the round trip.
    bookmark: {
      empty: function () { return 1; },
      coerce: function (v) {
        var n = typeof v === 'number' ? v : parseInt(v, 10);
        return (isFinite(n) && n >= 1) ? n : 1;
      },
      merge: function (a, b) { return b || a || 1; },
      raw: true, // stored in localStorage as a bare number, not JSON
    },

    // Bala japa timer: { date, secs: [s, s, s] } for one day.
    // Same day -> per-segment max. Different day -> the later date.
    // `running` / `since` are deliberately not synced; a timer is
    // running on a device, not on an account.
    japa: {
      empty: function () { return { date: '', secs: [0, 0, 0] }; },
      coerce: function (v) {
        if (!isObj(v)) return { date: '', secs: [0, 0, 0] };
        var secs = Array.isArray(v.secs) ? v.secs : [];
        return {
          date: typeof v.date === 'string' ? v.date : '',
          secs: [0, 1, 2].map(function (i) {
            return typeof secs[i] === 'number' && secs[i] > 0 ? Math.floor(secs[i]) : 0;
          }),
        };
      },
      merge: function (a, b) {
        if (!a.date) return b;
        if (!b.date) return a;
        if (a.date !== b.date) return dayNum(a.date) >= dayNum(b.date) ? a : b;
        return {
          date: a.date,
          secs: [0, 1, 2].map(function (i) { return Math.max(a.secs[i], b.secs[i]); }),
        };
      },
    },
  };

  // Bala stores dates as "2026-8-22" (unpadded), so plain string
  // comparison would order 2026-8-9 after 2026-8-22.
  function dayNum(s) {
    var p = String(s).split('-').map(function (n) { return parseInt(n, 10) || 0; });
    return (p[0] || 0) * 10000 + (p[1] || 0) * 100 + (p[2] || 0);
  }

  function typeOf(field) { return TYPES[field.merge] || TYPES.idset; }

  // ---- Local data access ----
  function readLocal() {
    var out = {};
    FIELDS.forEach(function (f) {
      var t = typeOf(f);
      var raw = null;
      try { raw = localStorage.getItem(f.key); } catch (e) { /* ignore */ }
      var val;
      if (raw === null || raw === undefined) {
        val = t.empty();
      } else if (t.raw) {
        val = t.coerce(raw);
      } else {
        try { val = t.coerce(JSON.parse(raw)); } catch (e) { val = t.empty(); }
      }
      out[f.name] = val;
    });
    return out;
  }

  function writeLocal(data) {
    FIELDS.forEach(function (f) {
      var t = typeOf(f);
      var val = data[f.name];
      if (val === undefined) return;
      // Some fields carry device-local sub-keys the cloud never sees (a
      // running stopwatch, say). Carry those through a remote merge instead
      // of dropping them, or a sync would quietly stop a live timer.
      if (f.preserve && f.preserve.length && !t.raw && isObj(val)) {
        var prev = null;
        try { prev = JSON.parse(localStorage.getItem(f.key)); } catch (e) { /* ignore */ }
        if (isObj(prev)) {
          val = Object.assign({}, val);
          f.preserve.forEach(function (k) {
            if (prev[k] !== undefined) val[k] = prev[k];
          });
        }
      }
      try {
        localStorage.setItem(f.key, t.raw ? String(val) : JSON.stringify(val));
      } catch (e) { /* ignore */ }
    });
  }

  function fromDoc(d) {
    var out = {};
    FIELDS.forEach(function (f) {
      out[f.name] = typeOf(f).coerce(d ? d[f.name] : undefined);
    });
    return out;
  }

  function mergeData(local, remote) {
    var out = {};
    FIELDS.forEach(function (f) {
      out[f.name] = typeOf(f).merge(local[f.name], remote[f.name]);
    });
    return out;
  }

  function stableStringify(x) {
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    if (Array.isArray(x)) return '[' + x.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(x).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(x[k]);
    }).join(',') + '}';
  }

  function sameData(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  // ---- Sync engine ----
  function userDocRef() {
    return fb.doc(db, 'users', user.uid, 'apps', CFG.appId);
  }

  function setStatus(s) {
    syncStatus = s;
    renderStatus();
  }

  function markSynced() {
    lastSyncedAt = new Date();
    setStatus('synced');
  }

  function scheduleUpload() {
    if (!user || !db) return;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(upload, UPLOAD_DEBOUNCE_MS);
  }

  function upload() {
    if (!user || !db) return;
    var data = readLocal();
    var payload = {
      email: user.email || null,
      device: deviceId,
      updatedAt: fb.serverTimestamp(),
      v: 1,
    };
    FIELDS.forEach(function (f) { payload[f.name] = data[f.name]; });
    setStatus('syncing');
    // With offline persistence the write is queued locally and the
    // promise resolves only on server ack - so no await, track async.
    fb.setDoc(userDocRef(), payload).then(function () {
      markSynced();
    }).catch(function (err) {
      console.warn('[sync] upload failed:', err && err.code, err && err.message);
      setStatus('error');
    });
    if (!navigator.onLine) setStatus('offline');
  }

  function startListener() {
    stopListener();
    firstSnapshot = true;
    unsubscribe = fb.onSnapshot(userDocRef(), function (snap) {
      if (!snap.exists()) {
        // No cloud data for this account yet. Seed it with local
        // progress - but only once the server (not cache) confirms.
        if (!snap.metadata.fromCache) upload();
        return;
      }
      if (snap.metadata.hasPendingWrites) return; // our own optimistic write
      if (!snap.metadata.fromCache) markSynced();
      var raw = snap.data();
      var isOwnEcho = raw.device === deviceId && !firstSnapshot;
      firstSnapshot = false;
      if (isOwnEcho) return;
      var remote = fromDoc(raw);
      var local = readLocal();
      var merged = mergeData(local, remote);
      if (!sameData(merged, local)) {
        writeLocal(merged);
        document.dispatchEvent(new CustomEvent(EV_REMOTE));
      }
      // If we knew more than the cloud, push the merged state back up
      if (!sameData(merged, remote)) scheduleUpload();
    }, function (err) {
      console.warn('[sync] listener error:', err && err.code, err && err.message);
      setStatus('error');
    });
  }

  function stopListener() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    clearTimeout(uploadTimer);
  }

  // ---- Auth ----
  var AUTH_ERRORS = {
    'auth/invalid-email': 'That email address looks invalid.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/missing-password': 'Please enter your password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.',
    'auth/unauthorized-domain': 'This site is not authorised for sign-in yet.',
  };

  function showAuthError(err) {
    if (!err) return;
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
    var el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = AUTH_ERRORS[err.code] || ('Sign-in failed (' + (err.code || 'unknown') + '). Please try again.');
    el.hidden = false;
    console.warn('[sync] auth error:', err.code, err.message);
  }

  function clearAuthError() {
    var el = document.getElementById('auth-error');
    if (el) { el.textContent = ''; el.hidden = true; }
  }

  function signInGoogle() {
    clearAuthError();
    var provider = new fb.GoogleAuthProvider();
    fb.signInWithPopup(auth, provider).catch(function (err) {
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
        fb.signInWithRedirect(auth, provider).catch(showAuthError);
      } else {
        showAuthError(err);
      }
    });
  }

  function emailSubmit(e) {
    e.preventDefault();
    clearAuthError();
    var email = document.getElementById('auth-email').value.trim();
    var password = document.getElementById('auth-password').value;
    if (!email || !password) return;
    var action = (emailMode === 'create')
      ? fb.createUserWithEmailAndPassword(auth, email, password)
      : fb.signInWithEmailAndPassword(auth, email, password);
    action.catch(showAuthError);
  }

  function forgotPassword() {
    clearAuthError();
    var email = document.getElementById('auth-email').value.trim();
    var el = document.getElementById('auth-error');
    if (!email) {
      el.textContent = 'Enter your email above first, then tap "Forgot password" again.';
      el.hidden = false;
      return;
    }
    fb.sendPasswordResetEmail(auth, email).then(function () {
      el.textContent = 'Password reset email sent to ' + email + '. Check your inbox.';
      el.hidden = false;
    }).catch(showAuthError);
  }

  function signOut() {
    fb.signOut(auth).catch(function (err) {
      console.warn('[sync] sign out failed:', err);
    });
    closeModal();
  }

  function onAuthChanged(u) {
    stopListener();
    user = u;
    if (user) {
      setStatus('syncing');
      startListener();
    } else {
      lastSyncedAt = null;
      setStatus('idle');
    }
    renderAccountUI();
  }

  // ---- UI ----
  function firstName(u) {
    if (u.displayName) return u.displayName.split(' ')[0];
    if (u.email) return u.email.split('@')[0];
    return 'Account';
  }

  function renderAccountUI() {
    var btn = document.getElementById('account-btn');
    if (!btn) return;
    btn.hidden = false;
    // The button also holds an icon, so only the label span is
    // rewritten. Falls back to the button for older markup.
    var label = document.getElementById('account-label') || btn;
    if (user) {
      label.textContent = firstName(user);
      btn.classList.add('signed-in');
      btn.setAttribute('aria-label', 'Account and sync settings');
    } else {
      label.textContent = 'Sign in';
      btn.classList.remove('signed-in');
      btn.setAttribute('aria-label', 'Sign in to sync progress');
    }
    var signedOut = document.getElementById('auth-signed-out');
    var signedIn = document.getElementById('auth-signed-in');
    if (signedOut && signedIn) {
      signedOut.hidden = !!user;
      signedIn.hidden = !user;
      if (user) {
        document.getElementById('auth-user-email').textContent = user.email || user.displayName || '';
      }
    }
    renderStatus();
  }

  function renderStatus() {
    var el = document.getElementById('auth-sync-status');
    if (!el || !user) return;
    var text = '';
    if (syncStatus === 'syncing') text = 'Syncing…';
    else if (syncStatus === 'offline') text = 'Offline - changes will sync when you’re back online.';
    else if (syncStatus === 'error') text = 'Sync hit an error - will retry automatically.';
    else if (syncStatus === 'synced' && lastSyncedAt) {
      var hh = String(lastSyncedAt.getHours()).padStart(2, '0');
      var mm = String(lastSyncedAt.getMinutes()).padStart(2, '0');
      text = 'Synced ✓ (' + hh + ':' + mm + ')';
    }
    el.textContent = text;
  }

  function openModal() {
    var overlay = document.getElementById('auth-modal');
    if (!overlay) return;
    clearAuthError();
    overlay.hidden = false;
    document.body.classList.add('auth-modal-open');
    if (!user) {
      var email = document.getElementById('auth-email');
      if (email && window.matchMedia('(min-width: 700px)').matches) email.focus();
    }
    renderStatus();
  }

  function closeModal() {
    var overlay = document.getElementById('auth-modal');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('auth-modal-open');
  }

  function toggleEmailMode() {
    emailMode = (emailMode === 'signin') ? 'create' : 'signin';
    clearAuthError();
    document.getElementById('auth-submit').textContent = (emailMode === 'create') ? 'Create Account' : 'Sign In';
    document.getElementById('auth-toggle-mode').textContent = (emailMode === 'create')
      ? 'Have an account? Sign in'
      : 'New here? Create an account';
    document.getElementById('auth-password').setAttribute('autocomplete',
      (emailMode === 'create') ? 'new-password' : 'current-password');
  }

  function wireUI() {
    var btn = document.getElementById('account-btn');
    if (btn) btn.addEventListener('click', openModal);
    var close = document.getElementById('auth-close');
    if (close) close.addEventListener('click', closeModal);
    var overlay = document.getElementById('auth-modal');
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hidden) closeModal();
    });
    var google = document.getElementById('auth-google');
    if (google) google.addEventListener('click', signInGoogle);
    var form = document.getElementById('auth-email-form');
    if (form) form.addEventListener('submit', emailSubmit);
    var toggle = document.getElementById('auth-toggle-mode');
    if (toggle) toggle.addEventListener('click', toggleEmailMode);
    var forgot = document.getElementById('auth-forgot');
    if (forgot) forgot.addEventListener('click', forgotPassword);
    var out = document.getElementById('auth-signout');
    if (out) out.addEventListener('click', signOut);
  }

  // ---- Cross-tab: refresh other tabs of this same browser instantly ----
  window.addEventListener('storage', function (e) {
    if (e.key && SYNC_KEYS.indexOf(e.key) !== -1) {
      document.dispatchEvent(new CustomEvent(EV_REMOTE));
    }
  });

  // ---- Local changes from app.js -> debounced upload ----
  document.addEventListener(EV_LOCAL, function (e) {
    var key = e.detail && e.detail.key;
    if (key && SYNC_KEYS.indexOf(key) !== -1) scheduleUpload();
  });

  window.addEventListener('online', function () {
    if (user) scheduleUpload();
  });
  window.addEventListener('offline', function () {
    if (user) setStatus('offline');
  });

  // ---- Boot ----
  function validConfig() {
    return CFG && CFG.appId && FIELDS.length && CFG.firebase && CFG.firebase.apiKey &&
      CFG.firebase.apiKey !== 'REPLACE_ME' && CFG.firebase.projectId &&
      CFG.firebase.projectId !== 'REPLACE_ME';
  }

  var booted = false;
  function boot() {
    if (booted || !validConfig()) return;
    booted = true;
    Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
    ]).then(function (mods) {
      var appMod = mods[0], authMod = mods[1], fsMod = mods[2];
      fb = {
        GoogleAuthProvider: authMod.GoogleAuthProvider,
        signInWithPopup: authMod.signInWithPopup,
        signInWithRedirect: authMod.signInWithRedirect,
        getRedirectResult: authMod.getRedirectResult,
        createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
        signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
        sendPasswordResetEmail: authMod.sendPasswordResetEmail,
        signOut: authMod.signOut,
        doc: fsMod.doc,
        setDoc: fsMod.setDoc,
        onSnapshot: fsMod.onSnapshot,
        serverTimestamp: fsMod.serverTimestamp,
      };
      var app = appMod.initializeApp(CFG.firebase);
      auth = authMod.getAuth(app);
      try {
        db = fsMod.initializeFirestore(app, {
          localCache: fsMod.persistentLocalCache({
            tabManager: fsMod.persistentMultipleTabManager(),
          }),
        });
      } catch (e) {
        // Private browsing or storage-restricted contexts: fall back to memory cache
        db = fsMod.getFirestore(app);
      }
      // Local development against the Firebase emulator suite
      if (CFG.emulator) {
        authMod.connectAuthEmulator(auth, 'http://' + CFG.emulator.host + ':' + CFG.emulator.authPort, { disableWarnings: true });
        fsMod.connectFirestoreEmulator(db, CFG.emulator.host, CFG.emulator.firestorePort);
      }
      wireUI();
      authMod.onAuthStateChanged(auth, onAuthChanged);
      fb.getRedirectResult(auth).catch(showAuthError);
    }).catch(function (err) {
      booted = false; // network failed - retry when back online
      console.warn('[sync] Firebase SDK failed to load (offline?):', err && err.message);
    });
  }

  boot();
  window.addEventListener('online', boot);

  // Exposed for the end-to-end test harness only.
  window.__sync = { readLocal: readLocal, writeLocal: writeLocal, mergeData: mergeData, fromDoc: fromDoc };
})();
