import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import type { Candidate, IconItem, PaletteColor } from "../lib/icon-types";

const engine: typeof import("../lib/icon-engine") = await import(new URL("../lib/icon-engine.ts", import.meta.url).href);
const { DEFAULT_STANDARDS, effectiveColorMode, recolorSvg, createDemoCandidates, createNormalizedCandidates, createSampleSet, sanitizeSvg, normalizeSvg, analyzeSvg, buildExportBundle, createZip } = engine;
const window = new Window();
Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: window.DOMParser });
Object.defineProperty(globalThis, "XMLSerializer", { configurable: true, writable: true, value: window.XMLSerializer });
const standards = { ...DEFAULT_STANDARDS, padding: 2 };
const basic = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4L20 20" fill="none" stroke="#000"/></svg>';
const parse = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;

test("starter data works without browser globals and has six coherent icons", () => {
  const parser = globalThis.DOMParser;
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: undefined });
  try {
    const samples = createSampleSet(DEFAULT_STANDARDS);
    assert.equal(samples.length, 6);
    assert.equal(samples[0].name, "Workspace");
    assert.ok(samples.every((item) => item.candidates.length === 6 && item.standards?.gridSize === 24));
    assert.throws(() => sanitizeSvg(basic), /available in the browser/);
  } finally {
    Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: parser });
  }
});

test("all curated alternatives are distinct, safe, bounded, and explicitly demo content", () => {
  for (const style of ["line", "filled", "combined", "duotone"] as const) {
    for (const brief of ["workspace", "search", "notifications", "collection", "settings", "profile"]) {
      const candidates = createDemoCandidates(brief, { ...standards, style }, 8);
      assert.equal(new Set(candidates.map((candidate) => candidate.svg)).size, 8, `${brief}/${style}`);
      assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, 8);
      for (const candidate of candidates) {
        assert.equal(candidate.source, "demo");
        assert.equal(candidate.status, "pending");
        assert.match(candidate.rationale, /demo/);
        assert.doesNotThrow(() => sanitizeSvg(candidate.svg), `${brief}/${style}/${candidate.name}`);
      }
    }
  }
  assert.equal(createDemoCandidates("workspace", standards, 1).length, 4);
  assert.equal(createDemoCandidates("workspace", standards, 500).length, 8);
  assert.notEqual(createDemoCandidates("workspace", standards, 6, 1)[0].svg, createDemoCandidates("workspace", standards, 6, 2)[0].svg);
});

test("color mode is independent from drawing style and defaults to monochrome", () => {
  assert.equal(DEFAULT_STANDARDS.colorMode, "mono");
  assert.equal(effectiveColorMode({ style: "line" }), "mono");
  assert.equal(effectiveColorMode({ style: "combined" }), "mono");
  assert.equal(effectiveColorMode({ style: "duotone" }), "duo");
  assert.equal(effectiveColorMode({ style: "duotone", colorMode: "mono" }), "mono");
  for (const style of ["line", "filled", "combined", "duotone"] as const) {
    for (const candidate of createDemoCandidates("workspace", { ...standards, style, colorMode: "mono" }, 8)) {
      assert.ok(!candidate.svg.includes(standards.secondaryColor), `${style}/${candidate.name} must stay monochrome`);
      assert.doesNotThrow(() => sanitizeSvg(candidate.svg));
    }
    const duo = createDemoCandidates("workspace", { ...standards, style, colorMode: "duo" }, 4);
    assert.ok(duo[0].svg.includes(standards.primaryColor) && duo[0].svg.includes(standards.secondaryColor), `${style} supports explicit two-color accents`);
    assert.doesNotThrow(() => sanitizeSvg(duo[0].svg));
  }
  const purple = `<svg viewBox="0 0 24 24"><path d="M3 3L21 21" fill="none" stroke="${standards.secondaryColor}"/></svg>`;
  assert.ok(analyzeSvg(purple, { ...standards, colorMode: "mono" }).issues.some((issue) => issue.label === "Colors differ"));
  assert.ok(!analyzeSvg(purple, { ...standards, colorMode: "duo" }).issues.some((issue) => issue.label === "Colors differ"));
});

test("recoloring preserves geometry, white cutouts, inherited opacity, and mask semantics", () => {
  const source = '<svg viewBox="0 0 24 24" fill="#9c44ee" opacity="0.7"><defs><mask id="cut"><rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="1" fill="black"/></mask></defs><g transform="translate(1 1)" fill-opacity="0.6"><path d="M3 3h16v16H3V3Z" mask="url(#cut)"/><circle cx="11" cy="11" r="3" fill="white"/><path d="M4 20h12" fill="none" stroke="#123456" stroke-width="1.25" stroke-linecap="round"/></g></svg>';
  const root = parse(recolorSvg(source, { ...standards, colorMode: "mono" }));
  assert.equal(root.getAttribute("opacity"), "0.7");
  assert.equal(root.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(root.querySelector("g")?.getAttribute("transform"), "translate(1 1)");
  assert.equal(root.querySelector("g")?.getAttribute("fill-opacity"), "0.6");
  assert.equal(root.querySelector("g path")?.getAttribute("d"), "M3 3h16v16H3V3Z");
  assert.equal(root.querySelector("g path")?.getAttribute("fill"), standards.primaryColor);
  assert.equal(root.querySelector("g circle")?.getAttribute("fill"), "white");
  assert.equal(root.querySelector("g path:last-child")?.getAttribute("fill"), "none");
  assert.equal(root.querySelector("g path:last-child")?.getAttribute("stroke"), standards.primaryColor);
  assert.equal(root.querySelector("g path:last-child")?.getAttribute("stroke-width"), "1.25");
  assert.equal(root.querySelector("mask rect")?.getAttribute("fill"), "white");
  assert.equal(root.querySelector("mask circle")?.getAttribute("fill"), "black");
  assert.equal(recolorSvg(recolorSvg(source, standards), standards), recolorSvg(source, standards));
  const gradient = '<svg viewBox="0 0 24 24"><defs><linearGradient id="paint"><stop offset="0" stop-color="#111"/><stop offset="1" stop-color="#aaa"/></linearGradient></defs><rect width="24" height="24" fill="url(#paint)"/></svg>';
  assert.throws(() => recolorSvg(gradient, standards), /complex paints/);
});

test("four-color recoloring allocates whole shapes by area and only accepts configured paints", () => {
  const palette: PaletteColor[] = ["#112233", "#445566", "#778899", "#aabbcc"].map(color => ({ color, percentage: 25, locked: false }));
  const settings = { ...standards, colorMode: "color" as const, palette };
  const source = '<svg viewBox="0 0 24 24" fill="#000"><rect x="2" y="2" width="8" height="8"/><rect x="14" y="2" width="8" height="8"/><rect x="2" y="14" width="8" height="8"/><rect x="14" y="14" width="8" height="8"/></svg>';
  const colored = recolorSvg(source, settings), root = parse(colored);
  assert.deepEqual(Array.from(root.querySelectorAll("rect")).map(node => node.getAttribute("fill")), palette.map(entry => entry.color));
  assert.deepEqual(Array.from(root.querySelectorAll("rect")).map(node => [node.getAttribute("x"), node.getAttribute("y"), node.getAttribute("width"), node.getAttribute("height")]), Array.from(parse(source).querySelectorAll("rect")).map(node => [node.getAttribute("x"), node.getAttribute("y"), node.getAttribute("width"), node.getAttribute("height")]));
  assert.equal(recolorSvg(colored, settings), colored);
  assert.ok(!analyzeSvg(colored, settings).issues.some(issue => issue.label === "Colors differ"));
  assert.ok(analyzeSvg(colored.replace("#778899", "#ff00ff"), settings).issues.some(issue => issue.label === "Colors differ"));
  const unequal = '<svg viewBox="0 0 24 24"><rect width="2" height="10"/><rect x="4" width="8" height="10"/></svg>';
  const weighted = parse(recolorSvg(unequal, { ...settings, palette: [{ ...palette[0], percentage: 80, locked: true }, { ...palette[1], percentage: 20 }] }));
  assert.deepEqual(Array.from(weighted.querySelectorAll("rect")).map(node => node.getAttribute("fill")), ["#445566", "#112233"]);
});

test("Color demos work without browser globals and normalization applies all four palette colors", () => {
  const palette: PaletteColor[] = ["#112233", "#445566", "#778899", "#aabbcc"].map(color => ({ color, percentage: 25, locked: false }));
  const settings = { ...standards, colorMode: "color" as const, palette };
  const parser = globalThis.DOMParser;
  let generated: Candidate[];
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: undefined });
  try { generated = createDemoCandidates("workspace", settings, 4); }
  finally { Object.defineProperty(globalThis, "DOMParser", { configurable: true, writable: true, value: parser }); }
  const root = parse(generated![0].svg);
  assert.deepEqual(Array.from(root.querySelectorAll("rect")).map(node => node.getAttribute("stroke")), palette.map(entry => entry.color));
  const normalized = normalizeSvg(generated![0].svg, settings);
  assert.ok(!analyzeSvg(normalized, settings).issues.some(issue => issue.label === "Colors differ"));
  assert.deepEqual(new Set(Array.from(parse(normalized).querySelectorAll("rect")).map(node => node.getAttribute("stroke"))), new Set(palette.map(entry => entry.color)));
});

test("palette recoloring keeps derived junction caps with their source and leaves cutout masks intact", () => {
  const palette: PaletteColor[] = [{ color: "#112233", percentage: 50, locked: false }, { color: "#445566", percentage: 50, locked: false }];
  const source = '<svg viewBox="0 0 24 24" data-iconify-junctions="1"><defs><mask id="cutout"><rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="1" fill="black"/></mask></defs><path d="M3 3H20" fill="none" stroke="#000" stroke-width="1"/><path data-iconify-junction-cap="1" d="M20 3h-.01" fill="none" stroke="#000" stroke-width="1" stroke-linecap="square"/><path d="M4 8H20" fill="none" stroke="#000" stroke-width="1"/></svg>';
  const root = parse(recolorSvg(source, { ...standards, colorMode: "color", palette }));
  const paths = root.querySelectorAll("path");
  assert.equal(paths[1].getAttribute("stroke"), paths[0].getAttribute("stroke"));
  assert.notEqual(paths[2].getAttribute("stroke"), paths[0].getAttribute("stroke"));
  assert.equal(root.querySelector("mask rect")?.getAttribute("fill"), "white");
  assert.equal(root.querySelector("mask circle")?.getAttribute("fill"), "black");
});

test("sanitizer preserves safe vector structure, transforms, viewBox, and local paints", () => {
  const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 48 32"><!-- exported art --><defs><linearGradient id="paint"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><clipPath id="clip"><rect x="0" y="0" width="24" height="24"/></clipPath></defs><g transform="translate(10 20) scale(2)" clip-path="url(#clip)"><path d="M1 1L20 20" stroke="url(#paint)" fill="none"/></g></svg>';
  const clean = sanitizeSvg(original);
  assert.match(clean, /viewBox="10 20 48 32"/);
  assert.match(clean, /transform="translate\(10 20\) scale\(2\)"/);
  assert.match(clean, /clip-path="url\(#clip\)"/);
  assert.match(clean, /stroke="url\(#paint\)"/);
  assert.doesNotMatch(clean, /exported art/);
  assert.equal(sanitizeSvg(clean), clean);
  assert.match(sanitizeSvg('<svg width="32px" height="16px"><path d="M1 1L20 10"/></svg>'), /viewBox="0 0 32 16"/);
});

test("live corner base geometry survives sanitizing, color and stroke changes, normalization, and SVG exports", () => {
  assert.equal(DEFAULT_STANDARDS.cornerRadius, 1);
  const base = "M4 4H20V20H4Z";
  const rounded = "M4 5Q4 4 5 4H19Q20 4 20 5V19Q20 20 19 20H5Q4 20 4 19Z";
  const source = `<svg viewBox="0 0 24 24"><path d="${rounded}" data-iconify-base-path="${base}" data-iconify-corner-radius="1" fill="none" stroke="#000" stroke-width="1"/></svg>`;
  const check = (svg: string) => {
    const path = parse(svg).querySelector("path")!;
    assert.equal(path.getAttribute("d"), rounded, "exported geometry remains rounded");
    assert.equal(path.getAttribute("data-iconify-base-path"), base, "sharp geometry remains editable");
    assert.equal(path.getAttribute("data-iconify-corner-radius"), "1");
  };
  check(sanitizeSvg(source));
  check(recolorSvg(source, { ...standards, primaryColor: "#123456" }));
  check(engine.updateSvgStrokeWidth(source, 2.5));
  check(normalizeSvg(source, standards));
  const bundle = buildExportBundle([{ id: "rounded", name: "Rounded", brief: "Test live corners", round: 1, standards, candidates: [{ id: "rounded-1", name: "Rounded", svg: source, rationale: "Test", status: "accepted", source: "normalized" }] }], standards);
  check(bundle.find(file => file.name === "rounded.svg")!.content);
  check(bundle.find(file => file.name === "sprite.svg")!.content);
  assert.equal(sanitizeSvg(sanitizeSvg(source)), sanitizeSvg(source));
  for (const radius of ["0", "0.125", "1e2", "10000"]) {
    assert.equal(parse(sanitizeSvg(source.replace('radius="1"', `radius="${radius}"`))).querySelector("path")!.getAttribute("data-iconify-corner-radius"), radius);
  }
});

test("live corner metadata rejects incomplete pairs, non-path placement, and unsafe or malformed values", () => {
  const path = 'd="M4 4H20V20H4Z"';
  const base = 'data-iconify-base-path="M4 4H20V20H4Z"';
  const radius = 'data-iconify-corner-radius="1"';
  for (const attributes of [base, radius]) {
    assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path ${path} ${attributes}/></svg>`), /requires both/);
  }
  for (const tag of ["g", "rect", "circle"]) {
    assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><${tag} ${base} ${radius}/><path ${path}/></svg>`), /on a path element/);
  }
  assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24" ${base} ${radius}><path ${path}/></svg>`), /on a path element/);
  for (const badRadius of ["", " ", "NaN", "Infinity", "1e999", "-0.1", "10000.1", "1px", "20%", "1 2", "1,2", "javascript:alert(1)"]) {
    assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path ${path} ${base} data-iconify-corner-radius="${badRadius}"/></svg>`), /corner radius/, badRadius);
  }
  for (const badBase of ["", "M4 4", "M4 4L20", "M0 0A4 4 0 2 0 10 10", "M0 0L1e999 1", "javascript:alert(1)", "&lt;script&gt;alert(1)&lt;/script&gt;", `M0 0L1 1${" ".repeat(100000)}`]) {
    assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path ${path} data-iconify-base-path="${badBase}" ${radius}/></svg>`), Error, badBase.slice(0, 60));
  }
  assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path ${path} ${base} ${radius} onload="alert(1)"/></svg>`), /event handlers/);
  assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24"><path ${path} ${base} ${radius} fill="url(https://example.test/paint)"/></svg>`), /external paint/);
});

test("active content, external resources, hidden-only drawings, and malformed geometry are rejected", () => {
  const attacks = [
    '<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><foreignObject><div>hello</div></foreignObject></svg>',
    '<svg viewBox="0 0 24 24"><image href="https://example.test/track"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" style="fill:red"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" fill="url(https://example.test/paint)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" fill="&#117;rl(https://example.test/paint)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" fill="url(#missing)"/></svg>',
    '<svg viewBox="0 0 24 24"><defs><linearGradient id="a" href="javascript:alert(1)"/></defs><path d="M0 0L1 1"/></svg>',
    '<!DOCTYPE svg [<!ENTITY steal SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg>',
    '<?evil instruction?><svg viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><animate attributeName="href"/><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><svg viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg></svg>',
    '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><title><path d="M0 0L1 1"/></title></svg>',
    '<svg viewBox="0 0 24 24"><defs><path d="M0 0L1 1"/></defs></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0A4 4 0 2 0 10 10"/></svg>',
    '<svg viewBox="0 0 24 24"><rect width="-4" height="20"/></svg>',
    '<svg viewBox="0 0 0 24"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><path id="same" d="M0 0L1 1"/><path id="same" d="M2 2L3 3"/></svg>',
  ];
  for (const attack of attacks) assert.throws(() => sanitizeSvg(attack), Error, attack);
  assert.throws(() => sanitizeSvg(" ".repeat(500_001) + basic), /500 KB/);
  assert.throws(() => sanitizeSvg(`<svg viewBox="0 0 24 24">${'<path d="M0 0L1 1"/>'.repeat(1501)}</svg>`), /1,500/);
});

test("normalization preserves nonzero source origins and nested geometry transforms", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 40 20"><g transform="translate(1 2) scale(2)"><path d="M5 10L20 15" stroke="black" fill="none"/></g></svg>';
  const result = parse(normalizeSvg(svg, standards));
  assert.equal(result.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(result.firstElementChild?.getAttribute("transform"), "translate(-3 -3) scale(0.5)");
  assert.equal(result.querySelector("g g")?.getAttribute("transform"), "translate(1 2) scale(2)");
  assert.equal(result.querySelector("path")?.getAttribute("stroke-width"), "1.75");
  assert.equal(result.querySelector("path")?.getAttribute("d"), "M5 10L20 15");
});

test("reapplying standards is idempotent and changing grids does not compound padding", () => {
  const source = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 12h8"/></svg>';
  const once = normalizeSvg(source, standards);
  assert.equal(normalizeSvg(once, standards), once);
  const larger = normalizeSvg(once, { ...standards, gridSize: 48, padding: 6 });
  const restored = normalizeSvg(larger, standards);
  assert.equal(restored, once);
  assert.equal(parse(restored).querySelectorAll('[data-iconify-fit="1"]').length, 1);
  const demo = createDemoCandidates("workspace", standards, 6)[0].svg;
  assert.equal(parse(normalizeSvg(demo, standards)).firstElementChild?.getAttribute("transform"), parse(demo).firstElementChild?.getAttribute("transform"));
});

test("local normalization offers eight unique comparisons with an exact-standard first candidate", () => {
  const source = '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>';
  for (const style of ["line", "filled", "combined", "duotone"] as const) {
    for (const padding of [0, 3, 10]) {
      const settings = { ...DEFAULT_STANDARDS, style, padding };
      const candidates = createNormalizedCandidates(source, settings, 8);
      assert.equal(candidates.length, 8, `${style}/${padding}`);
      assert.equal(new Set(candidates.map((candidate) => candidate.svg)).size, 8);
      assert.equal(candidates[0].svg, normalizeSvg(source, settings));
      assert.ok(candidates.every((candidate) => candidate.source === "normalized" && candidate.status === "pending"));
      if (style === "filled") {
        const geometryFits = candidates.map((candidate) => parse(candidate.svg).firstElementChild?.getAttribute("transform"));
        assert.equal(new Set(geometryFits).size, 8, "Solid icons must differ visibly, not only in unused stroke attributes");
      }
    }
  }
});

test("zero padding reserves half a stroke for geometry touching the viewBox edges", () => {
  const source = '<svg viewBox="0 0 24 24"><path d="M0 0H24V24H0Z" fill="none" stroke="black"/></svg>';
  const result = parse(normalizeSvg(source, { ...standards, padding: 0, strokeWidth: 2 }));
  assert.equal(result.firstElementChild?.getAttribute("transform"), "translate(1 1) scale(0.9167)");
  const demo = parse(createDemoCandidates("workspace", { ...standards, padding: 0, strokeWidth: 2 }, 4)[0].svg);
  assert.equal(demo.firstElementChild?.getAttribute("transform"), "translate(-2.6667 -2.6667) scale(1.2222)");
  const filled = parse(normalizeSvg('<svg viewBox="0 0 24 24"><path d="M0 0H24V24H0Z"/></svg>', { ...standards, style: "filled", padding: 0, strokeWidth: 2 }));
  assert.equal(filled.firstElementChild?.getAttribute("transform"), "translate(0 0) scale(1)");
});

test("filled normalization preserves open strokes and mask semantics", () => {
  const source = '<svg viewBox="0 0 24 24"><defs><mask id="cut"><rect width="24" height="24" fill="white"/><circle cx="12" cy="12" r="2" fill="black"/></mask></defs><rect x="4" y="4" width="16" height="16" mask="url(#cut)"/><path d="M4 12h16" fill="none" stroke="black"/></svg>';
  const output = normalizeSvg(source, { ...standards, style: "filled" });
  const result = parse(output);
  const line = result.querySelector("path")!;
  assert.equal(line.getAttribute("fill"), "none");
  assert.equal(line.getAttribute("stroke"), standards.primaryColor);
  assert.equal(result.querySelector('rect[mask]')?.getAttribute("fill"), standards.primaryColor);
  assert.equal(result.querySelector('rect[mask]')?.getAttribute("stroke"), "none");
  assert.equal(result.querySelector("mask rect")?.getAttribute("fill"), "white");
  assert.equal(result.querySelector("mask circle")?.getAttribute("fill"), "black");
  assert.ok(analyzeSvg(output, { ...standards, style: "filled" }).issues.some((issue) => issue.label.includes("Open paths")));
});

test("filled imports keep their silhouette instead of receiving a double outline", () => {
  const glyph = '<svg viewBox="0 0 24 24" fill="#222"><g><path fill-rule="evenodd" d="M3 3h18v18H3V3Zm4 4v10h10V7H7Z"/></g></svg>';
  for (const style of ["line", "combined", "filled"] as const) {
    const output = normalizeSvg(glyph, { ...standards, style });
    const path = parse(output).querySelector("path")!;
    assert.equal(path.getAttribute("d"), parse(glyph).querySelector("path")!.getAttribute("d"));
    assert.equal(path.getAttribute("fill"), standards.primaryColor);
    assert.equal(path.getAttribute("stroke"), "none");
    assert.equal(path.getAttribute("fill-rule"), "evenodd");
    assert.equal(normalizeSvg(output, { ...standards, style }), output);
  }
  const result = analyzeSvg(normalizeSvg(glyph, standards), standards);
  assert.ok(result.issues.some((issue) => issue.label === "Filled geometry" && issue.detail.includes("centerlines")));
});

test("combined local adjustment preserves mixed paint roles without filling outlined regions", () => {
  const source = '<svg viewBox="0 0 24 24" fill="none" stroke="#000"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="3" fill="#000" stroke="none"/></svg>';
  const combined = { ...standards, style: "combined" as const };
  const output = normalizeSvg(source, combined);
  const root = parse(output);
  assert.equal(root.querySelector("rect")?.getAttribute("fill"), "none");
  assert.equal(root.querySelector("rect")?.getAttribute("stroke"), standards.primaryColor);
  assert.equal(root.querySelector("circle")?.getAttribute("fill"), standards.primaryColor);
  assert.equal(root.querySelector("circle")?.getAttribute("stroke"), "none");
  const transparent = parse(normalizeSvg('<svg viewBox="0 0 24 24" fill-opacity="0.4"><polyline points="3 3 20 3 12 20"/><path d="M2 2L20 20" fill="none" stroke="none"/></svg>', combined));
  assert.equal(transparent.getAttribute("fill-opacity"), "0.4");
  assert.equal(transparent.querySelector("polyline")?.getAttribute("fill"), standards.primaryColor);
  assert.equal(transparent.querySelector("path")?.getAttribute("stroke"), "none");
  assert.equal(analyzeSvg(output, combined).score, 100);
  assert.ok(analyzeSvg(normalizeSvg(basic, combined), combined).issues.some((issue) => issue.label.includes("needs a redraw")));
});

test("every combined demo has a solid accent and separate outlined structure", () => {
  const paint = (node: Element, attribute: string, fallback: string): string => {
    let current: Element | null = node;
    while (current) {
      if (current.hasAttribute(attribute)) return current.getAttribute(attribute)!;
      current = current.parentElement;
    }
    return fallback;
  };
  for (const brief of ["workspace", "search", "notifications", "collection", "settings", "profile"]) {
    for (const candidate of createDemoCandidates(brief, { ...standards, style: "combined" }, 8)) {
      const root = parse(candidate.svg);
      const shapes = Array.from(root.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon"));
      assert.ok(shapes.some((node) => paint(node, "fill", "black") === standards.primaryColor && paint(node, "stroke", "none") === "none"), `${brief}/${candidate.name} requires a solid accent`);
      assert.ok(shapes.some((node) => paint(node, "fill", "black") === "none" && paint(node, "stroke", "none") === standards.primaryColor), `${brief}/${candidate.name} requires an outlined shape`);
      assert.ok(!analyzeSvg(candidate.svg, { ...standards, style: "combined" }).issues.some((issue) => issue.label.includes("Combined treatment")), `${brief}/${candidate.name}`);
    }
  }
});

test("creative direction controls square caps and joins with restrained rectangle rounding", () => {
  const source = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" ry="4" fill="none" stroke="black"/></svg>';
  const rough = parse(normalizeSvg(source, { ...standards, corner: "square" }));
  const rect = rough.querySelector("rect")!;
  assert.equal(rect.getAttribute("rx"), "0");
  assert.equal(rect.getAttribute("ry"), "0");
  assert.equal(rect.getAttribute("stroke-linecap"), "square");
  assert.equal(rect.getAttribute("stroke-linejoin"), "miter");
  const rounded = parse(normalizeSvg(source, { ...standards, corner: "round" }));
  const scale = (standards.gridSize - standards.padding * 2) / 24;
  assert.ok(Math.abs(Number(rounded.querySelector("rect")!.getAttribute("rx")) * scale - 0.75) < 0.001);
  for (const style of ["line", "filled", "combined"] as const) {
    for (const candidate of createDemoCandidates("workspace", { ...standards, style, corner: "square" }, 8)) {
      const root = parse(candidate.svg);
      assert.equal(root.getAttribute("stroke-linecap"), "square");
      assert.equal(root.getAttribute("stroke-linejoin"), "miter");
      assert.ok(Array.from(root.querySelectorAll("rect")).every((node) => !node.hasAttribute("rx") || node.getAttribute("rx") === "0"));
    }
  }
});

test("structural analysis evaluates effective stroke widths and explains visual limitations", () => {
  const normalized = normalizeSvg(basic, standards);
  assert.equal(analyzeSvg(normalized, standards).score, 100);
  assert.ok(analyzeSvg(basic, standards).issues.some((issue) => issue.label === "Line weight differs"));
  const skewed = '<svg viewBox="0 0 24 24"><g transform="scale(2 1)"><path d="M2 2L10 10" fill="none" stroke="#000"/></g></svg>';
  assert.ok(analyzeSvg(skewed, standards).issues.some((issue) => issue.label === "Review transformed strokes"));
  assert.throws(() => normalizeSvg(basic, { ...standards, padding: 12 }), /Padding/);
  assert.throws(() => createDemoCandidates("test", { ...standards, primaryColor: '" onload="alert(1)' }, 6), /hex colors/);
});

test("export honors review choices, avoids filename and reference collisions, and preserves standards snapshots", () => {
  const painted = '<svg viewBox="0 0 24 24"><defs><linearGradient id="a"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" fill="url(#a)"/></svg>';
  const candidate = (id: string, status: Candidate["status"], svg = basic): Candidate => ({ id, name: id, svg, status, rationale: "Test candidate", source: "normalized" });
  const items: IconItem[] = [
    { id: "a", name: "Same name", brief: "test", round: 1, standards, candidates: [candidate("pending", "pending"), candidate("chosen", "accepted", painted)] },
    { id: "b", name: "Same name", brief: "test", round: 1, candidates: [candidate("one", "shortlisted", painted), candidate("two", "shortlisted", painted)] },
    { id: "c", name: "Same name", brief: "test", round: 1, candidates: [candidate("fallback", "pending", painted)] },
    { id: "d", name: "Sprite", brief: "test", round: 1, candidates: [candidate("reserved", "accepted", painted)] },
  ];
  const files = buildExportBundle(items, { ...standards, gridSize: 48 });
  assert.equal(files.filter((file) => file.name.endsWith(".svg") && file.name !== "sprite.svg").length, 5);
  assert.equal(new Set(files.map((file) => file.name)).size, files.length);
  const sprite = parse(files.find((file) => file.name === "sprite.svg")!.content);
  const ids = Array.from(sprite.querySelectorAll("[id]")).map((node) => node.getAttribute("id"));
  assert.equal(new Set(ids).size, ids.length);
  for (const rect of Array.from(sprite.querySelectorAll("rect"))) {
    const id = rect.getAttribute("fill")!.slice(5, -1);
    assert.ok(ids.includes(id), id);
  }
  const manifest = JSON.parse(files.find((file) => file.name === "manifest.json")!.content);
  assert.equal(manifest.workspaceStandards.gridSize, 48);
  assert.equal(manifest.icons[0].standards.gridSize, 24);
  assert.equal(manifest.icons[1].standards, null);
  assert.match(manifest.icons[1].standardsNote, /No standards snapshot/);
  assert.equal(manifest.icons[0].status, "accepted");
  assert.throws(() => buildExportBundle([], standards), /at least one icon/);
});

test("native ZIP writer stores UTF-8 names and contents with valid checksums and directory offsets", () => {
  const files = [{ name: "icon.svg", content: "123456789" }, { name: "manifest.json", content: '{"name":"Café"}' }];
  const zip = createZip(files);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true), 0x0800);
  assert.equal(view.getUint32(14, true), 0xcbf43926); // Published CRC32 check vector.
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), files.length);
  let entry = view.getUint32(end + 16, true);
  for (const file of files) {
    assert.equal(view.getUint32(entry, true), 0x02014b50);
    const localOffset = view.getUint32(entry + 42, true);
    const nameLength = view.getUint16(localOffset + 26, true);
    const size = view.getUint32(localOffset + 22, true);
    assert.equal(new TextDecoder().decode(zip.slice(localOffset + 30, localOffset + 30 + nameLength)), file.name);
    assert.equal(new TextDecoder().decode(zip.slice(localOffset + 30 + nameLength, localOffset + 30 + nameLength + size)), file.content);
    entry += 46 + view.getUint16(entry + 28, true);
  }
  assert.equal(entry, end);
});

test("Both demo directions have separate authored versions and both accepted treatments export clearly", () => {
  const candidates = createDemoCandidates("search",{...standards,style:"both"},4);
  assert.equal(candidates.length,8);
  assert.equal(new Set(candidates.map(c=>c.pairId)).size,4);
  assert.equal(candidates[0].pairId,candidates[1].pairId);
  assert.equal(candidates[0].treatment,"line");
  assert.equal(candidates[1].treatment,"filled");
  assert.notEqual(candidates[0].svg,candidates[1].svg);
  candidates[0].status="accepted";candidates[1].status="accepted";
  const bundle=buildExportBundle([{id:"pairs",name:"Search",brief:"Find saved work",candidates,round:1,standards:{...standards,style:"both"}}],standards);
  assert.ok(bundle.some(f=>f.name==="search-outlined.svg"));
  assert.ok(bundle.some(f=>f.name==="search-filled.svg"));
  const manifest=JSON.parse(bundle.find(f=>f.name==="manifest.json")!.content);
  assert.deepEqual(manifest.icons.map((i:{treatment:string})=>i.treatment),["line","filled"]);
  assert.deepEqual(manifest.icons.map((i:{standards:{style:string}})=>i.standards.style),["line","filled"]);
});

test("live width changes inherited and explicit strokes without adding outlines or changing geometry", () => {
  const source='<svg viewBox="0 0 24 24" stroke="#123456" stroke-width="1" fill="none"><g transform="translate(1 1) scale(2)"><path d="M2 2L8 8"/><path d="M2 8L8 2" stroke-width="0.5"/></g><path d="M3 3H21V21H3Z M6 6V18H18V6Z" fill="#123456" fill-rule="evenodd" stroke="none"/><path d="M2 12L20 12" stroke-opacity="0" stroke-width="1"/></svg>';
  const changed=engine.updateSvgStrokeWidth(source,3);
  const original=parse(source), root=parse(changed);
  const paths=root.querySelectorAll('path');
  assert.equal(paths[0].getAttribute('stroke-width'),'1.5');
  assert.equal(paths[1].getAttribute('stroke-width'),'1.5');
  assert.equal(paths[2].getAttribute('stroke'),'none');
  assert.equal(paths[2].getAttribute('stroke-width'),null);
  assert.equal(paths[2].getAttribute('fill-rule'),'evenodd');
  assert.equal(paths[3].getAttribute('stroke-width'),'1');
  assert.deepEqual([...paths].map(n=>n.getAttribute('d')),[...original.querySelectorAll('path')].map(n=>n.getAttribute('d')));
  const thinner=parse(engine.updateSvgStrokeWidth(changed,1));
  assert.equal(thinner.querySelector('path')!.getAttribute('stroke-width'),'0.5');
  assert.equal(source, new XMLSerializer().serializeToString(original));
  assert.throws(()=>engine.updateSvgStrokeWidth(source,NaN));
});

test("live width leaves pure filled SVGs, zero strokes and definition geometry intact", () => {
  const filled='<svg viewBox="0 0 24 24" fill="#000"><path fill-rule="evenodd" d="M3 3H21V21H3Z M8 8V16H16V8Z"/></svg>';
  assert.equal(engine.updateSvgStrokeWidth(filled,4),filled);
  const source='<svg viewBox="0 0 24 24"><defs><mask id="m"><rect width="24" height="24" fill="white" stroke="black" stroke-width="1"/></mask></defs><path mask="url(#m)" d="M4 4L20 20" stroke="black" fill="none" stroke-width="0"/></svg>';
  assert.equal(engine.updateSvgStrokeWidth(source,4),source);
  const nonScaling='<svg viewBox="0 0 24 24"><path transform="scale(2)" d="M2 2L8 8" fill="none" stroke="black" vector-effect="non-scaling-stroke"/></svg>';
  assert.equal(parse(engine.updateSvgStrokeWidth(nonScaling,3)).querySelector('path')!.getAttribute('stroke-width'),'3');
});

test("canvas changes resize real SVG units and keep one-unit strokes equal to one new grid cell", () => {
  const source = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#123456" stroke-width="1"><path d="M4 4H20V20H4Z"/></svg>';
  for (const size of [8, 16, 24, 32, 48, 64, 256]) {
    const output = engine.updateSvgCanvasSize(source, size, 1);
    const root = parse(output);
    assert.equal(root.getAttribute("viewBox"), `0 0 ${size} ${size}`);
    assert.equal(root.getAttribute("width"), String(size));
    assert.equal(root.getAttribute("height"), String(size));
    assert.equal(root.querySelector("path")!.getAttribute("d"), "M4 4H20V20H4Z");
    assert.ok(!analyzeSvg(output, { ...standards, gridSize: size, strokeWidth: 1 }).issues.some(issue => issue.label === "Line weight differs"));
    const transform = root.querySelector('[data-iconify-canvas="1"]')?.getAttribute("transform");
    const scale = transform ? Number(transform.match(/matrix\(([^ ]+)/)![1]) : 1;
    const width = Number(root.querySelector("path")!.getAttribute("stroke-width") ?? root.getAttribute("stroke-width"));
    assert.ok(Math.abs(width * scale - 1) < 0.001, `${size}-unit canvas stroke must span one cell`);
  }
  assert.equal(source, '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#123456" stroke-width="1"><path d="M4 4H20V20H4Z"/></svg>');
  for (const size of [0, 7, 24.5, 257, NaN, Infinity]) assert.throws(() => engine.updateSvgCanvasSize(source, size), /whole cells/);
});

test("canvas resizing centers rectangular source viewports and preserves nested and root transforms", () => {
  const source = '<svg viewBox="10 20 40 20" transform="translate(2 3)"><g transform="scale(2)"><path d="M5 10L20 15" fill="none" stroke="black"/></g></svg>';
  const root = parse(engine.updateSvgCanvasSize(source, 24, 1));
  assert.equal(root.getAttribute("transform"), null);
  assert.equal(root.firstElementChild?.getAttribute("transform"), "matrix(0.6 0 0 0.6 -4.8 -4.2)");
  assert.equal(root.querySelector("g g")?.getAttribute("transform"), "scale(2)");
  assert.equal(root.querySelector("path")?.getAttribute("d"), "M5 10L20 15");
  assert.ok(Math.abs(Number(root.querySelector("path")!.getAttribute("stroke-width")) * 1.2 - 1) < 0.001);
  assert.equal(root.getAttribute("preserveAspectRatio"), "xMidYMid meet");
});

test("repeated canvas changes preserve paint, editable corners, and definition geometry without accumulating wrappers", () => {
  const source = '<svg viewBox="0 0 24 24" fill="none" stroke="#123456"><defs><mask id="cut"><rect width="24" height="24" fill="white" stroke="black" stroke-width="1"/></mask></defs><path d="M4 4H20V20H4Z" data-iconify-base-path="M4 4H20V20H4Z" data-iconify-corner-radius="1" mask="url(#cut)"/><path d="M8 8H16V16H8Z" fill="#abcdef" stroke="none" fill-rule="evenodd"/></svg>';
  let output = source;
  for (const size of [48, 24, 48, 24]) output = engine.updateSvgCanvasSize(output, size, 1);
  const root = parse(output);
  assert.equal(root.querySelectorAll('[data-iconify-canvas="1"]').length, 1);
  assert.equal(root.firstElementChild?.getAttribute("transform"), "matrix(1 0 0 1 0 0)");
  assert.equal(root.querySelector("path")!.getAttribute("data-iconify-base-path"), "M4 4H20V20H4Z");
  assert.equal(root.querySelector("path")!.getAttribute("data-iconify-corner-radius"), "1");
  assert.equal(root.querySelector("path")!.getAttribute("mask"), "url(#cut)");
  assert.equal(root.querySelector("mask rect")!.getAttribute("stroke-width"), "1");
  const filled = root.querySelectorAll("path")[1];
  assert.equal(filled.getAttribute("fill"), "#abcdef");
  assert.equal(filled.getAttribute("stroke"), "none");
  assert.equal(filled.getAttribute("stroke-width"), null);
  assert.equal(filled.getAttribute("fill-rule"), "evenodd");
  assert.equal(engine.updateSvgCanvasSize(output, 24, 1), output);

  const normalized = normalizeSvg(basic, standards);
  const resized = engine.updateSvgCanvasSize(normalized, 48, 1);
  assert.equal(parse(resized).querySelectorAll('[data-iconify-fit="1"]').length, 1);
  assert.equal(parse(resized).querySelectorAll('[data-iconify-canvas="1"]').length, 0);
  assert.equal(normalizeSvg(resized, standards), normalized);
});

test("individual and sprite exports retain the resized canvas and its one-unit strokes", () => {
  const svg = engine.updateSvgCanvasSize(basic, 48, 1);
  const settings = { ...standards, gridSize: 48, strokeWidth: 1 };
  const files = buildExportBundle([{ id: "grid", name: "Grid", brief: "Grid test", round: 1, standards: settings, candidates: [{ id: "grid-1", name: "Grid", svg, status: "accepted", source: "edited", rationale: "Grid test" }] }], settings);
  const standalone = parse(files.find(file => file.name === "grid.svg")!.content);
  const symbol = parse(files.find(file => file.name === "sprite.svg")!.content).querySelector("symbol")!;
  assert.equal(standalone.getAttribute("viewBox"), "0 0 48 48");
  assert.equal(symbol.getAttribute("viewBox"), "0 0 48 48");
  assert.equal(standalone.querySelector("path")!.getAttribute("stroke-width"), "0.5");
  assert.equal(symbol.querySelector("path")!.getAttribute("stroke-width"), "0.5");
  assert.equal(standalone.querySelector("g")!.getAttribute("transform"), "matrix(2 0 0 2 0 0)");
  assert.equal(symbol.querySelector("g")!.getAttribute("transform"), "matrix(2 0 0 2 0 0)");
  assert.equal(JSON.parse(files.find(file => file.name === "manifest.json")!.content).icons[0].standards.gridSize, 48);
});
