export function createClientListHUD() {
  const el = document.getElementById('clientList');
  return {
    set(clients) { el.textContent = JSON.stringify(clients, null, 2); }
  };
}
