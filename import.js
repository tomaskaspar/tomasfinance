/* Import of bank statements: parses pasted text / CSV into rows and suggests
   a type + category for each. Pure logic, no DOM, nothing leaves the browser. */
var Importer = (function () {

  function norm(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ---------- dates & amounts ----------

  function parseDate(s) {
    if (s == null) return null;
    s = String(s).trim();
    var y, mo, d, m = s.match(/(\d{4})\s*[-\/.]\s*(\d{1,2})\s*[-\/.]\s*(\d{1,2})(?!\d)/);
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
      m = s.match(/(?:^|[^\d])(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{4}|\d{2})(?!\d)/);
      if (!m) return null;
      d = +m[1]; mo = +m[2]; y = +m[3];
      if (m[3].length === 2) y += 2000;
    }
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var chk = new Date(y, mo - 1, d);
    if (chk.getFullYear() !== y || chk.getMonth() !== mo - 1 || chk.getDate() !== d) return null;
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  function parseAmount(s) {
    if (s == null) return null;
    var t = String(s).trim();
    if (!t) return null;
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    t = t.replace(/[−–—]/g, "-");
    t = t.replace(/(kč|kc|czk|eur|usd|gbp|pln|€|\$|£|,-)/ig, "").trim();
    if (/[^\d\s,. +\-]/.test(t)) return null;
    t = t.replace(/[\s ]/g, "");
    if (/-$/.test(t)) { neg = true; t = t.slice(0, -1); }
    if (t.charAt(0) === "-") { neg = true; t = t.slice(1); }
    else if (t.charAt(0) === "+") t = t.slice(1);
    if (!/^\d[\d,.]*$/.test(t)) return null;
    var lc = t.lastIndexOf(","), ld = t.lastIndexOf("."), idx = -1;
    if (lc > -1 && ld > -1) idx = Math.max(lc, ld);
    else if (lc > -1) idx = (t.length - lc - 1 === 3 && t.indexOf(",") === lc && lc <= 3) ? -1 : lc;
    else if (ld > -1) idx = (t.length - ld - 1 === 3 && t.indexOf(".") === ld && ld <= 3) ? -1 : ld;
    var v;
    if (idx > -1) v = parseFloat(t.slice(0, idx).replace(/[.,]/g, "") + "." + t.slice(idx + 1).replace(/[.,]/g, ""));
    else v = parseFloat(t.replace(/[.,]/g, ""));
    if (isNaN(v)) return null;
    return neg ? -v : v;
  }

  // ---------- table helpers ----------

  function splitLine(line, delim) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (c) { return c.trim(); });
  }

  var AMOUNT_RE = /castka|amount|objem|suma|hodnota/;
  var AMOUNT_EXCL = /mena|currency|zustatek|balance|poplatek|fee|kurz|puvodni|original|datum|date/;
  var DEBIT_RE = /debet|vydaj|odchoz|paid out|money out|withdraw/;
  var CREDIT_RE = /kredit|^prijem$|^prijmy$|prichoz|paid in|money in|deposit/;
  var TEXT_RE = /zprava|poznamka|popis|description|nazev|protistrana|obchodnik|merchant|ucel|detail|typ|upresneni|komentar|identifikace|counterparty|reference|jmeno|name|info|kategorie/;
  var TEXT_EXCL = /^id|kod|konstantni|variabilni|specificky|\bks\b|\bvs\b|\bss\b|zustatek|balance|mena|currency|bic|datum|date|castka|amount|objem|fee|poplatek|kurz|cislo|iban|ucet protistrany|protiucet$/;

  function mapColumns(cells) {
    var h = cells.map(norm);
    var col = { date: -1, amount: -1, debit: -1, credit: -1, currency: -1, dir: -1, text: [] };
    var datePats = [/provedeni|completed|transaction date/, /zauctov|booking|posted/, /started/, /^datum$|^date$/, /datum|date/];
    for (var p = 0; p < datePats.length && col.date < 0; p++) {
      col.date = h.findIndex(function (x) { return datePats[p].test(x); });
    }
    col.amount = h.findIndex(function (x) { return AMOUNT_RE.test(x) && !AMOUNT_EXCL.test(x); });
    if (col.amount < 0) {
      col.debit = h.findIndex(function (x) { return DEBIT_RE.test(x); });
      col.credit = h.findIndex(function (x) { return CREDIT_RE.test(x); });
    }
    col.currency = h.findIndex(function (x) { return /^(mena|currency|mena uctu)$/.test(x); });
    col.dir = h.findIndex(function (x) { return /^smer|direction|^typ pohybu|db\/cr/.test(x); });
    var used = [col.date, col.amount, col.debit, col.credit, col.currency, col.dir];
    h.forEach(function (x, i) {
      if (used.indexOf(i) === -1 && TEXT_RE.test(x) && !TEXT_EXCL.test(x)) col.text.push(i);
    });
    return col;
  }

  function isHeader(cells) {
    if (cells.length < 3) return false;
    var c = mapColumns(cells);
    return c.date > -1 && (c.amount > -1 || (c.debit > -1 && c.credit > -1));
  }

  function rowFromTable(cells, col, usedAllCols) {
    var date = parseDate(cells[col.date]);
    if (!date) return null;
    var amount = null;
    if (col.amount > -1) amount = parseAmount(cells[col.amount]);
    else {
      var d = parseAmount(cells[col.debit]), c = parseAmount(cells[col.credit]);
      if (d == null && c == null) return null;
      amount = Math.abs(c || 0) - Math.abs(d || 0);
    }
    if (amount == null || amount === 0) return null;
    if (col.dir > -1) {
      var dv = norm(cells[col.dir]);
      if (/odchoz|debet|debit|vydaj|\bout\b/.test(dv)) amount = -Math.abs(amount);
      else if (/prichoz|kredit|credit|prijem|\bin\b/.test(dv)) amount = Math.abs(amount);
    }
    var parts = [], seen = {};
    var idxs = col.text.length ? col.text : cells.map(function (_, i) { return i; }).filter(function (i) {
      return i !== col.date && i !== col.amount && i !== col.debit && i !== col.credit && i !== col.currency && i !== col.dir;
    });
    idxs.forEach(function (i) {
      var v = (cells[i] || "").trim();
      if (!v || seen[v] || /^[\d\s\/.,*-]+$/.test(v)) return;
      seen[v] = true;
      parts.push(v);
    });
    var cur = col.currency > -1 ? String(cells[col.currency] || "").trim().toUpperCase() : "";
    var foreign = cur && cur !== "CZK" && cur !== "KC" && cur !== "KČ";
    return { date: date, amount: amount, desc: parts.join(" · "), currency: foreign ? cur : "" };
  }

  function parseWithHeader(lines, headerIdx, delim) {
    var col = mapColumns(splitLine(lines[headerIdx], delim));
    var rows = [], skipped = 0;
    for (var i = headerIdx + 1; i < lines.length; i++) {
      var cells = splitLine(lines[i], delim);
      if (cells.length < 2) continue;
      var r = rowFromTable(cells, col);
      if (r) rows.push(r); else skipped++;
    }
    return { rows: rows, skipped: skipped };
  }

  function parseHeuristicTable(lines, delim) {
    var rows = [], skipped = 0;
    lines.forEach(function (line) {
      var cells = splitLine(line, delim);
      if (cells.length < 3) { skipped++; return; }
      var di = -1, date = null;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].length <= 28 && (date = parseDate(cells[i]))) { di = i; break; }
      }
      if (di < 0) { skipped++; return; }
      var ai = -1, amount = null, bestScore = -1;
      for (var j = 0; j < cells.length; j++) {
        if (j === di) continue;
        var v = parseAmount(cells[j]);
        if (v == null || v === 0) continue;
        if (/^\d{9,}$/.test(cells[j].replace(/\s/g, ""))) continue;
        var score = (/[.,]\d{1,2}\s*$/.test(cells[j]) ? 2 : 0) + (/^[+\-−]/.test(cells[j]) ? 2 : 0) + (/kč|czk|kc/i.test(cells[j]) ? 1 : 0);
        if (score > bestScore) { bestScore = score; ai = j; amount = v; }
      }
      if (ai < 0) { skipped++; return; }
      var parts = cells.filter(function (c, k) { return k !== di && k !== ai && c && !/^[\d\s\/.,*+\-]+$/.test(c); });
      rows.push({ date: date, amount: amount, desc: parts.join(" · "), currency: "" });
    });
    return { rows: rows, skipped: skipped };
  }

  function parseBlocks(lines) {
    var blocks = [], cur = null;
    lines.forEach(function (line) {
      var m = line.match(/(\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*(?:\d{4}|\d{2})(?!\d)|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})/);
      if (m && (m.index <= 3 || !cur) && parseDate(m[0])) {
        cur = { lines: [line] };
        blocks.push(cur);
      } else if (cur) cur.lines.push(line);
    });
    var rows = [], skipped = 0;
    blocks.forEach(function (b) {
      var text = b.lines.join(" ");
      var date = parseDate(text);
      var rest = text
        .replace(/(\d{1,2}\s*[.\/-]\s*\d{1,2}\s*[.\/-]\s*(?:\d{4}|\d{2})(?!\d)|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})/g, " ")
        .replace(/\b\d{1,10}\/\d{4}\b/g, " ")
        .replace(/\d{4}\s?\*+\s?\d{4}/g, " ")
        .replace(/\b(vs|ks|ss)\s*[:.]?\s*\d+/ig, " ");
      var re = /([-+−]?\d{1,3}(?:[  ]\d{3})+(?:[.,]\d{1,2})?|[-+−]?\d+(?:[.,]\d{1,2})?)(\s*(?:kč|kc|czk|,-))?/ig;
      var best = null, bestScore = 0, mm;
      while ((mm = re.exec(rest)) !== null) {
        var v = parseAmount(mm[1]);
        if (v == null || v === 0) continue;
        var score = (mm[2] ? 3 : 0) + (/^[+\-−]/.test(mm[1]) ? 2 : 0) + (/[.,]\d{1,2}$/.test(mm[1]) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = { v: v, text: mm[0] }; }
      }
      if (!date || !best) { skipped++; return; }
      var desc = rest.replace(best.text, " ")
        .replace(/[-+−]?\d[\d  ]*[.,]\d{1,2}\s*(?:kč|kc|czk)?/ig, " ")
        .replace(/\b(zůstatek|zustatek)\b/ig, " ")
        .replace(/\s+/g, " ").trim();
      rows.push({ date: date, amount: best.v, desc: desc, currency: "" });
    });
    return { rows: rows, skipped: skipped };
  }

  function parse(text, opts) {
    text = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var lines = text.split("\n").map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; });
    var empty = { rows: [], skipped: 0, mode: "" };
    if (!lines.length) return empty;
    var delims = ["\t", ";", "|", ","];

    for (var d = 0; d < delims.length; d++) {
      for (var i = 0; i < Math.min(lines.length, 40); i++) {
        if (isHeader(splitLine(lines[i], delims[d]))) {
          var r = parseWithHeader(lines, i, delims[d]);
          if (r.rows.length) { r.mode = "tabulka s hlavičkou"; return r; }
        }
      }
    }

    var best = empty;
    delims.forEach(function (dl) {
      var cnt = lines.filter(function (l) { return splitLine(l, dl).length >= 3; }).length;
      if (cnt < Math.max(1, Math.floor(lines.length / 2))) return;
      var r = parseHeuristicTable(lines, dl);
      if (r.rows.length > best.rows.length) { best = r; best.mode = "tabulka bez hlavičky"; }
    });
    var b = parseBlocks(lines);
    var pdfTie = opts && opts.pdf && b.rows.length && b.rows.length >= best.rows.length;
    if (b.rows.length > best.rows.length || pdfTie) { best = b; best.mode = "volný text"; }
    return best;
  }

  // ---------- PDF text extraction (pdf.js is loaded on demand) ----------

  var PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = PDFJS_BASE + "pdf.min.js";
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error("Nepodařilo se načíst čtečku PDF — je potřeba připojení k internetu.")); };
      document.head.appendChild(s);
    });
  }

  function pageToLines(content) {
    var items = content.items.filter(function (it) { return it.str && it.str.trim() !== ""; }).map(function (it) {
      return { x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str };
    });
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [], cur = null;
    items.forEach(function (it) {
      if (!cur || Math.abs(cur.y - it.y) > 2.5) { cur = { y: it.y, items: [] }; lines.push(cur); }
      cur.items.push(it);
    });
    return lines.map(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      var out = "";
      l.items.forEach(function (it, i) {
        if (i > 0) {
          var prev = l.items[i - 1];
          out += (it.x - (prev.x + prev.w)) > 8 ? "\t" : " ";
        }
        out += it.s.trim();
      });
      return out;
    });
  }

  function pdfToText(buf) {
    return loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var all = [], p = 1;
      function next() {
        if (p > pdf.numPages) return all.join("\n");
        return pdf.getPage(p++).then(function (page) { return page.getTextContent(); }).then(function (c) {
          all = all.concat(pageToLines(c));
          return next();
        });
      }
      return next();
    });
  }

  // ---------- categorisation ----------

  function compile(list) {
    return list.map(function (entry) {
      return {
        category: entry[0],
        res: entry[1].map(function (k) {
          var esc = k.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
          return k.length <= 4 ? new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)") : new RegExp(esc);
        })
      };
    });
  }

  var EXPENSE_RULES = compile([
    ["Předplatné", ["netflix", "spotify", "youtube", "google one", "google storage", "google *", "apple.com/bill", "itunes", "icloud", "disney", "hbo", "max.com", "prime video", "amazon prime", "audible", "openai", "chatgpt", "anthropic", "claude.ai", "github", "dropbox", "microsoft", "adobe", "patreon", "skyshowtime", "voyo", "oneplay", "tidal", "deezer", "canva", "notion", "duolingo"]],
    ["Jídlo", ["lidl", "albert", "billa", "kaufland", "tesco", "penny", "globus", "coop", "potraviny", "rohlik", "kosik", "mcdonald", "kfc", "burger king", "restaurace", "pizz", "bufet", "pekarna", "pekarstvi", "cukrarna", "starbucks", "costa coffee", "cafe", "kavarna", "wolt", "foodora", "bolt food", "zabka", "hruska", "tamda", "makro", "jip", "delikatesy", "bistro", "sushi", "kebab", "dominos", "subway", "lahudky", "vinotek"]],
    ["Doprava", ["benzina", "shell", "omv", "mol", "eurooil", "orlen", "tank", "parkov", "parking", "mhd", "dpp", "dpmb", "dpo", "idos", "regiojet", "leo express", "ceske drahy", "cd.cz", "uber", "bolt", "lime", "tier", "nextbike", "mytne", "dalnicni", "stk", "autoskola", "autodoplnky", "pneu", "taxi", "liftago", "flixbus", "ryanair", "wizz", "letenka", "letiste", "jizdenka", "litacka"]],
    ["Bydlení", ["najem", "najemne", "elektrina", "cez", "eon", "e.on", "innogy", "prazska energetika", "plyn", "vodarna", "vodovod", "svj", "fond oprav", "internet", "upc", "ikea", "hornbach", "obi", "jysk", "bauhaus", "pojisteni domacnosti", "odpady", "teplo"]],
    ["Zdraví", ["lekarna", "benu", "dr.max", "dr max", "drmax", "pilulka", "poliklinika", "lekar", "zubar", "nemocnice", "ordinace", "fitness", "fitko", "gym", "multisport", "holmes place", "repsport", "optika", "vzp", "kosmetika", "masaz", "fyzio"]],
    ["Zábava", ["kino", "cinema", "cinestar", "divadlo", "steam", "playstation", "xbox", "nintendo", "epic games", "ticketportal", "goout", "ticketmaster", "bowling", "sazka", "tipsport", "fortuna", "chance", "pub", "klub", "bar", "hospoda", "vinarna", "pivnice", "koncert", "festival", "twitch", "aquapark", "zoo", "muzeum"]],
    ["Oblečení", ["zalando", "h&m", "hm.com", "zara", "reserved", "c&a", "about you", "answear", "decathlon", "nike", "adidas", "deichmann", "ccc", "sinsay", "primark", "new yorker", "pull&bear", "bershka", "footshop", "vinted", "lindex", "cropp"]]
  ]);

  var INCOME_RULES = compile([
    ["Mzda", ["vyplata", "mzda", "salary", "zamestnavatel", "plat", "wage", "payroll"]],
    ["Dary", ["dar", "darek", "gift", "kapesne", "narozeniny", "vanoce"]],
    ["Vedlejší příjem", ["wolt", "bolt", "foodora", "uber", "airbnb", "vinted", "bazos", "sbazar", "fiverr", "upwork", "faktura", "brigada", "odmena"]]
  ]);

  var INVEST_RULES = compile([
    ["Kryptoměny", ["coinbase", "binance", "anycoin", "coinmate", "kraken", "bitstamp", "uphold", "bitcoin", "btc", "krypto", "crypto", "bybit", "kucoin", "bitpanda"]],
    ["Akcie/ETF", ["trading 212", "trading212", "xtb", "degiro", "interactive brokers", "ibkr", "portu", "ebroker", "e-broker", "lynx", "etoro", "freedom24", "tastytrade", "etf", "akcie", "broker"]],
    ["Spoření/rezerva", ["sporic", "stavebni sporeni", "penzijni", "penzijko", "conseq", "nn penzijni", "amundi", "pension"]]
  ]);

  var TRANSFER_RE = /vlastni (ucet|uc)|mezi vlastnimi|prevod mezi|own account|internal transfer|na sporici|ze sporiciho|sporici ucet/;

  var STOPWORDS = ["platba", "kartou", "karta", "nakup", "transakce", "prevod", "uhrada", "odchozi", "prichozi", "bezhotovostni", "domaci", "platebni", "trvaly", "prikaz", "inkaso", "pos", "internetova", "praha", "brno", "ostrava", "plzen", "czk", "cz", "czech", "republic", "pro", "bez", "datum"];

  function keyOf(desc) {
    var words = norm(desc).replace(/[^a-z\s]/g, " ").split(/\s+/).filter(function (w) {
      return w.length >= 3 && STOPWORDS.indexOf(w) === -1;
    });
    return words.slice(0, 2).join(" ");
  }

  function matchRules(rules, text) {
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].res.length; j++) {
        if (rules[i].res[j].test(text)) return rules[i].category;
      }
    }
    return null;
  }

  function fallbackCategory(list) {
    if (list.indexOf("Ostatní") !== -1) return "Ostatní";
    return list[list.length - 1] || "";
  }

  function suggestFor(desc, type, ctx) {
    var list = (ctx.categories && ctx.categories[type]) || [];
    var text = norm(desc);
    var rules = type === "income" ? INCOME_RULES : type === "investment" ? INVEST_RULES : EXPENSE_RULES;
    var cat = matchRules(rules, text);
    if (cat && list.indexOf(cat) !== -1) return { category: cat, conf: "rule" };
    return { category: fallbackCategory(list), conf: "guess" };
  }

  function categorize(desc, amount, ctx) {
    ctx = ctx || {};
    var key = keyOf(desc);
    var learned = key && ctx.learned ? ctx.learned[key] : null;
    var list;
    if (learned && ((amount > 0 && learned.type === "income") || (amount < 0 && learned.type !== "income"))) {
      list = (ctx.categories && ctx.categories[learned.type]) || [];
      if (list.indexOf(learned.category) !== -1) {
        return { type: learned.type, category: learned.category, essential: learned.essential, conf: "learned", transfer: TRANSFER_RE.test(norm(desc)) };
      }
    }
    var text = norm(desc), type;
    if (amount > 0) type = "income";
    else type = matchRules(INVEST_RULES, text) ? "investment" : "expense";
    var s = suggestFor(desc, type, ctx);
    return { type: type, category: s.category, essential: null, conf: s.conf, transfer: TRANSFER_RE.test(text) };
  }

  function cleanNote(desc) {
    return String(desc || "").replace(/\d{4}\s?\*+\s?\d{4}/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  return { parse: parse, pdfToText: pdfToText, parseDate: parseDate, parseAmount: parseAmount, categorize: categorize, suggestFor: suggestFor, keyOf: keyOf, cleanNote: cleanNote };
})();
