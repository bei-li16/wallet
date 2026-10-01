"use strict";
document.querySelector('#update').onclick = async () => {
  const reg = await navigator.serviceWorker.getRegistration(new URL('../', location.href));
  await reg.update(); document.querySelector('#out').textContent = 'Update check finished. Read lifecycle state to inspect.';
};
document.querySelector('#activate').onclick = async () => {
  const reg = await navigator.serviceWorker.getRegistration(new URL('../', location.href));
  reg.waiting?.postMessage({type:'ACTIVATE_UPDATE'});
  document.querySelector('#out').textContent = reg.waiting ? 'Activation requested' : 'No waiting worker';
};
document.querySelector("#check").onclick = async () => {
  const reg = await navigator.serviceWorker.getRegistration(
    new URL("../", location.href),
  );
  document.querySelector("#out").textContent = JSON.stringify(
    {
      scope: reg?.scope,
      active: reg?.active?.state,
      waiting: reg?.waiting?.state,
      installing: reg?.installing?.state,
      controller: navigator.serviceWorker.controller?.state,
      caches: await caches.keys(),
    },
    null,
    2,
  );
};
