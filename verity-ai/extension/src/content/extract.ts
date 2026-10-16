import type { Extraction } from "../types";

/**
 * Injected into the active tab with chrome.scripting.executeScript({ func }).
 * MUST be fully self-contained (no imports/closures used at runtime): it is serialized.
 * Reads only visible text; never form values, passwords, payment fields or other tabs.
 */
export function extractPage(): Extraction {
  const MAX_ITEMS = 30;
  const MAX_CHARS = 400;
  const price = /(?:US\$|A\$|C\$|[$€£₹¥])\s?\d|\d\s?(?:USD|EUR|GBP|INR|JPY|CAD|AUD)\b/i;
  const terms =
    /cancel|refund|renew|trial|per month|\/\s?(?:mo|month|yr|year)|monthly|annual|billed|commitment|minimum|shipping|delivery|fee|tax|\bvat\b|\bgst\b|subscription|money[- ]back|return/i;
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "INPUT", "TEXTAREA", "SELECT", "OPTION", "IFRAME", "SVG", "CANVAS"]);
  const sensitive = /card|cvv|cvc|password|iban|routing|account number|security code/i;

  const isVisible = (el: Element): boolean => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  };

  const selectorOf = (el: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 3) {
      const tag = cur.tagName.toLowerCase();
      parts.unshift(cur.id ? `${tag}#${CSS.escape(cur.id)}` : tag);
      if (cur.id) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };

  const seen = new Set<string>();
  const sources: Record<string, string> = {};
  const evidence: { id: string; kind: "visible_text"; text: string }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (skipTags.has(el.tagName.toUpperCase()) || el.getAttribute("type") === "password") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null = walker.nextNode();
  while (node && evidence.length < MAX_ITEMS) {
    const el = node as HTMLElement;
    // Leaf-ish blocks only, so text is not duplicated through nested ancestors.
    const hasBlockChild = Array.from(el.children).some((c) =>
      /^(DIV|P|LI|UL|OL|SECTION|ARTICLE|TABLE|TR|H[1-6]|FORM|MAIN|ASIDE)$/.test(c.tagName),
    );
    if (!hasBlockChild && isVisible(el)) {
      const text = (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length >= 8 && text.length <= 1200 && (price.test(text) || terms.test(text)) && !sensitive.test(text)) {
        const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
        if (!seen.has(clipped)) {
          seen.add(clipped);
          const id = `ev_${String(evidence.length + 1).padStart(3, "0")}`;
          evidence.push({ id, kind: "visible_text", text: clipped });
          sources[id] = selectorOf(el);
        }
      }
    }
    node = walker.nextNode();
  }

  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  let url = location.href;
  try {
    const u = new URL(canonical || location.href);
    u.search = ""; // query strings can carry tokens; drop them
    u.hash = "";
    url = u.toString();
  } catch {
    /* keep location.href */
  }

  const all = evidence.map((e) => e.text).join(" ");
  const subscription = /subscri|per month|\/\s?mo(?:nth)?\b|monthly|free trial|\bplan\b/i.test(all);
  const product = /add to cart|buy now|add to bag|in stock/i.test((document.body.innerText ?? document.body.textContent ?? "").slice(0, 20000));

  return {
    page: {
      url,
      title: (document.title || "").slice(0, 300),
      merchant_domain: location.hostname,
      page_type_hint: subscription ? "subscription" : product ? "product" : "unknown",
    },
    evidence,
    sources,
  };
}
