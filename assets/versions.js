/* Builds the versions table from the apps S3 catalog (single Rock N Roller
 * entry): wasm (browser play) + desktop zips (macOS arm64/x86_64, Windows).
 * Browser play links use path style (/0.1.35/, /latest/); desktop zips
 * download straight from S3. Fails loudly if the catalog cannot be fetched.
 * "Toggle SHA Key" expands/collapses every SHA-256 (truncated by default).
 * "Graph" plots those releases over time (detail, or one point per month).
 * Zip cells show size like the stuff catalog ("zip · 5.2 MB").
 */
(function () {
  "use strict";

  var BASE = "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com";
  var tbody = document.getElementById("versionsBody");
  var table = document.getElementById("versionsTable");
  var errEl = document.getElementById("versionsError");
  var wrap = document.getElementById("versionsWrap");
  var shaToggle = document.getElementById("versionsShaToggle");
  var graphToggle = document.getElementById("versionsGraphToggle");
  var graphPanel = document.getElementById("versionsGraph");
  var graphCanvas = document.getElementById("versionsGraphCanvas");
  var graphTip = document.getElementById("versionsGraphTooltip");
  var graphDetailBtn = document.getElementById("versionsGraphDetail");
  var graphMonthBtn = document.getElementById("versionsGraphMonth");

  function setBusy(busy) {
    if (table) table.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function fail(msg) {
    if (tbody) tbody.innerHTML = "";
    setBusy(false);
    errEl.textContent = "ERROR: " + msg;
    errEl.hidden = false;
    throw new Error(msg);
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) fail("HTTP " + r.status + " fetching " + url);
      return r.json();
    });
  }

  /** 38200000 -> "38.2 MB". Returns "" for missing/invalid input. */
  function formatBytes(n) {
    if (typeof n !== "number" || !isFinite(n) || n < 0) return "";
    if (n < 1024) return n + " B";
    var units = ["KB", "MB", "GB"];
    var v = n;
    var u = -1;
    do {
      v /= 1024;
      u++;
    } while (v >= 1024 && u < units.length - 1);
    return (v >= 100 ? Math.round(v) : v.toFixed(1)) + " " + units[u];
  }

  function shaBlock(sha) {
    if (!sha) return "";
    return (
      '<div class="sha cell-sha">' +
      '<code class="sha-full js-sha-full">' +
      sha +
      "</code>" +
      "</div>"
    );
  }

  function zipCell(entry) {
    if (!entry || !entry.zip_url) return '<td class="na">—</td>';
    var sizeText = formatBytes(entry.size_bytes);
    var sizeHtml = sizeText
      ? '<span class="zip-size"> · ' + sizeText + "</span>"
      : "";
    return (
      "<td>" +
      '<a class="zip-link" href="' +
      entry.zip_url +
      '">zip' +
      sizeHtml +
      "</a>" +
      shaBlock(entry.sha256) +
      "</td>"
    );
  }

  function versionCoreAndPre(ver) {
    var s = String(ver || "");
    var i = s.indexOf("-");
    if (i < 0) return { core: s, pre: "" };
    return { core: s.slice(0, i), pre: s.slice(i + 1) };
  }

  function compareVersionKeysDesc(a, b) {
    var pa = versionCoreAndPre(a);
    var pb = versionCoreAndPre(b);
    var coreCmp = pa.core.localeCompare(pb.core, undefined, { numeric: true });
    if (coreCmp !== 0) return -coreCmp;
    if (!pa.pre && pb.pre) return -1;
    if (pa.pre && !pb.pre) return 1;
    if (!pa.pre && !pb.pre) return 0;
    return pa.pre.localeCompare(pb.pre, undefined, { numeric: true });
  }

  function playCell(version, wasm) {
    if (!wasm) return '<td class="na">—</td>';
    return (
      "<td>" +
      '<a href="/' +
      encodeURIComponent(version) +
      '/">play</a>' +
      shaBlock(wasm.sha256) +
      "</td>"
    );
  }

  if (!tbody) fail("versions page missing table body");
  if (!wrap || !shaToggle) fail("versions page missing Toggle SHA Key controls");
  if (!graphToggle || !graphPanel || !graphCanvas || !graphTip || !graphDetailBtn || !graphMonthBtn) {
    fail("versions page missing Graph controls");
  }

  var graphCtx = graphCanvas.getContext("2d");
  if (!graphCtx) fail("versions graph canvas unavailable");

  /** @type {{version:string,core:string,pre:string,dev:boolean,major:number,minor:number,patch:number,t:number,day:string}[]} */
  var graphEvents = [];
  var graphMode = "detail";
  var graphHoverId = null;
  /** Plotted points from the last draw, in canvas CSS pixels. */
  var graphPlotted = [];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var GRAPH_PAD = { top: 18, right: 16, bottom: 36, left: 84 };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function yOf(ev) {
    return ev.major * 1000000 + ev.minor * 1000 + ev.patch;
  }

  function formatY(y) {
    var major = Math.floor(y / 1000000);
    var rem = y - major * 1000000;
    var minor = Math.floor(rem / 1000);
    var patch = Math.round(rem - minor * 1000);
    return major + "." + minor + "." + patch;
  }

  function parseRelease(version, releasedAt) {
    var parts = versionCoreAndPre(version);
    var sem = parts.core.match(/^(\d+)\.(\d+)\.(\d+)$/);
    var day = String(releasedAt || "").slice(0, 10);
    if (!sem || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    var t = Date.parse(day + "T00:00:00Z");
    if (!isFinite(t)) return null;
    return {
      version: String(version),
      core: parts.core,
      pre: parts.pre,
      dev: parts.pre.length > 0,
      major: +sem[1],
      minor: +sem[2],
      patch: +sem[3],
      t: t,
      day: day,
    };
  }

  function graphPoints() {
    var sorted = graphEvents.slice().sort(function (a, b) {
      if (a.t !== b.t) return a.t - b.t;
      return a.version.localeCompare(b.version, undefined, { numeric: true });
    });
    if (graphMode === "detail") return sorted;

    var byMonth = Object.create(null);
    for (var i = 0; i < sorted.length; i++) {
      var ev = sorted[i];
      var d = new Date(ev.t);
      var key = d.getUTCFullYear() + "-" + d.getUTCMonth();
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(ev);
    }
    return Object.keys(byMonth)
      .map(function (key) {
        var list = byMonth[key];
        var last = list[list.length - 1];
        return {
          version: last.version,
          core: last.core,
          pre: last.pre,
          dev: last.dev,
          major: last.major,
          minor: last.minor,
          patch: last.patch,
          t: last.t,
          day: last.day,
          count: list.length,
          versions: list.map(function (item) {
            return item.version;
          }),
          aggregated: true,
        };
      })
      .sort(function (a, b) {
        return a.t - b.t;
      });
  }

  function graphDomain(points) {
    var t0 = points[0].t;
    var t1 = points[0].t;
    var y0 = yOf(points[0]);
    var y1 = y0;
    for (var i = 1; i < points.length; i++) {
      if (points[i].t < t0) t0 = points[i].t;
      if (points[i].t > t1) t1 = points[i].t;
      var y = yOf(points[i]);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (t0 === t1) {
      t0 -= 86400000 * 14;
      t1 += 86400000 * 14;
    } else {
      var tPad = (t1 - t0) * 0.04;
      t0 -= tPad;
      t1 += tPad;
    }
    if (y0 === y1) {
      y0 -= 1;
      y1 += 1;
    } else {
      var yPad = Math.max(1, (y1 - y0) * 0.08);
      y0 -= yPad;
      y1 += yPad;
    }
    return { t0: t0, t1: t1, y0: y0, y1: y1 };
  }

  function yTicks(domain) {
    var span = domain.y1 - domain.y0;
    var raw = Math.max(1, span / 5);
    var step = raw <= 2 ? 1 : raw <= 5 ? 5 : raw <= 12 ? 10 : raw <= 25 ? 20 : Math.ceil(raw / 10) * 10;
    var start = Math.ceil(domain.y0 / step) * step;
    var ticks = [];
    for (var y = start; y <= domain.y1 + 0.001; y += step) {
      if (y >= 0) ticks.push(y);
    }
    return ticks;
  }

  function monthTicks(domain) {
    var start = new Date(domain.t0);
    var year = start.getUTCFullYear();
    var month = start.getUTCMonth();
    var cursor = Date.UTC(year, month, 1);
    var ticks = [];
    while (cursor <= domain.t1) {
      if (cursor >= domain.t0) ticks.push(cursor);
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      cursor = Date.UTC(year, month, 1);
    }
    return ticks;
  }

  function formatMonth(t) {
    var d = new Date(t);
    return MONTHS[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
  }

  function pointId(ev) {
    if (ev.aggregated) {
      var d = new Date(ev.t);
      return "m:" + d.getUTCFullYear() + "-" + d.getUTCMonth();
    }
    return "v:" + ev.version;
  }

  function drawGraph() {
    var cssW = graphCanvas.clientWidth || 800;
    var cssH = graphCanvas.clientHeight || 300;
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    graphCanvas.width = Math.round(cssW * dpr);
    graphCanvas.height = Math.round(cssH * dpr);
    graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    graphCtx.imageSmoothingEnabled = false;
    graphCtx.clearRect(0, 0, cssW, cssH);
    graphCtx.fillStyle = "#0d0d0d";
    graphCtx.fillRect(0, 0, cssW, cssH);

    var points = graphPoints();
    graphPlotted = [];
    if (!points.length) {
      graphCtx.fillStyle = "#ffde44";
      graphCtx.font = "16px m6x11, ui-monospace, monospace";
      graphCtx.textAlign = "center";
      graphCtx.textBaseline = "middle";
      graphCtx.fillText("No dated releases", cssW / 2, cssH / 2);
      return;
    }

    var domain = graphDomain(points);
    var plot = {
      x0: GRAPH_PAD.left,
      y0: GRAPH_PAD.top,
      x1: cssW - GRAPH_PAD.right,
      y1: cssH - GRAPH_PAD.bottom,
    };

    function xFor(t) {
      return plot.x0 + ((t - domain.t0) / (domain.t1 - domain.t0)) * (plot.x1 - plot.x0);
    }
    function yFor(y) {
      return plot.y1 - ((y - domain.y0) / (domain.y1 - domain.y0)) * (plot.y1 - plot.y0);
    }

    graphCtx.font = "16px m6x11, ui-monospace, monospace";
    graphCtx.lineWidth = 1;
    graphCtx.textBaseline = "middle";

    var yTickList = yTicks(domain);
    graphCtx.textAlign = "right";
    for (var yi = 0; yi < yTickList.length; yi++) {
      var gy = yFor(yTickList[yi]);
      graphCtx.strokeStyle = "#3a3a44";
      graphCtx.beginPath();
      graphCtx.moveTo(plot.x0, gy);
      graphCtx.lineTo(plot.x1, gy);
      graphCtx.stroke();
      graphCtx.fillStyle = "#9aa0a6";
      graphCtx.fillText(formatY(yTickList[yi]), plot.x0 - 8, gy);
    }

    var xTickList = monthTicks(domain);
    graphCtx.textAlign = "center";
    graphCtx.textBaseline = "top";
    var minLabelGap = 56;
    var lastLabelX = -999;
    for (var xi = 0; xi < xTickList.length; xi++) {
      var gx = xFor(xTickList[xi]);
      graphCtx.strokeStyle = "#3a3a44";
      graphCtx.beginPath();
      graphCtx.moveTo(gx, plot.y0);
      graphCtx.lineTo(gx, plot.y1);
      graphCtx.stroke();
      if (gx - lastLabelX < minLabelGap) continue;
      lastLabelX = gx;
      graphCtx.fillStyle = "#9aa0a6";
      graphCtx.fillText(formatMonth(xTickList[xi]), gx, plot.y1 + 10);
    }

    graphCtx.strokeStyle = "#ffde44";
    graphCtx.lineWidth = 2;
    graphCtx.beginPath();
    for (var pi = 0; pi < points.length; pi++) {
      var px = xFor(points[pi].t);
      var py = yFor(yOf(points[pi]));
      if (pi === 0) graphCtx.moveTo(px, py);
      else graphCtx.lineTo(px, py);
      graphPlotted.push({ ev: points[pi], x: px, y: py });
    }
    graphCtx.stroke();

    for (var mi = 0; mi < graphPlotted.length; mi++) {
      var mark = graphPlotted[mi];
      var hot = graphHoverId === pointId(mark.ev);
      var size = hot ? 9 : 7;
      var half = (size / 2) | 0;
      var mx = Math.round(mark.x) - half;
      var my = Math.round(mark.y) - half;
      graphCtx.fillStyle = mark.ev.dev ? "#e53935" : "#ffde44";
      graphCtx.fillRect(mx, my, size, size);
      if (hot) {
        graphCtx.strokeStyle = "#ffffff";
        graphCtx.lineWidth = 1;
        graphCtx.strokeRect(mx - 2, my - 2, size + 4, size + 4);
      }
    }
  }

  function graphHit(clientX, clientY) {
    var rect = graphCanvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var best = null;
    var bestD = 14;
    for (var i = 0; i < graphPlotted.length; i++) {
      var p = graphPlotted[i];
      var d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function showGraphTip(hit, clientX, clientY) {
    if (!hit) {
      graphTip.hidden = true;
      return;
    }
    var ev = hit.ev;
    var body;
    if (ev.aggregated) {
      body =
        escapeHtml(formatMonth(ev.t)) +
        "<br>" +
        ev.count +
        (ev.count === 1 ? " release" : " releases") +
        "<br>latest " +
        escapeHtml(ev.version);
    } else {
      body =
        escapeHtml(ev.version) +
        "<br>" +
        escapeHtml(ev.day) +
        "<br>" +
        (ev.dev ? "Dev" : "Release");
    }
    graphTip.hidden = false;
    graphTip.innerHTML = body;
    var wrapRect = graphCanvas.parentElement.getBoundingClientRect();
    var left = clientX - wrapRect.left + 12;
    var top = clientY - wrapRect.top + 12;
    if (left + graphTip.offsetWidth > wrapRect.width - 4) {
      left = clientX - wrapRect.left - graphTip.offsetWidth - 10;
    }
    if (top + graphTip.offsetHeight > wrapRect.height - 4) {
      top = clientY - wrapRect.top - graphTip.offsetHeight - 10;
    }
    graphTip.style.left = Math.max(4, left) + "px";
    graphTip.style.top = Math.max(4, top) + "px";
  }

  function setGraphMode(mode) {
    if (mode !== "detail" && mode !== "month") fail("unknown graph mode " + mode);
    graphMode = mode;
    graphHoverId = null;
    graphTip.hidden = true;
    graphDetailBtn.setAttribute("aria-pressed", mode === "detail" ? "true" : "false");
    graphMonthBtn.setAttribute("aria-pressed", mode === "month" ? "true" : "false");
    if (!graphPanel.hidden) drawGraph();
  }

  function setGraphEvents(versions) {
    var keys = Object.keys(versions || {});
    var next = [];
    for (var i = 0; i < keys.length; i++) {
      var entry = versions[keys[i]] || {};
      var parsed = parseRelease(keys[i], entry.released_at);
      if (parsed) next.push(parsed);
    }
    graphEvents = next;
    if (!graphPanel.hidden) drawGraph();
  }

  shaToggle.addEventListener("click", function () {
    var expanded = wrap.classList.toggle("sha-expanded");
    shaToggle.setAttribute("aria-pressed", expanded ? "true" : "false");
  });

  graphToggle.addEventListener("click", function () {
    var open = graphPanel.hidden;
    graphPanel.hidden = !open;
    graphToggle.setAttribute("aria-pressed", open ? "true" : "false");
    graphToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      graphHoverId = null;
      graphTip.hidden = true;
      return;
    }
    window.requestAnimationFrame(drawGraph);
  });

  graphDetailBtn.addEventListener("click", function () {
    setGraphMode("detail");
  });
  graphMonthBtn.addEventListener("click", function () {
    setGraphMode("month");
  });

  graphCanvas.addEventListener("pointermove", function (ev) {
    var hit = graphHit(ev.clientX, ev.clientY);
    var nextId = hit ? pointId(hit.ev) : null;
    if (nextId !== graphHoverId) {
      graphHoverId = nextId;
      drawGraph();
    }
    showGraphTip(hit, ev.clientX, ev.clientY);
    graphCanvas.style.cursor = hit ? "pointer" : "default";
  });

  graphCanvas.addEventListener("pointerleave", function () {
    graphHoverId = null;
    graphTip.hidden = true;
    graphCanvas.style.cursor = "default";
    if (!graphPanel.hidden) drawGraph();
  });

  window.addEventListener("resize", function () {
    if (!graphPanel.hidden) drawGraph();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (!graphPanel.hidden) drawGraph();
    });
  }

  getJSON(BASE + "/apps/released/catalog.json")
    .then(function (doc) {
      var versions = ((doc.apps || {}).rocknroller || {}).versions || {};
      var keys = Object.keys(versions);
      keys.sort(compareVersionKeysDesc);
      if (!keys.length) fail("no published versions found in apps catalog");

      var rows = keys.map(function (v) {
        var entry = versions[v] || {};
        var released = (entry.released_at || "").slice(0, 10);
        var p = entry.platforms || {};

        return (
          "<tr><td>" +
          v +
          "</td><td>" +
          (released || "—") +
          "</td>" +
          playCell(v, p.wasm) +
          zipCell(p.macos_arm64 || p.macos) +
          zipCell(p.macos_x86_64) +
          zipCell(p.windows_x86_64 || p.windows) +
          "</tr>"
        );
      });

      tbody.innerHTML = rows.join("");
      setBusy(false);
      setGraphEvents(versions);
    })
    .catch(function (err) {
      if (errEl && !errEl.hidden) return;
      fail(err && err.message ? err.message : String(err));
    });
})();
