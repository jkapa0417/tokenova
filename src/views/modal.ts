// Lightweight modal helper. Single shared backdrop in index.html; views
// inject HTML into `#modal-body`. Closing clears the body.

const ESC_KEY = "Escape";

let attached = false;

function ensureAttached() {
  if (attached) return;
  const backdrop = document.getElementById("modal-backdrop");
  const closeBtn = document.getElementById("modal-close");
  if (!backdrop || !closeBtn) return;

  closeBtn.addEventListener("click", () => closeModal());
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === ESC_KEY) closeModal();
  });

  attached = true;
}

export function openModal(bodyHtml: string): void {
  ensureAttached();
  const backdrop = document.getElementById("modal-backdrop");
  const body = document.getElementById("modal-body");
  if (!backdrop || !body) return;
  body.innerHTML = bodyHtml;
  backdrop.hidden = false;
}

export function closeModal(): void {
  const backdrop = document.getElementById("modal-backdrop");
  const body = document.getElementById("modal-body");
  if (!backdrop || !body) return;
  backdrop.hidden = true;
  body.innerHTML = "";
}
