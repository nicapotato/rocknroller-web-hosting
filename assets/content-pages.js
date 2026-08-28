/* Content pages (/ , /features/, …) do not register the COI worker, but an
 * origin-wide worker from /latest/ still controls them. After the worker
 * started skipping isolation on these routes, pull the update and reload
 * once if this document is still wrongly cross-origin-isolated (YouTube /
 * itch.io iframes fail under COEP). */
(function () {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.getRegistration().then(function (reg) {
    if (reg) return reg.update();
  });

  if (!window.crossOriginIsolated) return;

  var reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", function () {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
})();
