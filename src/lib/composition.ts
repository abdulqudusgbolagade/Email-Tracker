import sanitizeHtml from "sanitize-html";
import type { Prospect } from "../generated/prisma/client";
import { AppError } from "./security";

export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "a",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h2",
      "h3",
      "hr",
      "span",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}
export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderContent(
  input: { subject: string; html: string; text: string },
  prospect: Pick<Prospect, "fullName" | "bookTitle" | "service" | "website">,
  signature: string,
  unsubscribeUrl?: string,
) {
  const values: Record<string, string> = {
    first_name: prospect.fullName.split(/\s+/)[0],
    full_name: prospect.fullName,
    book_title: prospect.bookTitle,
    service_needed: prospect.service,
    author_website: prospect.website,
    company: "Grant Publishing Co.",
  };
  function fill(value: string, html: boolean) {
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
      if (!(key in values) || !values[key])
        throw new AppError(400, `Missing or unsupported placeholder: ${key}`);
      return html ? escapeHtml(values[key]) : values[key];
    });
  }
  const subject = fill(input.subject, false);
  if (/[\r\n]/.test(subject))
    throw new AppError(400, "Subject cannot contain line breaks.");
  const footer = "To stop receiving outreach, reply with “unsubscribe”.";
  const text = `${fill(input.text, false)}\n\n${signature}\n\n${footer}${unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : ""}`;
  const html =
    cleanHtml(fill(input.html, true)) +
    `<p>${escapeHtml(signature).replace(/\n/g, "<br>")}</p><p>${escapeHtml(footer)}${unsubscribeUrl ? ` <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>` : ""}</p>`;
  if (!input.text.trim() || !cleanHtml(input.html).trim())
    throw new AppError(
      400,
      "Provide both HTML and plain-text message content.",
    );
  return { subject, html, text };
}
