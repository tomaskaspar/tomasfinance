/* Small dependency-free SVG chart helpers. Everything returns an HTML string. */
var Charts = (function () {

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // data: [{label, value, color}]
  function donut(data, size, thickness) {
    size = size || 190;
    thickness = thickness || 30;
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var r = size / 2;
    var rr = r - thickness / 2;
    var cx = r, cy = r;
    var paths = "";

    if (total <= 0) {
      paths = '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="' + thickness + '"/>';
    } else {
      var cumulate = 0;
      var gapDeg = data.length > 1 ? 2 : 0;
      data.forEach(function (d) {
        if (d.value <= 0) return;
        var frac = d.value / total;
        var startAngle = cumulate * 2 * Math.PI - Math.PI / 2;
        cumulate += frac;
        var endAngle = cumulate * 2 * Math.PI - Math.PI / 2 - (gapDeg * Math.PI / 180);
        if (endAngle <= startAngle) endAngle = startAngle + 0.001;
        var largeArc = (endAngle - startAngle) > Math.PI ? 1 : 0;
        var x1 = cx + rr * Math.cos(startAngle), y1 = cy + rr * Math.sin(startAngle);
        var x2 = cx + rr * Math.cos(endAngle), y2 = cy + rr * Math.sin(endAngle);
        if (frac >= 0.9995) {
          paths += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="none" stroke="' + d.color + '" stroke-width="' + thickness + '"><title>' + escapeHtml(d.label) + '</title></circle>';
        } else {
          paths += '<path d="M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A ' + rr.toFixed(2) + ' ' + rr.toFixed(2) + ' 0 ' + largeArc + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + '" fill="none" stroke="' + d.color + '" stroke-width="' + thickness + '" stroke-linecap="round"><title>' + escapeHtml(d.label) + '</title></path>';
        }
      });
    }
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="chart-donut">' + paths + '</svg>';
  }

  // months: [{label, income, expense, investment}]
  function groupedBars(months, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 260;
    var padLeft = 44, padBottom = 30, padTop = 14, padRight = 10;
    var innerW = w - padLeft - padRight, innerH = h - padTop - padBottom;
    var max = 1;
    months.forEach(function (m) {
      max = Math.max(max, m.income, m.expense, m.investment);
    });
    max = max * 1.15 || 1;
    var groupW = innerW / months.length;
    var barGap = 4;
    var barW = Math.max(6, (groupW - 16) / 3);

    var svg = "";
    // gridlines
    var gridLines = 4;
    for (var g = 0; g <= gridLines; g++) {
      var y = padTop + innerH - (innerH * g / gridLines);
      var val = (max * g / gridLines);
      svg += '<line x1="' + padLeft + '" y1="' + y.toFixed(1) + '" x2="' + (w - padRight) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
      svg += '<text x="' + (padLeft - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + fmtShort(val) + '</text>';
    }

    months.forEach(function (m, i) {
      var gx = padLeft + i * groupW + 8;
      var bars = [
        { v: m.income, color: "var(--income)" },
        { v: m.expense, color: "var(--expense)" },
        { v: m.investment, color: "var(--investment)" }
      ];
      bars.forEach(function (b, j) {
        var bh = (b.v / max) * innerH;
        var bx = gx + j * (barW + barGap);
        var by = padTop + innerH - bh;
        svg += '<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(0, bh).toFixed(1) + '" rx="3" fill="' + b.color + '"><title>' + escapeHtml(m.label) + ': ' + Math.round(b.v) + '</title></rect>';
      });
      svg += '<text x="' + (gx + (groupW - 16) / 2).toFixed(1) + '" y="' + (h - padBottom + 16) + '" text-anchor="middle">' + escapeHtml(m.label) + '</text>';
    });

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="bar-chart-svg" style="width:100%;height:auto;">' + svg + '</svg>';
  }

  // points: [{label, value}]
  function line(points, opts) {
    opts = opts || {};
    var w = opts.width || 640, h = opts.height || 220;
    var padLeft = 50, padBottom = 26, padTop = 16, padRight = 14;
    var innerW = w - padLeft - padRight, innerH = h - padTop - padBottom;
    var max = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1])) * 1.1;
    var min = Math.min(0, Math.min.apply(null, points.map(function (p) { return p.value; })));
    var range = (max - min) || 1;
    var stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

    function xy(i, v) {
      var x = padLeft + i * stepX;
      var y = padTop + innerH - ((v - min) / range) * innerH;
      return [x, y];
    }

    var gridLines = 4;
    var grid = "";
    for (var g = 0; g <= gridLines; g++) {
      var y = padTop + innerH - (innerH * g / gridLines);
      var val = min + (range * g / gridLines);
      grid += '<line x1="' + padLeft + '" y1="' + y.toFixed(1) + '" x2="' + (w - padRight) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>';
      grid += '<text x="' + (padLeft - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + fmtShort(val) + '</text>';
    }

    var pathD = "";
    var areaD = "";
    var dots = "";
    points.forEach(function (p, i) {
      var xy_ = xy(i, p.value);
      pathD += (i === 0 ? "M " : "L ") + xy_[0].toFixed(1) + " " + xy_[1].toFixed(1) + " ";
      dots += '<circle cx="' + xy_[0].toFixed(1) + '" cy="' + xy_[1].toFixed(1) + '" r="3.5" fill="var(--investment)"><title>' + escapeHtml(p.label) + ': ' + Math.round(p.value) + '</title></circle>';
      if (i % Math.max(1, Math.ceil(points.length / 8)) === 0 || i === points.length - 1) {
        grid += '<text x="' + xy_[0].toFixed(1) + '" y="' + (h - padBottom + 16) + '" text-anchor="middle">' + escapeHtml(p.label) + '</text>';
      }
    });
    var zeroY = xy(0, 0)[1];
    areaD = pathD + ' L ' + xy(points.length - 1, min)[0].toFixed(1) + ' ' + (padTop + innerH) + ' L ' + xy(0, min)[0].toFixed(1) + ' ' + (padTop + innerH) + ' Z';

    var svg = grid +
      '<path d="' + areaD + '" fill="var(--investment)" opacity="0.12"/>' +
      '<path d="' + pathD + '" fill="none" stroke="var(--investment)" stroke-width="2.5"/>' +
      dots;

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" class="bar-chart-svg" style="width:100%;height:auto;">' + svg + '</svg>';
  }

  function fmtShort(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
    return String(n);
  }

  return { donut: donut, groupedBars: groupedBars, line: line };
})();
