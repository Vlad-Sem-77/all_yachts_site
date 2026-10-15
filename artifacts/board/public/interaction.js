(() => {
  const $ = (selector, root = document) => root.querySelector(selector);

  document.querySelectorAll("[data-phone-button]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    button.addEventListener("click", async () => {
      const result = $("[data-phone-result]");
      if (!(result instanceof HTMLElement)) return;
      if (button.dataset.revealed === "1") {
        result.replaceChildren();
        button.dataset.revealed = "0";
        button.firstChild.textContent = button.dataset.labelShow || "";
        return;
      }
      button.disabled = true;
      try {
        const response = await fetch(`/phone/${encodeURIComponent(button.dataset.slug || "")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ _csrf: button.dataset.csrf }),
        });
        const payload = await response.json();
        if (!response.ok || typeof payload.phone !== "string") {
          throw new Error(button.dataset.error || "");
        }
        const link = document.createElement("a");
        link.href = `tel:${payload.phone}`;
        link.textContent = payload.phone;
        link.className = "phone-number";
        result.replaceChildren(link);
        button.dataset.revealed = "1";
        button.firstChild.textContent = button.dataset.labelHide || "";
      } catch {
        result.textContent = button.dataset.error || "";
      } finally {
        button.disabled = false;
      }
    });
  });

  const share = async () => {
    const url = window.location.href.split("?")[0];
    const title = document.title;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      const status = $("[data-phone-result]");
      if (status instanceof HTMLElement) {
        status.textContent = status.dataset.msgCopied || "";
      }
    } catch {
      const status = $("[data-phone-result]");
      if (status instanceof HTMLElement) {
        status.textContent = status.dataset.msgShare || "";
      }
    }
  };
  document.querySelectorAll("[data-share-button], [data-copy-link]").forEach((button) => {
    button.addEventListener("click", share);
  });

  const mainImage = $("[data-gallery-main]");
  document.querySelectorAll("[data-gallery-item]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement) || !(mainImage instanceof HTMLImageElement)) return;
    button.addEventListener("click", () => {
      mainImage.src = button.dataset.full || "";
      document.querySelectorAll("[data-gallery-item]").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
    });
  });

  document.querySelectorAll("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (!window.confirm(form.getAttribute("data-confirm") || "")) event.preventDefault();
    });
  });
})();
