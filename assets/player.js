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
 * Version resolution: window.RNR_VERSION (from /latest/ or /0.1.35/ via 404)
 *   > legacy ?v= > "latest". Preferred URLs: /latest/, /0.1.35/.
 * Demo pack (after weblib init):
 *   ?demo=songs  — curated demo PSARCs only
 *   ?demo=stems  — PSARCs + 6-stem MP3 trees (~large extra download)
 * Without the flag the engine stays song-free (Add Folder).
 * Fails loudly on any error - no fallbacks.
 */
(function () {
  "use strict";

  var S3_BASE =
    "https://prod-nicapotato-public-software.s3.eu-west-2.amazonaws.com/apps/released/rocknroller";
  var DEMOS_BASE = S3_BASE + "/demos/";
  var STEMS_VROOT = "/weblib/stems";
  var STEM_NAMES = [
    "drums.mp3",
    "bass.mp3",
    "other.mp3",
    "vocals.mp3",
    "guitar.mp3",
    "piano.mp3",
  ];

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

  /* null = no demos; "songs" = PSARCs; "stems" = PSARCs + stem MP3s. */
  function parseDemoMode() {
    var raw = params.get("demo");
    if (raw == null) return null;
    var v = String(raw).trim().toLowerCase();
    if (v === "") return null;
    if (v === "songs") return "songs";
    if (v === "stems") return "stems";
    fail("invalid ?demo= value (use songs or stems): " + raw);
  }

  var demoMode = parseDemoMode();
  var wantDemo = demoMode !== null;
  var wantStems = demoMode === "stems";

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

  function psarcBasename(file) {
    if (typeof file !== "string" || !file.toLowerCase().endsWith(".psarc")) {
      fail("demo catalog invalid psarc file: " + file);
    }
    return file.slice(0, -6);
  }

  function setStemsDir() {
    if (typeof Module.ccall !== "function") {
      fail("Module.ccall unavailable for rnr_weblib_set_stems_dir");
    }
    Module.ccall("rnr_weblib_set_stems_dir", null, ["string"], [STEMS_VROOT]);
  }

  function memfs() {
    /* Emscripten may expose FS as a global (typical) or Module.FS. */
    var fs = typeof FS !== "undefined" ? FS : Module.FS;
    if (!fs || typeof fs.writeFile !== "function" || typeof fs.mkdirTree !== "function") {
      fail("Emscripten FS.writeFile unavailable for demo stems");
    }
    return fs;
  }

  function writeStemFile(vpath, bytes) {
    var fs = memfs();
    var slash = vpath.lastIndexOf("/");
    if (slash > 0) {
      fs.mkdirTree(vpath.slice(0, slash));
    }
    fs.writeFile(vpath, new Uint8Array(bytes));
  }

  function loadDemoStems(songs) {
    var jobs = [];
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      if (!s.stems || !Array.isArray(s.stems) || s.stems.length === 0) {
        fail("demo catalog missing stems[] for " + s.file + " (required by ?demo=stems)");
      }
      var base = psarcBasename(s.file);
      for (var k = 0; k < STEM_NAMES.length; k++) {
        if (s.stems.indexOf(STEM_NAMES[k]) < 0) {
          fail("demo catalog missing required stem " + STEM_NAMES[k] + " for " + s.file);
        }
      }
      for (var j = 0; j < s.stems.length; j++) {
        var name = s.stems[j];
        if (typeof name !== "string" || STEM_NAMES.indexOf(name) < 0) {
          fail("demo catalog invalid stem filename: " + name);
        }
        jobs.push({
          url: DEMOS_BASE + "stems/" + base + "/" + name,
          vpath: STEMS_VROOT + "/" + base + "/" + name,
          label: base + "/" + name,
        });
      }
    }
    if (jobs.length === 0) {
      fail("demo catalog has no stem files (?demo=stems)");
    }
    var done = 0;
    setStatus("loading stems (0/" + jobs.length + ")\u2026");
    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        return fetch(job.url, { cache: "no-store" }).then(function (r) {
          if (!r.ok) {
            fail("could not fetch stem " + job.label + " (HTTP " + r.status + ")");
          }
          return r.arrayBuffer();
        }).then(function (ab) {
          writeStemFile(job.vpath, ab);
          done += 1;
          setStatus("loading stems (" + done + "/" + jobs.length + ")\u2026");
        });
      });
    }, Promise.resolve());
  }

  function loadDemos() {
    setStatus("loading demos\u2026");
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
        var stemReady = Promise.resolve();
        if (wantStems) {
          setStemsDir();
          stemReady = loadDemoStems(catalog.songs);
        }
        return stemReady.then(function () {
          var total = urls.length;
          setStatus("loading psarcs (0/" + total + ")\u2026");
          var lib = window.Module && window.Module.rnrWebLib;
          var grant =
            lib &&
            (lib.grantRemoteFolder || lib.testGrant);
          if (typeof grant !== "function") {
            fail("rnrWebLib.grantRemoteFolder unavailable (need a build with weblib remote grant)");
          }
          return grant.call(lib, "Demos", urls, function (done, n) {
            setStatus("loading psarcs (" + done + "/" + n + ")\u2026");
          });
        });
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
