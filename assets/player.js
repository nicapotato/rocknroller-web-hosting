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
 * Fails loudly on any error - no fallbacks.
 */
(function () {
  "use strict";

  var S3_BASE =
    "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com/apps/released/rocknroller";

  var statusEl = document.getElementById("status");
  var badgeEl = document.getElementById("versionBadge");

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function fail(msg) {
    setStatus("");
    if (statusEl) {
      statusEl.textContent = "ERROR: " + msg;
      statusEl.classList.add("player-status--error");
    }
    throw new Error(msg);
  }

  var ver =
    window.RNR_VERSION ||
    new URLSearchParams(window.location.search).get("v") ||
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
      if (statusEl) {
        statusEl.remove();
        statusEl = null;
      }
    },
  };

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
