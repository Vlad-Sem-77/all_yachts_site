export const passwordResetEmailEnabled = false;

import nodemailer from "nodemailer";

export function smtpConfigured(): boolean {
  const port = Number(process.env.SMTP_PORT);
  return Boolean(
    process.env.SMTP_HOST &&
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65535 &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM,
  );
}

export async function sendSiteEmail(
  recipient: string,
  subject: string,
  text: string,
  html: string,
): Promise<void> {
  if (!smtpConfigured()) {
    throw new Error("SMTP email delivery is not configured.");
  }
  const port = Number(process.env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: recipient,
      subject,
      text,
      html,
    });
  } finally {
    transport.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function sendListingExpiryReminder(
  recipient: string,
  title: string,
  expiryDate: Date,
  listingUrl: string,
  manageUrl: string,
): Promise<void> {
  const safeTitle = escapeHtml(title);
  const date = expiryDate.toLocaleDateString("ru-RU");
  await sendSiteEmail(
    recipient,
    "Объявление скоро будет скрыто",
    `Объявление «${title}» будет автоматически скрыто ${date}. Продлите его здесь: ${manageUrl}\nОбъявление: ${listingUrl}`,
    `<p>Объявление «${safeTitle}» будет автоматически скрыто ${escapeHtml(date)}.</p><p><a href="${escapeHtml(manageUrl)}">Продлить объявление</a></p><p><a href="${escapeHtml(listingUrl)}">Открыть объявление</a></p>`,
  );
}

export async function sendPasswordResetEmail(
  _recipient: string,
  _resetUrl: string,
): Promise<void> {
  throw new Error("Password reset email delivery is not configured.");
}
