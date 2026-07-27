/* Builds the versions table from the apps S3 catalog (single Rock N Roller
 * entry): wasm (browser play) + desktop zips (macOS arm64/x86_64, Windows).
 * Browser play links use path style (/0.1.35/, /latest/); desktop zips
 * download straight from S3. Fails loudly if the catalog cannot be fetched.
 * Narrow screens: one table-level "Toggle SHA Key" expands/collapses all
 * SHA-256 values (truncated by default). Wide screens show full hashes.
 * Zip cells show size like the stuff catalog ("zip · 5.2 MB").
 */
(function () {
  "use strict";

  var BASE = "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com";
  var tbody = document.getElementById("versionsBody");
  var errEl = document.getElementById("versionsError");
  var wrap = document.getElementById("versionsWrap");
  var shaToggle = document.getElementById("versionsShaToggle");

  function fail(msg) {
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

  if (!wrap || !shaToggle) fail("versions page missing Toggle SHA Key controls");

  shaToggle.addEventListener("click", function () {
    var expanded = wrap.classList.toggle("sha-expanded");
    shaToggle.setAttribute("aria-pressed", expanded ? "true" : "false");
  });

  getJSON(BASE + "/apps/released/catalog.json").then(function (doc) {
    var versions = ((doc.apps || {}).rocknroller || {}).versions || {};
    var keys = Object.keys(versions);
    keys.sort(function (a, b) {
      return b.localeCompare(a, undefined, { numeric: true });
    });
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
  });
})();
