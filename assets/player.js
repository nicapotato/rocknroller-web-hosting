/* RockNRoller web player loader.
 *
 * The document stays on rocknroller.nicapotato.com; the game bytes
 * (RockNRoller.js / .wasm / .data) stream from S3. Three things make that work:
 *
 * 1. coi-serviceworker (same-origin, loaded before this script) supplies the
 *    COOP/COEP headers GitHub Pages cannot send, so SharedArrayBuffer/pthreads
 *    are available. First visit reloads once while the worker registers.
 * 2. Module.locateFile points every runtime asset request (.wasm, .data) at S3.
 *    The bucket allows CORS GET from this origin, which also satisfies COEP.
 * 3. pthread worker scripts must be same-origin, so the main JS is fetched as a
 *    Blob and handed to Module.mainScriptUrlOrBlob; blob: URLs inherit this
 *    page's origin. One download serves the main thread and every worker.
 *
 * Version resolution: window.RNR_VERSION (pinned pages) > ?v= query > "latest".
 * Demo pack: ?demo=true|True|1|yes fetches apps/released/rocknroller/demos/ after
 * weblib init; without the flag the engine stays song-free (Add Folder).
 * Fails loudly on any error - no fallbacks.
 */
(function () {
  "use strict";

  var S3_BASE =
    "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com/apps/released/rocknroller";
  var DEMOS_BASE = S3_BASE + "/demos/";

  var statusEl = document.getElementById("status");
  var badgeEl = document.getElementById("versionBadge");
  var params = new URLSearchParams(window.location.search);

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function clearStatus() {
    if (statusEl) {
      statusEl.remove();
      statusEl = null;
    }
  }

  function fail(msg) {
    setStatus("");
    if (statusEl) {
      statusEl.textContent = "ERROR: " + msg;
      statusEl.classList.add("player-status--error");
    }
    throw new Error(msg);
  }

  function demoEnabled() {
    var raw = params.get("demo");
    if (raw == null) return false;
    var v = String(raw).trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }

  var wantDemo = demoEnabled();

  var ver =
    window.RNR_VERSION ||
    params.get("v") ||
    "latest";
  ver = String(ver).trim();
  if (!/^[0-9A-Za-z.-]+$/.test(ver)) {
    fail("invalid version: " + ver);
  }

  var ASSET_BASE = S3_BASE + "/" + ver + "/web/";

  // Badge shows what is actually running; for "latest" the concrete version
  // comes from VERSION.txt, written next to the build by the publish step.
  function showBadge(text) {
    if (badgeEl) {
      badgeEl.textContent = text;
      badgeEl.hidden = false;
    }
  }
  if (ver === "latest") {
    fetch(ASSET_BASE + "VERSION.txt", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.text() : "";
      })
      .then(function (t) {
        showBadge("latest" + (t ? " (" + t.trim() + ")" : ""));
      })
      .catch(function () {
        showBadge("latest");
      });
  } else {
    showBadge(ver);
  }

  function loadDemos() {
    setStatus("downloading demos\u2026");
    return fetch(DEMOS_BASE + "catalog.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) {
          fail("could not fetch demo catalog (HTTP " + r.status + ")");
        }
        return r.json();
      })
      .then(function (catalog) {
        if (!catalog || !Array.isArray(catalog.songs) || catalog.songs.length === 0) {
          fail("demo catalog has no songs");
        }
        var urls = catalog.songs.map(function (s) {
          if (!s || typeof s.file !== "string" || !s.file) {
            fail("demo catalog entry missing file");
          }
          if (!/^[A-Za-z0-9._-]+_p\.psarc$/i.test(s.file)) {
            fail("demo catalog invalid file: " + s.file);
          }
          return DEMOS_BASE + s.file;
        });
        var lib = window.Module && window.Module.rnrWebLib;
        var grant =
          lib &&
          (lib.grantRemoteFolder || lib.testGrant);
        if (typeof grant !== "function") {
          fail("rnrWebLib.grantRemoteFolder unavailable (need a build with weblib remote grant)");
        }
        return grant.call(lib, "Demos", urls);
      })
      .then(function () {
        clearStatus();
      });
  }

  // Same Module shape as the build's own shell.html.
  window.Module = {
    canvas: (function () {
      var c = document.getElementById("canvas");
      c.addEventListener("webglcontextlost", function (e) {
        alert("WebGL context lost. Please reload the page.");
        e.preventDefault();
      });
      return c;
    })(),
    locateFile: function (path) {
      return ASSET_BASE + path;
    },
    setStatus: setStatus,
    onRuntimeInitialized: function () {
      if (!wantDemo) {
        clearStatus();
      }
      /* Demo load waits for onRnrWebLibReady (after rnr_weblib_init in main). */
    },
  };

  if (wantDemo) {
    var demosStarted = false;
    window.Module.onRnrWebLibReady = function () {
      if (demosStarted) return;
      demosStarted = true;
      loadDemos().catch(function (e) {
        fail(e && e.message ? e.message : "demo download failed");
      });
    };
    setTimeout(function () {
      if (!demosStarted) {
        fail(
          "weblib never became ready for demos (need a build that calls onRnrWebLibReady)"
        );
      }
    }, 45000);
  }

  setStatus("downloading " + ver + "\u2026");
  fetch(ASSET_BASE + "RockNRoller.js")
    .then(function (r) {
      if (!r.ok) {
        fail("could not fetch RockNRoller.js for '" + ver + "' (HTTP " + r.status + ")");
      }
      return r.blob();
    })
    .then(function (blob) {
      window.Module.mainScriptUrlOrBlob = blob;
      var s = document.createElement("script");
      s.src = URL.createObjectURL(blob);
      s.onerror = function () {
        fail("game script failed to execute");
      };
      document.body.appendChild(s);
    })
    .catch(function (e) {
      fail(e && e.message ? e.message : "download failed");
    });
})();
