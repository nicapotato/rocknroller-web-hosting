/* Builds the versions table from the apps S3 catalog (single Rock N Roller
 * entry): wasm (browser play) + desktop zips (macOS arm64/x86_64, Windows).
 * Browser play links use path style (/0.1.35/, /latest/); desktop zips
 * download straight from S3. Fails loudly if the catalog cannot be fetched.
 */
(function () {
  "use strict";

  var BASE = "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com";
  var tbody = document.getElementById("versionsBody");
  var errEl = document.getElementById("versionsError");

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

  function zipCell(entry) {
    if (!entry || !entry.zip_url) return '<td class="na">—</td>';
    var title = entry.sha256 ? ' title="sha256: ' + entry.sha256 + '"' : "";
    return '<td><a href="' + entry.zip_url + '"' + title + ">zip</a></td>";
  }

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
      var wasm = p.wasm;

      var playCell = wasm
        ? '<td><a href="/' + encodeURIComponent(v) + '/">play</a></td>'
        : '<td class="na">—</td>';

      return (
        "<tr><td>" +
        v +
        "</td><td>" +
        (released || "—") +
        "</td>" +
        playCell +
        zipCell(p.macos_arm64 || p.macos) +
        zipCell(p.macos_x86_64) +
        zipCell(p.windows_x86_64 || p.windows) +
        "</tr>"
      );
    });

    tbody.innerHTML = rows.join("");
  });
})();
