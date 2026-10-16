import { extractOffer } from "../extraction/offer";
import type { Extraction } from "../types";
import { extractPage } from "./extract";

/**
 * Bundled as a standalone classic script (content.js) and injected on user action only.
 * It registers a function; the background then calls it in a second executeScript.
 */
function run(): Extraction {
  const result = extractPage();
  const blocks = result.evidence.map((e) => ({ id: e.id, text: e.text, selector: result.sources?.[e.id] ?? null }));
  const offer = extractOffer({
    doc: document,
    blocks,
    url: result.page.url,
    hostname: result.page.merchant_domain,
    title: result.page.title,
  });
  return { ...result, offer };
}

(globalThis as unknown as { __verityExtract?: () => Extraction }).__verityExtract = run;
