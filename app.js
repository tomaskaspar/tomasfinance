(function () {
  "use strict";

  var STORAGE_KEY = "tomasfinance.v1";
  var CZ_MONTHS = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
  var CZ_MONTHS_SHORT = ["Led", "Úno", "Bře", "Dub", "Kvě", "Čvn", "Čvc", "Srp", "Zář", "Říj", "Lis", "Pro"];
  var CATEGORY_COLORS = ["#7aa2ff", "#2dd4a7", "#f4788a", "#f3b855", "#c084fc", "#38bdf8", "#fb923c", "#a3e635", "#f472b6", "#94a3b8"];
  var DEFAULT_ESSENTIAL = { "Bydlení": true, "Jídlo": true, "Doprava": true, "Zdraví": true, "Zábava": false, "Oblečení": false, "Předplatné": false };

  function defaultDB() {
    return {
      version: 1,
      transactions: [],
      categories: {
        income: ["Mzda", "Vedlejší příjem", "Dary", "Ostatní"],
        expense: ["Bydlení", "Jídlo", "Doprava", "Zdraví", "Zábava", "Oblečení", "Předplatné", "Ostatní"],
        investment: ["Akcie/ETF", "Kryptoměny", "Spoření/rezerva", "Nemovitosti", "Ostatní"]
      },
      portfolioValues: {},
      investmentGoalPercent: 20
    };
  }

  var DB = loadDB();

  function loadDB() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultDB();
      var parsed = JSON.parse(raw);
      var d = defaultDB();
      return Object.assign(d, parsed, {
        categories: Object.assign(d.categories, parsed.categories || {})
      });
    } catch (e) {
      return defaultDB();
    }
  }

  function saveDB() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function currentMonthKey() {
    return todayISO().slice(0, 7);
  }

  function monthKeyOf(dateStr) {
    return dateStr.slice(0, 7);
  }

  function monthLabel(mk) {
    var p = mk.split("-");
    return CZ_MONTHS[parseInt(p[1], 10) - 1] + " " + p[0];
  }

  function monthLabelShort(mk) {
    var p = mk.split("-");
    return CZ_MONTHS_SHORT[parseInt(p[1], 10) - 1] + " " + p[0].slice(2);
  }

  function fmtMoney(n) {
    n = Math.round(n * 100) / 100;
    return n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) + " Kč";
  }

  function fmtPct(n) {
    return (Math.round(n * 10) / 10) + " %";
  }

  function addMonths(mk, delta) {
    var p = mk.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1 + delta, 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function getAllMonths() {
    var set = {};
    DB.transactions.forEach(function (t) { set[monthKeyOf(t.date)] = true; });
    set[currentMonthKey()] = true;
    return Object.keys(set).sort();
  }

  function typeLabel(t) {
    return t === "income" ? "Příjem" : t === "expense" ? "Výdaj" : "Investice";
  }

  // ---------- computations ----------

  function computeMonthStats(mk) {
    var txs = DB.transactions.filter(function (t) { return monthKeyOf(t.date) === mk; });
    var income = 0, expense = 0, essential = 0, waste = 0, investment = 0;
    txs.forEach(function (t) {
      if (t.type === "income") income += t.amount;
      else if (t.type === "investment") investment += t.amount;
      else if (t.type === "expense") {
        expense += t.amount;
        if (t.essential === false) waste += t.amount; else essential += t.amount;
      }
    });
    var cashflow = income - expense - investment;
    var savingsRate = income > 0 ? (income - expense) / income * 100 : 0;
    var investRate = income > 0 ? investment / income * 100 : 0;
    var wasteRatio = income > 0 ? waste / income * 100 : 0;
    return { income: income, expense: expense, essential: essential, waste: waste, investment: investment, cashflow: cashflow, savingsRate: savingsRate, investRate: investRate, wasteRatio: wasteRatio, count: txs.length };
  }

  function categoryBreakdown(mk, type) {
    var txs = DB.transactions.filter(function (t) { return monthKeyOf(t.date) === mk && t.type === type; });
    var map = {};
    txs.forEach(function (t) { map[t.category] = (map[t.category] || 0) + t.amount; });
    var arr = Object.keys(map).map(function (k) { return { label: k, value: map[k] }; });
    arr.sort(function (a, b) { return b.value - a.value; });
    arr.forEach(function (d, i) { d.color = CATEGORY_COLORS[i % CATEGORY_COLORS.length]; });
    return arr;
  }

  function totalInvestedAllTime() {
    return DB.transactions.filter(function (t) { return t.type === "investment"; }).reduce(function (s, t) { return s + t.amount; }, 0);
  }

  function investedCategories() {
    var map = {};
    DB.transactions.forEach(function (t) { if (t.type === "investment") map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).map(function (c) { return { category: c, invested: map[c] }; });
  }

  // ---------- UI state ----------

  var ui = {
    tab: "dashboard",
    dashboardMonth: currentMonthKey(),
    editingId: null,
    txFilters: { month: "all", income: true, expense: true, investment: true, essential: "all", category: "all", search: "", sortBy: "date", sortDir: "desc" },
    compareMonths: null
  };

  // ---------- toast ----------

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  // ---------- tabs ----------

  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.toggle("active", p.id === "tab-" + tab); });
    renderActiveTab();
  }

  function renderActiveTab() {
    if (ui.tab === "dashboard") renderDashboard();
    else if (ui.tab === "transactions") renderTransactionsTab();
    else if (ui.tab === "compare") renderCompareTab();
    else if (ui.tab === "settings") renderSettingsTab();
  }

  // ---------- Dashboard ----------

  function renderDashboard() {
    var months = getAllMonths().slice().reverse();
    if (months.indexOf(ui.dashboardMonth) === -1) ui.dashboardMonth = months[0];
    var sel = document.getElementById("dash-month");
    sel.innerHTML = months.map(function (m) {
      return '<option value="' + m + '"' + (m === ui.dashboardMonth ? " selected" : "") + ">" + monthLabel(m) + "</option>";
    }).join("");

    var mk = ui.dashboardMonth;
    var stats = computeMonthStats(mk);
    var prevStats = computeMonthStats(addMonths(mk, -1));

    function deltaHtml(cur, prev, higherIsBetter) {
      if (prev === 0 && cur === 0) return "";
      var diff = cur - prev;
      var pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : (cur !== 0 ? 100 : 0);
      var good = higherIsBetter ? diff >= 0 : diff <= 0;
      var arrow = diff >= 0 ? "▲" : "▼";
      return '<span class="delta ' + (good ? "up" : "down") + '">' + arrow + " " + Math.abs(Math.round(pct)) + "% vs min. měsíc</span>";
    }

    document.getElementById("dash-stats").innerHTML =
      statCard("income", "Příjmy", fmtMoney(stats.income), deltaHtml(stats.income, prevStats.income, true)) +
      statCard("expense", "Výdaje", fmtMoney(stats.expense), deltaHtml(stats.expense, prevStats.expense, false)) +
      statCard("investment", "Investováno", fmtMoney(stats.investment), deltaHtml(stats.investment, prevStats.investment, true)) +
      statCard(stats.cashflow >= 0 ? "income" : "expense", "Zůstatek (cash flow)", fmtMoney(stats.cashflow), "z toho zbytečnosti: " + fmtMoney(stats.waste));

    document.getElementById("dash-score").innerHTML = scoreRow(stats);

    var donutData = categoryBreakdown(mk, "expense");
    document.getElementById("dash-donut-chart").innerHTML = donutData.length
      ? Charts.donut(donutData)
      : '<div class="empty-state">Žádné výdaje v tomto měsíci</div>';
    document.getElementById("dash-donut-center").innerHTML = donutData.length
      ? '<div class="val">' + fmtMoney(stats.expense) + '</div><div class="lbl">celkem výdaje</div>'
      : "";
    document.getElementById("dash-donut-legend").innerHTML = donutData.map(function (d) {
      return '<div class="item"><span class="dot" style="background:' + d.color + '"></span>' + escapeHtml(d.label) + '<span class="amount">' + fmtMoney(d.value) + "</span></div>";
    }).join("");

    var last6 = getAllMonths().slice(-6);
    var barData = last6.map(function (m) {
      var s = computeMonthStats(m);
      return { label: monthLabelShort(m), income: s.income, expense: s.expense, investment: s.investment };
    });
    document.getElementById("dash-bar-chart").innerHTML = Charts.groupedBars(barData, { height: 230 });

    var allMonths = getAllMonths();
    var running = 0;
    var linePoints = allMonths.map(function (m) {
      var s = computeMonthStats(m);
      running += s.investment;
      return { label: monthLabelShort(m), value: running };
    });
    document.getElementById("dash-line-chart").innerHTML = linePoints.some(function (p) { return p.value > 0; })
      ? Charts.line(linePoints, { height: 200 })
      : '<div class="empty-state">Zatím žádné investice — přidej první v záložce Transakce</div>';

    renderPortfolioCard();
  }

  function statCard(kind, label, value, sub) {
    return '<div class="card stat-card ' + kind + '"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + sub + "</div></div>";
  }

  function scoreBadge(value, thresholds) {
    // thresholds: [goodMin, warnMin] both meaning "at least"
    if (value >= thresholds[0]) return "good";
    if (value >= thresholds[1]) return "warn";
    return "bad";
  }

  function scoreRow(stats) {
    var investGoal = DB.investmentGoalPercent || 20;
    var investBadge = scoreBadge(stats.investRate, [investGoal, investGoal / 2]);
    var wasteBadge = stats.wasteRatio <= 5 ? "good" : stats.wasteRatio <= 15 ? "warn" : "bad";
    var savingsBadge = scoreBadge(stats.savingsRate, [30, 15]);

    var tips = [];
    if (wasteBadge !== "good") tips.push("Tento měsíc jsi utratil/a " + fmtMoney(stats.waste) + " za zbytečnosti (" + fmtPct(stats.wasteRatio) + " z příjmů). Zkus to příště omezit.");
    if (investBadge === "bad") tips.push("Investuješ jen " + fmtPct(stats.investRate) + " příjmů, cíl je " + investGoal + " %. Zkus zvýšit pravidelnou investici.");
    if (tips.length === 0) tips.push("Skvělá práce — držíš zbytečné výdaje nízko a investuješ nad plán. Pokračuj v tom!");

    return '<div class="score-row">' +
      scoreItem("Míra investování", stats.investRate, investGoal, investBadge) +
      scoreItem("Míra úspor", stats.savingsRate, 30, savingsBadge) +
      scoreItem("Podíl zbytečností", stats.wasteRatio, 5, wasteBadge, true) +
      '</div><div class="tip">💡 ' + tips.join(" ") + "</div>";
  }

  function scoreItem(name, value, target, badge, invert) {
    var pct = Math.max(0, Math.min(100, invert ? (100 - value * 4) : (value / Math.max(target, 1) * 100)));
    var color = badge === "good" ? "var(--income)" : badge === "warn" ? "var(--essential)" : "var(--waste)";
    return '<div class="score-item"><div class="top"><span class="name">' + name + '</span><span class="badge ' + badge + '">' + fmtPct(value) + '</span></div>' +
      '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%;background:' + color + ';"></div></div></div>';
  }

  function renderPortfolioCard() {
    var container = document.getElementById("dash-portfolio-rows");
    var cats = investedCategories();
    if (cats.length === 0) {
      container.innerHTML = '<div class="empty-state">Zatím žádné investice — přidej první v záložce Transakce</div>';
      return;
    }

    var totalInvested = 0, totalCurrent = 0, anyValueEntered = false;
    var rows = cats.map(function (c) {
      totalInvested += c.invested;
      var val = DB.portfolioValues[c.category];
      var hasVal = val != null && val !== "";
      if (hasVal) { totalCurrent += val; anyValueEntered = true; } else { totalCurrent += c.invested; }
      var profitHtml;
      if (hasVal) {
        var profit = val - c.invested;
        var pct = c.invested > 0 ? (profit / c.invested * 100) : 0;
        profitHtml = '<span style="color:' + (profit >= 0 ? "var(--income)" : "var(--waste)") + ';font-weight:700;">' + (profit >= 0 ? "+" : "") + fmtMoney(profit) + " (" + fmtPct(Math.abs(pct)) + ")</span>";
      } else {
        profitHtml = '<span style="color:var(--text-dim);font-size:12px;">zadej hodnotu</span>';
      }
      return '<div class="score-item" style="margin-bottom:10px;">' +
        '<div class="top"><span class="name">' + escapeHtml(c.category) + '</span>' + profitHtml + '</div>' +
        '<div class="field-row" style="grid-template-columns:1fr 1fr;">' +
        '<div><label>Vloženo</label><div style="font-weight:700;">' + fmtMoney(c.invested) + '</div></div>' +
        '<div><label>Aktuální hodnota</label><input type="number" class="portfolio-cat-input" data-category="' + escapeHtml(c.category) + '" placeholder="např. ' + Math.round(c.invested) + '" step="0.01" min="0" value="' + (hasVal ? val : "") + '"></div>' +
        '</div>' +
        '</div>';
    }).join("");

    var totalProfit = totalCurrent - totalInvested;
    var totalPct = totalInvested > 0 ? (totalProfit / totalInvested * 100) : 0;
    var totalRow = '<div class="score-item" style="border-color:var(--accent);">' +
      '<div class="top"><span class="name" style="font-weight:700;">Celkem</span>' +
      (anyValueEntered
        ? '<span style="color:' + (totalProfit >= 0 ? "var(--income)" : "var(--waste)") + ';font-weight:800;">' + (totalProfit >= 0 ? "Zisk: " : "Ztráta: ") + fmtMoney(Math.abs(totalProfit)) + " (" + fmtPct(Math.abs(totalPct)) + ")</span>"
        : '<span style="color:var(--text-dim);font-size:12px;">zadej alespoň jednu hodnotu</span>') +
      "</div><div style=\"font-size:12.5px;color:var(--text-dim);margin-top:4px;\">Celkem vloženo: " + fmtMoney(totalInvested) + "</div></div>";

    container.innerHTML = rows + totalRow;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // ---------- Transactions tab ----------

  function populateCategorySelect(type, selected) {
    var sel = document.getElementById("f-category");
    var cats = DB.categories[type] || [];
    sel.innerHTML = cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>"; }).join("");
    if (selected && cats.indexOf(selected) !== -1) sel.value = selected;
  }

  function setFormType(type) {
    document.querySelectorAll(".type-toggle button").forEach(function (b) { b.classList.toggle("active", b.dataset.type === type); });
    document.getElementById("f-essential-wrap").style.display = type === "expense" ? "block" : "none";
    populateCategorySelect(type);
    document.getElementById("tx-form").dataset.type = type;
    maybeSetDefaultEssential();
  }

  function maybeSetDefaultEssential() {
    var type = document.getElementById("tx-form").dataset.type;
    if (type !== "expense") return;
    var cat = document.getElementById("f-category").value;
    if (DEFAULT_ESSENTIAL.hasOwnProperty(cat)) {
      setEssentialToggle(DEFAULT_ESSENTIAL[cat]);
    }
  }

  function setEssentialToggle(val) {
    document.querySelectorAll(".essential-toggle button").forEach(function (b) {
      b.classList.toggle("active", (b.dataset.val === "1") === !!val);
    });
    document.getElementById("f-essential-wrap").dataset.val = val ? "1" : "0";
  }

  function resetForm() {
    ui.editingId = null;
    document.getElementById("tx-form").reset();
    document.getElementById("f-date").value = todayISO();
    setFormType("expense");
    setEssentialToggle(true);
    document.getElementById("tx-submit-btn").textContent = "Přidat transakci";
    document.getElementById("tx-cancel-edit").style.display = "none";
  }

  function getFilteredTransactions() {
    var f = ui.txFilters;
    var list = DB.transactions.filter(function (t) {
      if (f.month !== "all" && monthKeyOf(t.date) !== f.month) return false;
      if (!f[t.type]) return false;
      if (f.essential !== "all") {
        if (t.type !== "expense") return false;
        var isEssential = t.essential !== false;
        if (f.essential === "essential" && !isEssential) return false;
        if (f.essential === "waste" && isEssential) return false;
      }
      if (f.category !== "all" && t.category !== f.category) return false;
      if (f.search) {
        var s = f.search.toLowerCase();
        if ((t.note || "").toLowerCase().indexOf(s) === -1 && t.category.toLowerCase().indexOf(s) === -1) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      var dir = f.sortDir === "asc" ? 1 : -1;
      if (f.sortBy === "amount") return (a.amount - b.amount) * dir;
      if (f.sortBy === "type") return a.type.localeCompare(b.type) * dir;
      if (f.sortBy === "category") return a.category.localeCompare(b.category) * dir;
      return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir;
    });
    return list;
  }

  function renderTransactionsTab() {
    populateCategorySelect(document.getElementById("tx-form").dataset.type, document.getElementById("f-category").value);
    var months = getAllMonths().slice().reverse();
    var monthSel = document.getElementById("flt-month");
    monthSel.innerHTML = '<option value="all">Všechny měsíce</option>' + months.map(function (m) {
      return '<option value="' + m + '"' + (m === ui.txFilters.month ? " selected" : "") + ">" + monthLabel(m) + "</option>";
    }).join("");

    var allCats = Array.from(new Set([].concat(DB.categories.income, DB.categories.expense, DB.categories.investment)));
    var catSel = document.getElementById("flt-category");
    catSel.innerHTML = '<option value="all">Všechny kategorie</option>' + allCats.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"' + (c === ui.txFilters.category ? " selected" : "") + ">" + escapeHtml(c) + "</option>";
    }).join("");

    ["income", "expense", "investment"].forEach(function (t) {
      document.getElementById("chip-" + t).classList.toggle("active", ui.txFilters[t]);
    });
    document.getElementById("flt-essential").value = ui.txFilters.essential;
    document.getElementById("flt-search").value = ui.txFilters.search;

    var list = getFilteredTransactions();
    var container = document.getElementById("tx-table-container");
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">Žádné transakce neodpovídají filtru. Zkus přidat první výše ⬆</div>';
      return;
    }

    var rows = list.map(function (t) {
      var essentialBadge = t.type === "expense" ? ('<span class="badge ' + (t.essential === false ? "waste" : "essential") + '">' + (t.essential === false ? "Zbytečnost" : "Nutné") + "</span>") : "";
      var sign = t.type === "income" ? "+" : "-";
      return "<tr>" +
        "<td>" + t.date + "</td>" +
        '<td><span class="badge ' + t.type + '">' + typeLabel(t.type) + "</span></td>" +
        "<td>" + escapeHtml(t.category) + "</td>" +
        '<td class="note">' + escapeHtml(t.note || "") + "</td>" +
        "<td>" + essentialBadge + "</td>" +
        '<td class="amount ' + t.type + '">' + sign + fmtMoney(t.amount) + "</td>" +
        '<td><div class="row-actions"><button class="icon-btn" data-action="edit" data-id="' + t.id + '" title="Upravit">✎</button><button class="icon-btn del" data-action="delete" data-id="' + t.id + '" title="Smazat">🗑</button></div></td>' +
        "</tr>";
    }).join("");

    container.innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      '<th data-sort="date">Datum</th><th data-sort="type">Typ</th><th data-sort="category">Kategorie</th><th>Poznámka</th><th>Klasifikace</th><th data-sort="amount">Částka</th><th></th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function startEdit(id) {
    var t = DB.transactions.find(function (x) { return x.id === id; });
    if (!t) return;
    ui.editingId = id;
    setFormType(t.type);
    document.getElementById("f-date").value = t.date;
    populateCategorySelect(t.type, t.category);
    document.getElementById("f-amount").value = t.amount;
    document.getElementById("f-note").value = t.note || "";
    if (t.type === "expense") setEssentialToggle(t.essential !== false);
    document.getElementById("tx-submit-btn").textContent = "Uložit změny";
    document.getElementById("tx-cancel-edit").style.display = "inline-block";
    document.getElementById("tx-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function deleteTransaction(id) {
    if (!confirm("Opravdu smazat tuto transakci?")) return;
    DB.transactions = DB.transactions.filter(function (t) { return t.id !== id; });
    saveDB();
    if (Cloud.isConnected()) Cloud.deleteTransaction(id).catch(cloudErr);
    renderActiveTab();
    toast("Transakce smazána");
  }

  function cloudErr(e) { toast("Cloud chyba: " + e.message); }

  // ---------- Import from bank statement ----------

  var LEARNED_KEY = "tomasfinance.importrules";
  var imp = { rows: [], info: null, onlyUncertain: false };

  function loadLearned() {
    try { return JSON.parse(localStorage.getItem(LEARNED_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveLearned(o) {
    try { localStorage.setItem(LEARNED_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
  }

  function importCtx() {
    return { categories: DB.categories, learned: loadLearned() };
  }

  function defaultEssentialFor(cat) {
    return DEFAULT_ESSENTIAL.hasOwnProperty(cat) ? DEFAULT_ESSENTIAL[cat] : true;
  }

  function processImport(text, opts) {
    var res = Importer.parse(text, opts);
    var ctx = importCtx();
    imp.info = { skipped: res.skipped, mode: res.mode, check: res.check };
    imp.rows = res.rows.map(function (r) {
      var c = Importer.categorize(r.desc, r.amount, ctx);
      var abs = Math.abs(r.amount);
      var dup = DB.transactions.some(function (t) {
        return t.date === r.date && (t.type === "income") === (c.type === "income") && Math.abs(t.amount - abs) < 0.005;
      });
      return {
        date: r.date, desc: r.desc, note: Importer.cleanNote(r.desc), amount: abs,
        type: c.type, category: c.category,
        essential: c.type === "expense" ? (c.essential != null ? c.essential : defaultEssentialFor(c.category)) : null,
        conf: c.conf, dup: dup, transfer: c.transfer, currency: r.currency, edited: false,
        checked: !dup && !c.transfer && !r.currency
      };
    });
    renderImportPreview();
  }

  function impOpt(value, label, selected) {
    return '<option value="' + escapeHtml(value) + '"' + (selected ? " selected" : "") + ">" + escapeHtml(label) + "</option>";
  }

  function renderLearnedInfo() {
    var el = document.getElementById("imp-learned");
    if (!el) return;
    var n = Object.keys(loadLearned()).length;
    el.innerHTML = n
      ? 'Naučená pravidla z tvých oprav: ' + n + ' · <a href="#" data-act="clear-learned" style="color:var(--accent);">smazat</a>'
      : "Když v náhledu něco opravíš, appka si to zapamatuje a příště to rovnou zařadí správně.";
  }

  function importCheckHtml() {
    var c = imp.info && imp.info.check;
    if (!c) return "";
    function k(n) { return n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " Kč"; }
    var e = c.expected, a = c.actual;
    var base = "padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:10px;";
    if (c.ok) {
      return '<div style="' + base + 'background:var(--income-bg);color:var(--income);">✓ Kontrola proti výpisu sedí: ' +
        a.nCredit + " příjmových a " + a.nDebit + " výdajových položek, příjmy " + k(a.income) + ", výdaje " + k(a.expense) + ".</div>";
    }
    return '<div style="' + base + 'background:var(--expense-bg);color:var(--waste);">⚠ Součty nesedí s výpisem. Výpis uvádí ' +
      e.nCredit + " příjmů (" + k(e.income) + ") a " + e.nDebit + " výdajů (" + k(e.expense) + "), appka našla " +
      a.nCredit + " příjmů (" + k(a.income) + ") a " + a.nDebit + " výdajů (" + k(a.expense) + "). Zkontroluj, jestli nechybí nějaká položka.</div>";
  }

  function importSummaryHtml() {
    var c = { income: 0, expense: 0, investment: 0 }, unsure = 0, dups = 0, sel = 0;
    imp.rows.forEach(function (r) {
      c[r.type]++;
      if (r.conf === "guess") unsure++;
      if (r.dup) dups++;
      if (r.checked) sel++;
    });
    return "Nalezeno <b>" + imp.rows.length + "</b> položek (" + c.expense + " výdajů, " + c.income + " příjmů, " + c.investment + " investic)" +
      (unsure ? ' · <span style="color:var(--essential);">' + unsure + " k zkontrolování</span>" : "") +
      (dups ? ' · <span style="color:var(--waste);">' + dups + " možných duplikátů</span>" : "") +
      (imp.info && imp.info.skipped ? " · přeskočeno řádků: " + imp.info.skipped : "") +
      ' · vybráno <b id="imp-sel-count">' + sel + "</b>";
  }

  function renderImportPreview() {
    var box = document.getElementById("imp-preview");
    renderLearnedInfo();
    if (!imp.info) { box.innerHTML = ""; return; }
    if (!imp.rows.length) {
      box.innerHTML = '<div class="tip">Nepodařilo se najít žádné transakce. U každé položky musí být datum (např. 07.07.2026) a částka (např. -250,00). Zkus zkopírovat přímo tabulku pohybů, nebo exportovat CSV z bankovnictví.</div>';
      return;
    }
    var rowsHtml = imp.rows.map(function (r, i) {
      if (imp.onlyUncertain && r.conf !== "guess" && !r.dup && !r.transfer && !r.currency) return "";
      var cats = DB.categories[r.type] || [];
      if (cats.indexOf(r.category) === -1) cats = cats.concat([r.category]);
      var badges = "";
      if (r.conf === "guess") badges += '<span class="badge warn">zkontroluj</span> ';
      if (r.conf === "learned") badges += '<span class="badge good">naučeno</span> ';
      if (r.dup) badges += '<span class="badge bad">možný duplikát</span> ';
      if (r.transfer) badges += '<span class="badge warn">vlastní převod?</span> ';
      if (r.currency) badges += '<span class="badge warn">' + escapeHtml(r.currency) + " – přepočti</span> ";
      var cell = 'style="padding:6px 8px;font-size:12.5px;min-width:105px;"';
      return '<tr' + (r.conf === "guess" ? ' style="background:rgba(243,184,85,0.06);"' : "") + ">" +
        '<td><input type="checkbox" data-i="' + i + '" data-f="checked"' + (r.checked ? " checked" : "") + ' style="width:auto;"></td>' +
        "<td>" + r.date + "</td>" +
        '<td><input type="text" data-i="' + i + '" data-f="note" value="' + escapeHtml(r.note) + '" title="' + escapeHtml(r.desc) + '" style="min-width:220px;padding:6px 8px;font-size:12.5px;"></td>' +
        '<td><select data-i="' + i + '" data-f="type" ' + cell + ">" + impOpt("income", "Příjem", r.type === "income") + impOpt("expense", "Výdaj", r.type === "expense") + impOpt("investment", "Investice", r.type === "investment") + "</select></td>" +
        '<td><select data-i="' + i + '" data-f="category" ' + cell + ">" + cats.map(function (c) { return impOpt(c, c, c === r.category); }).join("") + "</select></td>" +
        "<td>" + (r.type === "expense"
          ? '<select data-i="' + i + '" data-f="essential" ' + cell + ">" + impOpt("1", "Nutné", r.essential) + impOpt("0", "Zbytečnost", !r.essential) + "</select>"
          : "—") + "</td>" +
        '<td><input type="number" data-i="' + i + '" data-f="amount" value="' + r.amount + '" step="0.01" min="0" style="width:105px;padding:6px 8px;font-size:12.5px;"></td>' +
        "<td>" + badges + "</td></tr>";
    }).join("");

    box.innerHTML =
      importCheckHtml() +
      '<div style="font-size:13px;margin-bottom:10px;" id="imp-summary">' + importSummaryHtml() + "</div>" +
      '<div class="btn-row" style="margin:0 0 10px;align-items:center;">' +
      '<button type="button" class="btn secondary small" data-act="sel-all">Vybrat vše</button>' +
      '<button type="button" class="btn secondary small" data-act="sel-none">Zrušit výběr</button>' +
      '<button type="button" class="btn secondary small" data-act="flip-all" title="Použij, když výpis neobsahuje znaménka a vše vyšlo jako příjem/výdaj">Obrátit příjem ↔ výdaj</button>' +
      '<label style="display:flex;align-items:center;gap:6px;margin:0;font-size:12.5px;"><input type="checkbox" data-f="onlyUncertain"' + (imp.onlyUncertain ? " checked" : "") + ' style="width:auto;"> Jen k zkontrolování</label>' +
      "</div>" +
      '<div class="table-wrap"><table><thead><tr><th></th><th>Datum</th><th>Popis</th><th>Typ</th><th>Kategorie</th><th>Klasifikace</th><th>Částka (Kč)</th><th>Stav</th></tr></thead><tbody>' + rowsHtml + "</tbody></table></div>" +
      '<div class="btn-row" style="margin-top:12px;">' +
      '<button type="button" class="btn" data-act="commit">Importovat vybrané</button>' +
      '<button type="button" class="btn secondary" data-act="cancel">Zrušit</button>' +
      "</div>";
  }

  function onImportChange(e) {
    var el = e.target, f = el.dataset.f;
    if (!f) return;
    if (f === "onlyUncertain") { imp.onlyUncertain = el.checked; renderImportPreview(); return; }
    var r = imp.rows[parseInt(el.dataset.i, 10)];
    if (!r) return;
    if (f === "checked") {
      r.checked = el.checked;
      document.getElementById("imp-sel-count").textContent = imp.rows.filter(function (x) { return x.checked; }).length;
    } else if (f === "note") {
      r.note = el.value;
    } else if (f === "amount") {
      r.amount = Math.abs(parseFloat(el.value)) || 0;
    } else if (f === "type") {
      r.type = el.value;
      var s = Importer.suggestFor(r.desc, r.type, importCtx());
      r.category = s.category;
      r.conf = "edited";
      r.essential = r.type === "expense" ? defaultEssentialFor(r.category) : null;
      r.edited = true;
      renderImportPreview();
    } else if (f === "category") {
      r.category = el.value;
      r.conf = "edited";
      if (r.type === "expense") r.essential = defaultEssentialFor(r.category);
      r.edited = true;
      renderImportPreview();
    } else if (f === "essential") {
      r.essential = el.value === "1";
      r.edited = true;
    }
  }

  function flipImportRows() {
    var ctx = importCtx();
    imp.rows.forEach(function (r) {
      r.type = r.type === "income" ? "expense" : "income";
      var s = Importer.suggestFor(r.desc, r.type, ctx);
      r.category = s.category;
      r.conf = s.conf;
      r.essential = r.type === "expense" ? defaultEssentialFor(r.category) : null;
    });
    renderImportPreview();
  }

  function commitImport() {
    var chosen = imp.rows.filter(function (r) { return r.checked && r.amount > 0; });
    if (!chosen.length) { toast("Nic není vybráno k importu"); return; }
    var learned = loadLearned(), nLearn = 0, added = [];
    chosen.forEach(function (r) {
      var t = { id: uid(), type: r.type, date: r.date, category: r.category, amount: r.amount, note: r.note || "", essential: r.type === "expense" ? !!r.essential : null };
      DB.transactions.push(t);
      added.push(t);
      if (r.edited) {
        var k = Importer.keyOf(r.desc);
        if (k) { learned[k] = { type: r.type, category: r.category, essential: t.essential }; nLearn++; }
      }
    });
    saveDB();
    saveLearned(learned);
    if (Cloud.isConnected()) added.forEach(function (t) { Cloud.upsertTransaction(t).catch(cloudErr); });
    imp.rows = [];
    imp.info = null;
    document.getElementById("imp-text").value = "";
    renderImportPreview();
    renderActiveTab();
    toast("Importováno " + added.length + " transakcí" + (nLearn ? " · zapamatováno pravidel: " + nLearn : ""));
  }

  function showImportMessage(html) {
    imp.rows = [];
    imp.info = null;
    document.getElementById("imp-preview").innerHTML = '<div class="tip">' + html + "</div>";
  }

  function readPdfFile(file) {
    showImportMessage("Čtu PDF…");
    var reader = new FileReader();
    reader.onload = function () {
      Importer.pdfToText(reader.result).then(function (text) {
        if (!text.trim()) {
          showImportMessage("V tomhle PDF jsem nenašel žádný text — pravděpodobně jde o sken (obrázek). Zkus v bankovnictví jiný export (CSV), nebo text z PDF zkopíruj ručně.");
          return;
        }
        document.getElementById("imp-text").value = text;
        processImport(text, { pdf: true });
      }).catch(function (err) {
        var msg = err && err.name === "PasswordException"
          ? "PDF je chráněné heslem. Otevři ho ve čtečce PDF, zkopíruj text a vlož ho do pole výše."
          : (err && err.message) ? err.message : "PDF se nepodařilo přečíst.";
        showImportMessage(escapeHtml(msg));
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function readStatementFile(file) {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) { readPdfFile(file); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var buf = reader.result, text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) {
        try { text = new TextDecoder("windows-1250").decode(buf); } catch (e2) { text = new TextDecoder().decode(buf); }
      }
      document.getElementById("imp-text").value = text;
      processImport(text);
    };
    reader.readAsArrayBuffer(file);
  }

  function initImport() {
    document.getElementById("imp-parse").addEventListener("click", function () {
      var text = document.getElementById("imp-text").value;
      if (!text.trim()) { toast("Nejdřív vlož text výpisu"); return; }
      processImport(text);
    });
    document.getElementById("imp-clear").addEventListener("click", function () {
      imp.rows = []; imp.info = null;
      document.getElementById("imp-text").value = "";
      renderImportPreview();
    });
    document.getElementById("imp-file").addEventListener("change", function (e) {
      if (e.target.files[0]) readStatementFile(e.target.files[0]);
      e.target.value = "";
    });
    var card = document.getElementById("import-card");
    card.addEventListener("change", onImportChange);
    card.addEventListener("click", function (e) {
      var el = e.target.closest("[data-act]");
      if (!el) return;
      var act = el.dataset.act;
      if (act === "clear-learned") {
        e.preventDefault();
        if (confirm("Smazat všechna naučená pravidla? Appka pak bude kategorie hádat znovu od nuly.")) { saveLearned({}); renderLearnedInfo(); }
      } else if (act === "sel-all" || act === "sel-none") {
        imp.rows.forEach(function (r) { r.checked = act === "sel-all"; });
        renderImportPreview();
      } else if (act === "flip-all") flipImportRows();
      else if (act === "commit") commitImport();
      else if (act === "cancel") { imp.rows = []; imp.info = null; renderImportPreview(); }
    });
    renderLearnedInfo();
  }

  // ---------- Compare tab ----------

  function renderCompareTab() {
    var months = getAllMonths();
    if (!ui.compareMonths) ui.compareMonths = months.slice(-6);

    document.getElementById("cmp-chips").innerHTML = months.map(function (m) {
      var active = ui.compareMonths.indexOf(m) !== -1;
      return '<button class="month-chip' + (active ? " active" : "") + '" data-action="toggle-month" data-month="' + m + '">' + monthLabel(m) + "</button>";
    }).join("");

    var selected = months.filter(function (m) { return ui.compareMonths.indexOf(m) !== -1; });

    if (selected.length === 0) {
      document.getElementById("cmp-bar-chart").innerHTML = '<div class="empty-state">Vyber alespoň jeden měsíc k porovnání</div>';
      document.getElementById("cmp-table-container").innerHTML = "";
      return;
    }

    var barData = selected.map(function (m) {
      var s = computeMonthStats(m);
      return { label: monthLabelShort(m), income: s.income, expense: s.expense, investment: s.investment };
    });
    document.getElementById("cmp-bar-chart").innerHTML = Charts.groupedBars(barData, { height: 260 });

    var prevStats = null;
    var rows = selected.map(function (m) {
      var s = computeMonthStats(m);
      var deltaCashflow = prevStats ? deltaCell(s.cashflow, prevStats.cashflow) : "";
      prevStats = s;
      return "<tr><td>" + monthLabel(m) + '</td><td class="amount income">' + fmtMoney(s.income) + '</td><td class="amount expense">' + fmtMoney(s.expense) +
        '</td><td class="amount investment">' + fmtMoney(s.investment) + "</td><td>" + fmtMoney(s.cashflow) + deltaCell(s.cashflow, null, true) +
        "</td><td>" + fmtPct(s.savingsRate) + "</td><td>" + fmtPct(s.investRate) + "</td></tr>";
    });

    document.getElementById("cmp-table-container").innerHTML = '<div class="table-wrap"><table><thead><tr>' +
      "<th>Měsíc</th><th>Příjmy</th><th>Výdaje</th><th>Investice</th><th>Cash flow</th><th>Míra úspor</th><th>Míra investic</th>" +
      "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
  }

  function deltaCell(cur, prev) {
    return "";
  }

  // ---------- Settings tab ----------

  function renderSettingsTab() {
    renderCloudSection();
    ["income", "expense", "investment"].forEach(function (type) {
      var list = document.getElementById("cat-list-" + type);
      list.innerHTML = DB.categories[type].map(function (c) {
        return "<li><span>" + escapeHtml(c) + '</span><button class="icon-btn del" data-action="delete-cat" data-type="' + type + '" data-cat="' + escapeHtml(c) + '" title="Smazat">×</button></li>';
      }).join("");
    });
    document.getElementById("set-invest-goal").value = DB.investmentGoalPercent;
  }

  function addCategory(type, name) {
    name = name.trim();
    if (!name) return;
    if (DB.categories[type].indexOf(name) !== -1) { toast("Kategorie už existuje"); return; }
    DB.categories[type].push(name);
    saveDB();
    if (Cloud.isConnected()) Cloud.saveSettings({ categories: DB.categories }).catch(cloudErr);
    renderSettingsTab();
    toast("Kategorie přidána");
  }

  function deleteCategory(type, name) {
    if (DB.categories[type].length <= 1) { toast("Musí zůstat alespoň jedna kategorie"); return; }
    if (!confirm('Smazat kategorii "' + name + '"? Existující transakce si ponechají svůj název kategorie.')) return;
    DB.categories[type] = DB.categories[type].filter(function (c) { return c !== name; });
    saveDB();
    if (Cloud.isConnected()) Cloud.saveSettings({ categories: DB.categories }).catch(cloudErr);
    renderSettingsTab();
  }

  function renderCloudSection() {
    var el = document.getElementById("cloud-status");
    if (!el) return;
    if (Cloud.isConnected()) {
      el.innerHTML =
        '<div class="badge good" style="margin-bottom:10px;">☁️ Připojeno</div>' +
        '<p style="font-size:13px;color:var(--text-dim);">Tento kód zadej i na dalších zařízeních (Nastavení → Cloud sync → Připojit) a uvidíš na nich stejná data.</p>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:10px 0;">' +
        '<div style="font-family:monospace;font-size:22px;font-weight:800;letter-spacing:3px;background:var(--bg-soft);border:1px solid var(--card-border);border-radius:8px;padding:8px 16px;">' + Cloud.getCode() + '</div>' +
        '<button class="btn secondary small" data-cloud-action="copy">Kopírovat</button>' +
        '</div>' +
        '<button class="btn danger small" data-cloud-action="disconnect">Odpojit tohle zařízení</button>';
    } else if (!Cloud.isAvailable()) {
      el.innerHTML = '<p style="font-size:13px;color:var(--text-dim);">Cloudová synchronizace zatím není nastavená — postupuj podle návodu v <code>README.md</code> (založení Firebase projektu zdarma a vyplnění <code>firebase-config.js</code>).</p>';
    } else {
      el.innerHTML =
        '<div class="field-row">' +
        '<div>' +
        '<p style="font-size:13px;color:var(--text-dim);margin:0 0 8px;">Poprvé nastavuješ sync? Vytvoř nový prostor — nahraješ do něj data z tohoto zařízení.</p>' +
        '<button class="btn small" data-cloud-action="create">Vytvořit nový cloud prostor</button>' +
        '</div>' +
        '<div>' +
        '<p style="font-size:13px;color:var(--text-dim);margin:0 0 8px;">Máš kód z jiného zařízení? Připoj se k němu (nahradí data v tomto zařízení).</p>' +
        '<div style="display:flex;gap:8px;">' +
        '<input type="text" id="cloud-join-input" placeholder="např. K7QX2M9P" style="text-transform:uppercase;">' +
        '<button class="btn secondary small" data-cloud-action="join">Připojit</button>' +
        '</div>' +
        '</div>' +
        '</div>';
    }
  }

  function handleCloudData(data) {
    DB.categories = data.categories || DB.categories;
    DB.portfolioValues = data.portfolioValues || {};
    DB.investmentGoalPercent = data.investmentGoalPercent || DB.investmentGoalPercent;
    DB.transactions = data.transactions || [];
    saveDB();
    renderActiveTab();
  }

  function cloudCreateSpace() {
    if (!Cloud.isAvailable()) { toast("Nastav Firebase konfiguraci ve firebase-config.js"); return; }
    if (!confirm("Vytvořit nový cloudový prostor a nahrát do něj aktuální data z tohoto zařízení?")) return;
    Cloud.createSpace(DB, handleCloudData).then(function () {
      toast("Cloud prostor vytvořen");
      renderSettingsTab();
    }).catch(cloudErr);
  }

  function cloudJoinSpace(codeInput) {
    if (!Cloud.isAvailable()) { toast("Nastav Firebase konfiguraci ve firebase-config.js"); return; }
    if (!(codeInput || "").trim()) { toast("Zadej kód"); return; }
    if (!confirm("Připojení nahradí data v tomto zařízení daty z cloudového prostoru. Pokračovat?")) return;
    Cloud.joinSpace(codeInput, handleCloudData).then(function () {
      toast("Připojeno k cloudu");
      renderSettingsTab();
    }).catch(cloudErr);
  }

  function cloudDisconnectUI() {
    if (!confirm("Odpojit tohle zařízení od cloudové synchronizace? Data zůstanou lokálně uložená, ale přestanou se sdílet.")) return;
    Cloud.disconnect();
    renderSettingsTab();
    toast("Cloud sync vypnut");
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tomasfinance-export-" + todayISO() + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function importData(file) {
    if (Cloud.isConnected()) { alert("Nejdřív se odpoj od cloudové synchronizace (Nastavení → Cloud sync → Odpojit), pak teprve importuj zálohu."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.transactions)) throw new Error("invalid");
        if (!confirm("Import nahradí všechna současná data. Pokračovat?")) return;
        DB = Object.assign(defaultDB(), parsed, { categories: Object.assign(defaultDB().categories, parsed.categories || {}) });
        saveDB();
        renderActiveTab();
        toast("Data importována");
      } catch (e) {
        alert("Soubor se nepodařilo načíst — zkontroluj, že jde o platný export z této aplikace.");
      }
    };
    reader.readAsText(file);
  }

  function resetAllData() {
    if (Cloud.isConnected()) { alert("Nejdřív se odpoj od cloudové synchronizace (Nastavení → Cloud sync → Odpojit), pak teprve smaž data."); return; }
    if (!confirm("Opravdu smazat ÚPLNĚ VŠECHNA data? Tuto akci nelze vrátit zpět.")) return;
    DB = defaultDB();
    saveDB();
    renderActiveTab();
    toast("Data byla vymazána");
  }

  // ---------- init & events ----------

  function init() {
    document.querySelectorAll(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    document.getElementById("dash-month").addEventListener("change", function (e) {
      ui.dashboardMonth = e.target.value;
      renderDashboard();
    });
    document.getElementById("dash-portfolio-rows").addEventListener("change", function (e) {
      var input = e.target.closest(".portfolio-cat-input");
      if (!input) return;
      var cat = input.dataset.category;
      if (input.value === "") delete DB.portfolioValues[cat];
      else DB.portfolioValues[cat] = parseFloat(input.value);
      saveDB();
      if (Cloud.isConnected()) Cloud.saveSettings({ portfolioValues: DB.portfolioValues }).catch(cloudErr);
      renderPortfolioCard();
    });

    document.querySelectorAll(".type-toggle button").forEach(function (b) {
      b.addEventListener("click", function () { setFormType(b.dataset.type); });
    });
    document.getElementById("f-category").addEventListener("change", maybeSetDefaultEssential);
    document.querySelectorAll(".essential-toggle button").forEach(function (b) {
      b.addEventListener("click", function () { setEssentialToggle(b.dataset.val === "1"); });
    });

    document.getElementById("tx-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var type = e.target.dataset.type;
      var date = document.getElementById("f-date").value || todayISO();
      var category = document.getElementById("f-category").value;
      var amount = parseFloat(document.getElementById("f-amount").value);
      var note = document.getElementById("f-note").value;
      if (!amount || amount <= 0) { toast("Zadej platnou částku"); return; }
      var essential = type === "expense" ? document.getElementById("f-essential-wrap").dataset.val === "1" : null;

      if (ui.editingId) {
        var t = DB.transactions.find(function (x) { return x.id === ui.editingId; });
        Object.assign(t, { type: type, date: date, category: category, amount: amount, note: note, essential: essential });
        if (Cloud.isConnected()) Cloud.upsertTransaction(t).catch(cloudErr);
        toast("Transakce upravena");
      } else {
        var newT = { id: uid(), type: type, date: date, category: category, amount: amount, note: note, essential: essential };
        DB.transactions.push(newT);
        if (Cloud.isConnected()) Cloud.upsertTransaction(newT).catch(cloudErr);
        toast("Transakce přidána");
      }
      saveDB();
      resetForm();
      renderActiveTab();
    });

    document.getElementById("tx-cancel-edit").addEventListener("click", resetForm);

    document.getElementById("flt-month").addEventListener("change", function (e) { ui.txFilters.month = e.target.value; renderTransactionsTab(); });
    document.getElementById("flt-category").addEventListener("change", function (e) { ui.txFilters.category = e.target.value; renderTransactionsTab(); });
    document.getElementById("flt-essential").addEventListener("change", function (e) { ui.txFilters.essential = e.target.value; renderTransactionsTab(); });
    document.getElementById("flt-search").addEventListener("input", function (e) { ui.txFilters.search = e.target.value; renderTransactionsTab(); });
    ["income", "expense", "investment"].forEach(function (t) {
      document.getElementById("chip-" + t).addEventListener("click", function () {
        ui.txFilters[t] = !ui.txFilters[t];
        renderTransactionsTab();
      });
    });
    document.getElementById("flt-reset").addEventListener("click", function () {
      ui.txFilters = { month: "all", income: true, expense: true, investment: true, essential: "all", category: "all", search: "", sortBy: "date", sortDir: "desc" };
      renderTransactionsTab();
    });

    document.getElementById("tx-table-container").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "edit") startEdit(btn.dataset.id);
      if (btn.dataset.action === "delete") deleteTransaction(btn.dataset.id);
    });

    document.querySelectorAll("#tab-transactions th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var field = th.dataset.sort;
        if (ui.txFilters.sortBy === field) ui.txFilters.sortDir = ui.txFilters.sortDir === "asc" ? "desc" : "asc";
        else { ui.txFilters.sortBy = field; ui.txFilters.sortDir = "desc"; }
        renderTransactionsTab();
      });
    });

    document.getElementById("cmp-chips").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action='toggle-month']");
      if (!btn) return;
      var m = btn.dataset.month;
      var idx = ui.compareMonths.indexOf(m);
      if (idx === -1) ui.compareMonths.push(m); else ui.compareMonths.splice(idx, 1);
      renderCompareTab();
    });
    document.querySelectorAll("#cmp-quick button").forEach(function (b) {
      b.addEventListener("click", function () {
        var months = getAllMonths();
        var n = b.dataset.n;
        ui.compareMonths = n === "all" ? months.slice() : months.slice(-parseInt(n, 10));
        renderCompareTab();
      });
    });

    document.getElementById("cat-manager").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-action='delete-cat']");
      if (!btn) return;
      deleteCategory(btn.dataset.type, btn.dataset.cat);
    });
    ["income", "expense", "investment"].forEach(function (type) {
      document.getElementById("cat-add-btn-" + type).addEventListener("click", function () {
        var input = document.getElementById("cat-add-input-" + type);
        addCategory(type, input.value);
        input.value = "";
      });
      document.getElementById("cat-add-input-" + type).addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); document.getElementById("cat-add-btn-" + type).click(); }
      });
    });

    document.getElementById("set-invest-goal").addEventListener("change", function (e) {
      DB.investmentGoalPercent = parseFloat(e.target.value) || 20;
      saveDB();
      if (Cloud.isConnected()) Cloud.saveSettings({ investmentGoalPercent: DB.investmentGoalPercent }).catch(cloudErr);
    });

    document.getElementById("cloud-card").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-cloud-action]");
      if (!btn) return;
      var action = btn.dataset.cloudAction;
      if (action === "create") cloudCreateSpace();
      else if (action === "join") cloudJoinSpace(document.getElementById("cloud-join-input").value);
      else if (action === "disconnect") cloudDisconnectUI();
      else if (action === "copy") {
        navigator.clipboard.writeText(Cloud.getCode()).then(function () { toast("Kód zkopírován"); }).catch(function () { toast("Kopírování se nezdařilo, opiš kód ručně"); });
      }
    });

    Cloud.setToastHandler(toast);
    Cloud.autoReconnect(handleCloudData).then(function (ok) {
      if (ok) { renderActiveTab(); if (ui.tab === "settings") renderSettingsTab(); }
    });
    document.getElementById("btn-export").addEventListener("click", exportData);
    document.getElementById("import-file").addEventListener("change", function (e) {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    });
    document.getElementById("btn-reset").addEventListener("click", resetAllData);

    initImport();

    resetForm();
    renderActiveTab();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
