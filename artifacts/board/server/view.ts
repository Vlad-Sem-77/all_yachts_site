import ejs from "ejs";
import type { Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { messages, t } from "./localization";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const viewsDir = path.join(rootDir, "views");

export async function renderPage(
  res: Response,
  page: string,
  locals: Record<string, unknown>,
  status = 200,
): Promise<void> {
  const shared = {
    t,
    lang: "ru",
    categories: [],
    title: messages.home.title,
    description: messages.home.description,
    heading: messages.errors.notFoundTitle,
    message: messages.errors.notFoundDescription,
    ...locals,
  };
  const body = await ejs.renderFile(path.join(viewsDir, `${page}.ejs`), shared);
  const html = await ejs.renderFile(path.join(viewsDir, "base.ejs"), {
    ...shared,
    body,
  });
  res.status(status).type("html").send(html);
}
