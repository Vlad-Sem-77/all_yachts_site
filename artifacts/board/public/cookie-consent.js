(() => {
  const banner = document.querySelector("[data-cookie-consent]");
  if (!banner) return;

  banner.querySelectorAll("[data-consent]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-consent") === "accept" ? "accepted" : "rejected";
      document.cookie = `analytics_consent=${value}; Max-Age=15552000; Path=/; SameSite=Strict${
        location.protocol === "https:" ? "; Secure" : ""
      }`;
      location.reload();
    });
  });
})();
