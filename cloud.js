/* Optional Firebase Firestore sync layer. Degrades gracefully when Firebase
   is not configured or not reachable — the app keeps working purely on
   localStorage in that case. */
var Cloud = (function () {
  var CODE_KEY = "tomasfinance.synccode";
  var app = null, db = null;
  var unsubDoc = null, unsubCol = null;
  var connected = false;
  var code = null;
  var onDataCallback = null;
  var toastFn = null;

  function isConfigured() {
    return typeof FIREBASE_CONFIG !== "undefined" && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf("TVOJE_") === -1;
  }

  function ensureInit() {
    if (app) return true;
    if (typeof firebase === "undefined" || !isConfigured()) return false;
    try {
      app = firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* ignore, e.g. private browsing */ }
      return true;
    } catch (e) {
      app = null;
      return false;
    }
  }

  function genCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var s = "";
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function authReady() {
    return new Promise(function (resolve, reject) {
      if (firebase.auth().currentUser) { resolve(); return; }
      firebase.auth().signInAnonymously().then(function () { resolve(); }).catch(reject);
    });
  }

  function chunk(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function stripId(t) {
    var copy = Object.assign({}, t);
    delete copy.id;
    return copy;
  }

  function unsubscribe() {
    if (unsubDoc) { unsubDoc(); unsubDoc = null; }
    if (unsubCol) { unsubCol(); unsubCol = null; }
  }

  function subscribe(spaceCode) {
    unsubscribe();
    var state = { categories: null, portfolioValues: null, investmentGoalPercent: null, transactions: {} };

    function emit() {
      if (!onDataCallback || state.categories === null) return;
      onDataCallback({
        categories: state.categories,
        portfolioValues: state.portfolioValues,
        investmentGoalPercent: state.investmentGoalPercent,
        transactions: Object.keys(state.transactions).map(function (k) { return state.transactions[k]; })
      });
    }

    var spaceRef = db.collection("spaces").doc(spaceCode);

    unsubDoc = spaceRef.onSnapshot(function (doc) {
      var d = doc.data() || {};
      state.categories = d.categories || { income: [], expense: [], investment: [] };
      state.portfolioValues = d.portfolioValues || {};
      state.investmentGoalPercent = d.investmentGoalPercent || 20;
      emit();
    }, function (err) { if (toastFn) toastFn("Cloud chyba: " + err.message); });

    unsubCol = spaceRef.collection("transactions").onSnapshot(function (snap) {
      snap.docChanges().forEach(function (change) {
        if (change.type === "removed") delete state.transactions[change.doc.id];
        else state.transactions[change.doc.id] = Object.assign({ id: change.doc.id }, change.doc.data());
      });
      emit();
    }, function (err) { if (toastFn) toastFn("Cloud chyba: " + err.message); });
  }

  function bulkUpload(spaceCode, localDB) {
    var spaceRef = db.collection("spaces").doc(spaceCode);
    var settingsWrite = spaceRef.set({
      categories: localDB.categories,
      portfolioValues: localDB.portfolioValues || {},
      investmentGoalPercent: localDB.investmentGoalPercent || 20,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    var batches = chunk(localDB.transactions, 450).map(function (group) {
      var batch = db.batch();
      group.forEach(function (t) { batch.set(spaceRef.collection("transactions").doc(t.id), stripId(t)); });
      return batch.commit();
    });
    return Promise.all([settingsWrite].concat(batches));
  }

  return {
    isAvailable: function () { return ensureInit(); },
    isConnected: function () { return connected; },
    getCode: function () { return code; },
    setToastHandler: function (fn) { toastFn = fn; },

    autoReconnect: function (onData) {
      onDataCallback = onData;
      var saved = localStorage.getItem(CODE_KEY);
      if (!saved || !ensureInit()) return Promise.resolve(false);
      return authReady().then(function () {
        code = saved;
        connected = true;
        subscribe(code);
        return true;
      }).catch(function () { return false; });
    },

    createSpace: function (localDB, onData) {
      if (!ensureInit()) return Promise.reject(new Error("Firebase není nakonfigurováno — vyplň firebase-config.js"));
      onDataCallback = onData;
      var newCode = genCode();
      return authReady().then(function () { return bulkUpload(newCode, localDB); }).then(function () {
        code = newCode;
        localStorage.setItem(CODE_KEY, newCode);
        connected = true;
        subscribe(newCode);
        return newCode;
      });
    },

    joinSpace: function (existingCode, onData) {
      if (!ensureInit()) return Promise.reject(new Error("Firebase není nakonfigurováno — vyplň firebase-config.js"));
      onDataCallback = onData;
      var clean = (existingCode || "").trim().toUpperCase();
      if (!clean) return Promise.reject(new Error("Zadej platný kód"));
      return authReady().then(function () {
        code = clean;
        localStorage.setItem(CODE_KEY, clean);
        connected = true;
        subscribe(clean);
        return clean;
      });
    },

    disconnect: function () {
      unsubscribe();
      connected = false;
      code = null;
      localStorage.removeItem(CODE_KEY);
    },

    saveSettings: function (partial) {
      if (!connected) return Promise.resolve();
      return db.collection("spaces").doc(code).set(
        Object.assign({ updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, partial),
        { merge: true }
      );
    },

    upsertTransaction: function (t) {
      if (!connected) return Promise.resolve();
      return db.collection("spaces").doc(code).collection("transactions").doc(t.id).set(stripId(t));
    },

    deleteTransaction: function (id) {
      if (!connected) return Promise.resolve();
      return db.collection("spaces").doc(code).collection("transactions").doc(id).delete();
    }
  };
})();
