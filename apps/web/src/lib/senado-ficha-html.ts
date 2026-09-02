import type { Lang } from "@/lib/i18n";

const BLOCKED_ELEMENT_OPENING = /<\s*(script|style|head|iframe|object|embed)\b/gi;

function findTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function findClosingTag(lowerHtml: string, tag: string, start: number): number {
  const token = `</${tag}`;
  let index = start;
  while ((index = lowerHtml.indexOf(token, index)) >= 0) {
    const next = lowerHtml[index + token.length];
    if (next == null || /[\s>]/.test(next)) return index;
    index += token.length;
  }
  return -1;
}

/**
 * Remove active containers with a forward-only scan. A missing closing tag drops the
 * remainder instead of repeatedly rescanning it; this keeps attacker-controlled legacy
 * HTML linear-time and fail-closed.
 */
function removeBlockedElements(html: string): string {
  const lowerHtml = html.toLowerCase();
  let cursor = 0;
  let result = "";

  while (cursor < html.length) {
    BLOCKED_ELEMENT_OPENING.lastIndex = cursor;
    const opening = BLOCKED_ELEMENT_OPENING.exec(html);
    if (!opening || opening.index == null) {
      result += html.slice(cursor);
      break;
    }
    result += html.slice(cursor, opening.index);
    const openingEnd = findTagEnd(html, opening.index);
    if (openingEnd < 0) break;

    const tag = opening[1]!.toLowerCase();
    const openingText = html.slice(opening.index, openingEnd + 1);
    if (tag === "embed" || /\/\s*>$/.test(openingText)) {
      cursor = openingEnd + 1;
      continue;
    }

    const closing = findClosingTag(lowerHtml, tag, openingEnd + 1);
    if (closing < 0) break;
    const closingEnd = findTagEnd(html, closing);
    cursor = closingEnd < 0 ? html.length : closingEnd + 1;
  }

  return result;
}

export function stripExecutableHtml(html: string): string {
  return (
    removeBlockedElements(html)
      .replace(/<\/?\s*(?:script|style|head|iframe|object|embed)\b[^>]*>/gi, "")
      .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
      .replace(/<base\b[^>]*>/gi, "")
      .replace(/<link\b[^>]*>/gi, "")
      // Broken legacy image controls add misleading "Submit" labels once their
      // network resources are removed. They carry no legislative evidence.
      .replace(/<(?:img|input)\b[^>]*\/?\s*>/gi, "")
      .replace(/<form\b[^>]*>/gi, "<div>")
      .replace(/<\/form\s*>/gi, "</div>")
      // Every navigation/download in this legacy app depends on the authenticated
      // ASP.NET session. Keep the visible label, but do not expose a broken action.
      .replace(/<a\b[^>]*>/gi, '<span data-oculis-protected-link="blocked">')
      .replace(/<\/a\s*>/gi, "</span>")
      // HTML image maps navigate without an <a>; remove their active regions and
      // detach images from any map so the read-only promise remains literal.
      .replace(/<area\b[^>]*\/?\s*>/gi, "")
      .replace(/<\/area\s*>/gi, "")
      .replace(/\susemap\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\sstyle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(
        /\s(?:hidden|inert|autofocus|popover|open|contenteditable)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi,
        "",
      )
      // No remote passive resources are needed to read the facts. Removing every
      // resource-bearing attribute prevents LAN probing, tracking, and mixed-content
      // requests even if the upstream HTTP service is tampered with.
      .replace(
        /\s(?:src|srcset|href|xlink:href|poster|background|ping|action|formaction|manifest)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
        "",
      )
      .replace(/url\s*\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, 'url("")')
      .replace(/expression\s*\(/gi, "blocked(")
      .replace(/\b(?:javascript|data\s*:\s*text\/html)\s*:/gi, "blocked:")
  );
}

export function prepareSenadoFichaHtml(html: string, lang: Lang = "es"): string {
  const es = lang === "es";
  const title = es ? "Ficha del sistema legado del Senado" : "Senate legacy-system record";
  const notice = es
    ? '<aside role="note"><p><strong>Advertencia de transporte:</strong> vista de solo lectura obtenida del sistema legado oficial del Senado. El servidor de origen solo responde por HTTP sin TLS, por lo que Oculis no puede garantizar criptográficamente la autenticidad del tránsito. Oculis elimina estilos, recursos, descargas, enlaces y acciones; no comparte credenciales ni cookies del Senado.</p></aside><hr>'
    : '<aside role="note"><p><strong>Transport warning:</strong> read-only view retrieved from the Senate\'s official legacy system. The source server responds only over unencrypted HTTP, so Oculis cannot cryptographically guarantee authenticity in transit. Oculis removes styles, remote resources, downloads, links, and actions; it does not share Senate credentials or cookies. The official record below remains in Spanish.</p></aside><hr>';
  const sanitized = stripExecutableHtml(html);
  const bodyOpening = /<body\b[^>]*>/i.exec(sanitized);
  const bodyStart = bodyOpening?.index == null ? -1 : bodyOpening.index + bodyOpening[0].length;
  const bodyEnd = bodyStart < 0 ? -1 : sanitized.toLowerCase().indexOf("</body", bodyStart);
  const sourceFragment =
    bodyStart < 0 ? sanitized : sanitized.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd);

  // Always create an Oculis-owned shell. Upstream html/body attributes, CSS, and a
  // malformed wrapper can therefore neither suppress the warning nor visually forge it.
  const fragment = sourceFragment
    .replace(/<!doctype\b[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title></head><body>` +
    notice +
    `<section lang="es" aria-label="${
      es ? "Contenido oficial en español" : "Official source content in Spanish"
    }">${fragment}</section>` +
    "</body></html>"
  );
}
