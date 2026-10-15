import i18next from "i18next";
import ru from "../locales/ru.json";

export const messages = ru;
export const i18n = i18next.createInstance();

await i18n.init({
  lng: "ru",
  fallbackLng: "ru",
  supportedLngs: ["ru", "en"],
  resources: {
    ru: { translation: ru },
  },
  interpolation: {
    escapeValue: false,
  },
});

export const t = i18n.getFixedT("ru");
