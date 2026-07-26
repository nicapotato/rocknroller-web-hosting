/* Builds the versions table from the two S3 catalogs:
 *   games/released/catalog.json -> wasm (browser play) entries
 *   apps/released/catalog.json  -> desktop zip entries (macOS arm64/x86_64, Windows)
 * Browser play links stay on this domain (/play/?v=); desktop zips download
 * straight from S3. Fails loudly if a catalog cannot be fetched.
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

  Promise.all([
    getJSON(BASE + "/games/released/catalog.json"),
    getJSON(BASE + "/apps/released/catalog.json"),
  ]).then(function (res) {
    var web = ((res[0].games || {}).rocknroller || {}).versions || {};
    var apps = ((res[1].apps || {}).rocknroller || {}).versions || {};

    var keys = Object.keys(web);
    Object.keys(apps).forEach(function (k) {
      if (keys.indexOf(k) === -1) keys.push(k);
    });
    keys.sort(function (a, b) {
      return b.localeCompare(a, undefined, { numeric: true });
    });
    if (!keys.length) fail("no published versions found in either catalog");

    var rows = keys.map(function (v) {
      var w = web[v] || {};
      var a = apps[v] || {};
      var released = (w.released_at || a.released_at || "").slice(0, 10);
      var wasm = (w.platforms || {}).wasm;
      var p = a.platforms || {};

      var playCell = wasm
        ? '<td><a href="/play/?v=' + encodeURIComponent(v) + '">play</a></td>'
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
        zipCell(p.windows) +
        "</tr>"
      );
    });

    tbody.innerHTML = rows.join("");
  });
})();
