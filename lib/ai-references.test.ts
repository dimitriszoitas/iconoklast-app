import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import type { IconItem } from "./icon-types";

// Compile this small browser module in memory for native Node tests. Production
// imports stay extensionless for the app; only the test loader resolves .ts.
const source = await readFile(new URL("./ai-references.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace('from "./ai"', `from ${JSON.stringify(new URL("./ai.ts", import.meta.url).href)}`), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { selectFamilyReferences }: typeof import("./ai-references") = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

function svg(index: number, descriptionLength = 0): string {
  return `<svg viewBox="0 0 24 24"><desc>${"a".repeat(descriptionLength)}</desc><path d="M${index} 2L20 20"/></svg>`;
}

function item(id: string, originalSvg?: string, acceptedSvg?: string): IconItem {
  return {
    id, name: id, brief: id, round: 1, originalSvg,
    candidates: [{ id: `${id}-candidate`, name: id, rationale: "", svg: acceptedSvg ?? originalSvg ?? svg(9), status: acceptedSvg ? "accepted" : "pending", source: originalSvg ? "normalized" : "demo" }],
  };
}

test("target is first, accepted choices outrank uploads, and pending seed demos are ignored", () => {
  const target = item("target", svg(1));
  const upload = item("upload", svg(2));
  const accepted = item("accepted", svg(3), svg(4));
  const pending = item("pending");
  const shortlisted = item("shortlisted");
  shortlisted.candidates[0].status = "shortlisted";
  assert.deepEqual(selectFamilyReferences(target, [target, upload, pending, shortlisted, accepted]), [svg(1), svg(4), svg(2)]);
});

test("unsupported optional artwork is skipped, valid upload fallback is used, and target is preserved", () => {
  const unsupported = '<svg viewBox="0 0 24 24"><defs><linearGradient id="a"/></defs><path d="M2 2L20 20" fill="url(#a)"/></svg>';
  const target = item("target", unsupported);
  assert.deepEqual(selectFamilyReferences(target, [item("bad", unsupported), item("fallback", svg(3), unsupported)]), [unsupported, svg(3)]);
  const oversizedTarget = svg(1, 205_000);
  assert.equal(selectFamilyReferences(item("target", oversizedTarget), [item("other", svg(2))])[0], oversizedTarget);
  assert.deepEqual(selectFamilyReferences(item("target", svg(1)), [item("oversized", svg(2, 205_000))]), [svg(1)]);
});

test("family references are unique, limited to three, and one per item", () => {
  const target = item("target", svg(1));
  const duplicate = item("duplicate", svg(1).replace("<path", "<!-- duplicate --><path"));
  const others = [2, 3, 4, 5, 6].map((n) => item(`item-${n}`, svg(n), svg(n + 10)));
  assert.deepEqual(selectFamilyReferences(target, [duplicate, ...others]), [svg(1), svg(12), svg(13), svg(14)]);
});

test("encoded reference payload fits the budget and oversized optional refs cannot block smaller ones", () => {
  const target = item("target", svg(1, 150_000));
  const references = selectFamilyReferences(target, [
    item("too-large-for-budget", svg(2, 160_000)),
    item("fits", svg(3, 140_000)),
    item("small", svg(4)),
  ]);
  assert.deepEqual(references, [target.originalSvg, svg(3, 140_000), svg(4)]);
  assert.ok(new TextEncoder().encode(JSON.stringify(references)).byteLength <= 300_000);
  const invalidHugeTarget = item("target", svg(1, 310_000));
  assert.deepEqual(selectFamilyReferences(invalidHugeTarget, [item("optional", svg(2))]), [invalidHugeTarget.originalSvg]);
});

test("missing original uses reviewed target candidate, while empty original stays visible to API validation", () => {
  const target = item("target", undefined, svg(1));
  assert.deepEqual(selectFamilyReferences(target, []), [svg(1)]);
  assert.deepEqual(selectFamilyReferences(item("empty", ""), []), [""]);
});
