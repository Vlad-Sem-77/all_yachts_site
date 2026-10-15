(() => {
  const form = document.querySelector("[data-submit-form]");
  if (!(form instanceof HTMLFormElement)) return;

  const fileInput = form.querySelector("[data-photo-input]");
  const preview = form.querySelector("[data-photo-preview]");
  const status = form.querySelector("[data-upload-status]");
  const submitButton = form.querySelector("[data-submit-button]");
  const uploadPaths = form.querySelector("[data-upload-paths]");
  const draftToken = form.querySelector("[data-draft-token]");
  const categorySelect = form.querySelector("[data-category-select]");
  if (
    !(fileInput instanceof HTMLInputElement) ||
    !(preview instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(submitButton instanceof HTMLButtonElement) ||
    !(uploadPaths instanceof HTMLElement) ||
    !(draftToken instanceof HTMLInputElement)
  ) return;

  const fieldSets = [
    { root: form.querySelector("[data-vessel-fields]"), key: "vesselFields" },
    { root: form.querySelector("[data-engine-fields]"), key: "engineFields" },
  ];
  const hiddenPaths = () =>
    Array.from(uploadPaths.querySelectorAll('input[name="uploadPaths"]'))
      .map((input) => input.value)
      .filter(Boolean);
  const message = (key) => form.dataset[key] || "";

  function updateCategoryFields() {
    if (!(categorySelect instanceof HTMLSelectElement)) return;
    const selected = categorySelect.selectedOptions[0];
    const vesselVisible = selected?.dataset.vesselFields === "1";
    const engineVisible = selected?.dataset.engineFields === "1";
    for (const field of fieldSets) {
      if (!(field.root instanceof HTMLElement)) continue;
      const visible = field.key === "vesselFields" ? vesselVisible : engineVisible;
      field.root.hidden = !visible;
      field.root.querySelectorAll("input,select,textarea").forEach((control) => {
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
          control.disabled = !visible;
        }
      });
    }
  }

  function renderPreviews() {
    preview.replaceChildren();
    const files = Array.from(fileInput.files ?? []);
    for (const file of files.slice(0, 5)) {
      const item = document.createElement("div");
      item.className = "photo-preview";
      const image = document.createElement("img");
      image.alt = "";
      image.src = URL.createObjectURL(file);
      const caption = document.createElement("span");
      caption.textContent = file.name;
      item.append(image, caption);
      preview.append(item);
    }
  }

  fileInput.addEventListener("change", () => {
    renderPreviews();
    if (hiddenPaths().length) {
      uploadPaths.replaceChildren();
      draftToken.value = "";
    }
    const files = Array.from(fileInput.files ?? []);
    if (files.length > 5) {
      status.textContent = message("msgTooMany");
      return;
    }
    if (files.some((file) => file.size < 1 || file.size > 8 * 1024 * 1024)) {
      status.textContent = message("msgSize");
      return;
    }
    status.textContent = "";
  });

  if (hiddenPaths().length) fileInput.required = false;
  categorySelect?.addEventListener("change", updateCategoryFields);
  updateCategoryFields();

  form.addEventListener("submit", async (event) => {
    if (hiddenPaths().length > 0) return;
    event.preventDefault();
    const files = Array.from(fileInput.files ?? []);
    if (files.length < 1 || files.length > 5) {
      status.textContent = message("msgNoPhotos");
      return;
    }
    if (files.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)) {
      status.textContent = message("msgFormat");
      return;
    }

    submitButton.disabled = true;
    status.textContent = message("msgUploading");
    try {
      const response = await fetch("/media/request-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _csrf: form.querySelector('input[name="_csrf"]')?.value,
          captchaId: form.querySelector('input[name="captchaId"]')?.value,
          captchaAnswer: form.querySelector('input[name="captchaAnswer"]')?.value,
          website: form.querySelector('input[name="website"]')?.value,
          files: files.map((file) => ({
            name: file.name,
            size: file.size,
            contentType: file.type,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Не удалось подготовить загрузку.");

      const completedPaths = [];
      for (let index = 0; index < files.length; index += 1) {
        const upload = result.uploads[index];
        const uploaded = await fetch(upload.uploadURL, {
          method: "PUT",
          headers: { "Content-Type": files[index].type },
          body: files[index],
        });
        if (!uploaded.ok) throw new Error(message("msgUploadError"));
        completedPaths.push(upload.objectPath);
      }

      uploadPaths.replaceChildren();
      for (const objectPath of completedPaths) {
        const pathInput = document.createElement("input");
        pathInput.type = "hidden";
        pathInput.name = "uploadPaths";
        pathInput.value = objectPath;
        uploadPaths.append(pathInput);
      }
      draftToken.value = result.draftToken;
      fileInput.required = false;
      status.textContent = message("msgUploaded");
      submitButton.disabled = false;
      form.requestSubmit();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : message("msgUploadError");
      submitButton.disabled = false;
    }
  });
})();
