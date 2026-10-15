(() => {
  const form = document.querySelector("[data-category-form]");
  if (!(form instanceof HTMLFormElement)) return;
  const select = form.querySelector("[data-category-select]");
  if (!(select instanceof HTMLSelectElement)) return;
  const vessel = form.querySelector("[data-vessel-fields]");
  const engine = form.querySelector("[data-engine-fields]");

  function update() {
    const option = select.selectedOptions[0];
    for (const [element, key] of [
      [vessel, "vesselFields"],
      [engine, "engineFields"],
    ]) {
      if (!(element instanceof HTMLElement)) continue;
      const visible = option?.dataset[key] === "1";
      element.hidden = !visible;
      element.querySelectorAll("input,select,textarea").forEach((control) => {
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
          control.disabled = !visible;
        }
      });
    }
  }

  select.addEventListener("change", update);
  update();
})();
