document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-discuss-listing]");
  if (!button || button.disabled) return;
  const message = button.parentElement?.querySelector("[data-discuss-message]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  if (message) message.textContent = "Открываем обсуждение…";
  try {
    const response = await fetch(button.dataset.endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) {
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }
    const data = await response.json();
    if (!response.ok || typeof data.url !== "string" || !data.url.startsWith("/forum/topic/")) {
      throw new Error(data.error || button.dataset.error);
    }
    window.location.assign(data.url);
  } catch (error) {
    if (message) message.textContent = error instanceof Error ? error.message : button.dataset.error;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});
