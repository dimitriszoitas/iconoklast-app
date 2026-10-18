import { MAX_REFERENCE_SVG_BYTES, validateSafeSvg } from "./ai";
import type { IconItem } from "./icon-types";

type ReferenceItem = Pick<IconItem, "id" | "originalSvg" | "candidates">;

// Leave room for the brief, feedback, standards, key and JSON escaping beneath
// the API's 384 KB request limit. Three family examples keep context focused.
const MAX_REFERENCE_PAYLOAD_BYTES = 300_000;
const MAX_FAMILY_REFERENCES = 3;
const encoder = new TextEncoder();

/**
 * Choose useful family context without letting optional examples block a target.
 * The target stays untouched even when unsupported/oversized so the API can
 * explain the target's actual issue. Only user-accepted or uploaded family
 * artwork is considered; pending and shortlisted demo directions are ignored.
 */
export function selectFamilyReferences(target: ReferenceItem, items: readonly ReferenceItem[]): string[] {
  const targetSvg = target.originalSvg
    ?? target.candidates.find((candidate) => candidate.status === "accepted")?.svg
    ?? target.candidates[0]?.svg
    ?? "";
  const references = [targetSvg];
  const seenSvg = new Set([targetSvg]);
  const seenItems = new Set([target.id]);
  try {
    seenSvg.add(validateSafeSvg(targetSvg, undefined, MAX_REFERENCE_SVG_BYTES));
  } catch {
    // The API validates the target and produces a visible, actionable error.
  }
  let payloadBytes = encoder.encode(JSON.stringify(references)).byteLength;

  const append = (item: ReferenceItem, source: string): void => {
    if (seenItems.has(item.id) || references.length >= MAX_FAMILY_REFERENCES + 1 || payloadBytes >= MAX_REFERENCE_PAYLOAD_BYTES) return;
    let svg: string;
    try {
      svg = validateSafeSvg(source, undefined, MAX_REFERENCE_SVG_BYTES);
    } catch {
      return;
    }
    if (seenSvg.has(svg)) return;
    const nextBytes = payloadBytes + 1 + encoder.encode(JSON.stringify(svg)).byteLength;
    if (nextBytes > MAX_REFERENCE_PAYLOAD_BYTES) return;
    references.push(svg);
    seenSvg.add(svg);
    seenItems.add(item.id);
    payloadBytes = nextBytes;
  };

  // A reviewed candidate carries more useful style intent than an original.
  for (const item of items) {
    for (const candidate of item.candidates) {
      if (candidate.status === "accepted") append(item, candidate.svg);
    }
  }
  for (const item of items) {
    if (item.originalSvg !== undefined) append(item, item.originalSvg);
  }
  return references;
}
