/* No account, API access, stored routes or queued writes. The navigation URL stays
   in the address bar; retry only reloads that ordinary same-origin document. */
document.querySelector("[data-offline-retry]")?.addEventListener("click", () => location.reload());
document
  .querySelector("[data-offline-home]")
  ?.addEventListener("click", () => location.assign("/"));
