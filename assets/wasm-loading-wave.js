/* WASM_LOADING_WAVE_JS */
(function () {
  var wave = document.getElementById("loading-wave");
  if (wave && !wave.childElementCount) {
    var word = "DOWNLOADING";
    for (var i = 0; i < word.length; i++) {
      var s = document.createElement("span");
      s.textContent = word.charAt(i);
      wave.appendChild(s);
    }
  }

  var dataLoaded = 0;
  var wasmLoaded = 0;
  var fallbackMaxTotal = 0;
  var overlayDone = false;
  var fetchWrapped = false;
  var transferActive = false;
  var transferLoaded = 0;
  var transferTotal = 0;

  function assetTotal() {
    var a = window.__WASM_ASSET_BYTES;
    if (
      a &&
      typeof a.data === "number" &&
      typeof a.wasm === "number" &&
      isFinite(a.data) &&
      isFinite(a.wasm) &&
      a.data >= 0 &&
      a.wasm >= 0
    ) {
      return a.data + a.wasm;
    }
    return 0;
  }

  function formatBytesPair(loaded, total) {
    if (total < 1024) {
      return Math.round(loaded) + " / " + Math.round(total);
    }
    if (total < 1024 * 1024) {
      return Math.round(loaded / 1024) + " / " + Math.round(total / 1024) + " KB";
    }
    return (
      (loaded / (1024 * 1024)).toFixed(2) +
      " / " +
      (total / (1024 * 1024)).toFixed(2) +
      " MB"
    );
  }

  window.__wasmLoadingFormatProgress = function (loaded, total) {
    if (!(total > 0)) total = loaded;
    if (loaded > total) total = loaded;
    if (total > fallbackMaxTotal) fallbackMaxTotal = total;
    if (fallbackMaxTotal > total) total = fallbackMaxTotal;
    loaded = Math.min(loaded, total);
    return formatBytesPair(loaded, total);
  };

  function paintBytes() {
    var progress = document.getElementById("loading-progress");
    var loading = document.getElementById("loading");
    if (!progress || !loading || overlayDone) return;
    loading.hidden = false;
    var loaded;
    var total;
    if (transferActive) {
      loaded = transferLoaded;
      total = transferTotal;
    } else {
      loaded = dataLoaded + wasmLoaded;
      total = assetTotal();
      if (!(total > 0)) {
        total = Math.max(loaded, fallbackMaxTotal);
        if (total > fallbackMaxTotal) fallbackMaxTotal = total;
      }
    }
    if (total > 0) {
      loaded = Math.min(loaded, total);
      progress.textContent = formatBytesPair(loaded, total);
    }
  }

  function assetKind(url) {
    var path = String(url || "").split("?")[0].split("#")[0];
    if (/\.wasm$/i.test(path)) return "wasm";
    if (/\.data$/i.test(path)) return "data";
    if (transferActive && (/\.psarc$/i.test(path) || /\.mp3$/i.test(path))) {
      return "transfer";
    }
    return "";
  }

  function addWatchedBytes(kind, n) {
    if (kind === "wasm") wasmLoaded += n;
    else if (kind === "data") dataLoaded += n;
    else if (kind === "transfer") transferLoaded += n;
    else {
      throw new Error("wasm-loading-wave: unknown watch kind: " + kind);
    }
  }

  function watchBody(res, kind) {
    if (!res || !res.body || typeof res.clone !== "function") return res;
    var clone;
    try {
      clone = res.clone();
    } catch (e) {
      return res;
    }
    if (!clone.body || typeof clone.body.getReader !== "function") return res;
    var reader = clone.body.getReader();
    function pump() {
      reader.read().then(function (chunk) {
        if (chunk.done) {
          paintBytes();
          return;
        }
        var n = chunk.value && chunk.value.byteLength ? chunk.value.byteLength : 0;
        addWatchedBytes(kind, n);
        paintBytes();
        pump();
      }).catch(function () {});
    }
    pump();
    return res;
  }

  function requestMethod(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input === "object" && input.method) {
      return String(input.method).toUpperCase();
    }
    return "GET";
  }

  function installFetchWrapper() {
    if (fetchWrapped || typeof window.fetch !== "function") return;
    fetchWrapped = true;
    var orig = window.fetch;
    window.fetch = function (input, init) {
      var url = "";
      if (typeof input === "string") url = input;
      else if (input && typeof input.url === "string") url = input.url;
      var kind = requestMethod(input, init) === "GET" ? assetKind(url) : "";
      var p = orig.apply(this, arguments);
      if (!kind) return p;
      return p.then(function (res) {
        return watchBody(res, kind);
      });
    };
  }

  window.__wasmLoadingStartTransfer = function (totalBytes) {
    if (typeof totalBytes !== "number" || !isFinite(totalBytes) || totalBytes <= 0) {
      throw new Error(
        "__wasmLoadingStartTransfer: totalBytes must be a positive finite number"
      );
    }
    overlayDone = false;
    transferActive = true;
    transferLoaded = 0;
    transferTotal = totalBytes;
    paintBytes();
  };

  window.__wasmLoadingApplyStatus = function (text) {
    var loading = document.getElementById("loading");
    var progress = document.getElementById("loading-progress");
    if (!loading || !progress) return;
    if (!text) {
      overlayDone = true;
      transferActive = false;
      loading.hidden = true;
      progress.textContent = "";
      return;
    }
    loading.hidden = false;
    if (transferActive) {
      paintBytes();
      return;
    }
    if (overlayDone) {
      var post = String(text).replace(/^Downloading(\s+data)?\.\.\.\s*/i, "").trim();
      progress.textContent = post || "";
      return;
    }
    if (assetTotal() > 0 || dataLoaded + wasmLoaded > 0) {
      paintBytes();
      return;
    }
    var m = String(text).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (m) {
      progress.textContent = window.__wasmLoadingFormatProgress(
        parseFloat(m[1]),
        parseFloat(m[2])
      );
    } else {
      var cleaned = String(text).replace(/^Downloading(\s+data)?\.\.\.\s*/i, "").trim();
      progress.textContent = cleaned || "";
    }
  };

  window.__wasmLoadingPaintBytes = paintBytes;
  installFetchWrapper();
  /* Totals come from S3 asset-sizes.js via player.js — do not fetch a
     same-origin copy (GitHub Pages would serve 404.html as the script). */
})();
/* WASM_LOADING_WAVE_JS_END */
