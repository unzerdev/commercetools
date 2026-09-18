/**
 * HTML-text escaping for the values the components interpolate into their own templates.
 *
 * The shipped surface builds its chrome as HTML strings and writes it with `insertAdjacentHTML`, and
 * every value in those strings arrives from the processor — a locale-resolved method name, a formatted
 * surcharge. None is shopper-controlled today, so this is the boundary
 * rule rather than a live injection: a value becomes TEXT exactly once, where it becomes HTML.
 */

/** Escape the five characters that would otherwise be read as markup. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
