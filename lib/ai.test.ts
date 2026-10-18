import assert from "node:assert/strict";
import test from "node:test";

// Resolve the source extension at runtime so Node can run the suite directly
// with --experimental-strip-types without adding a runtime test dependency.
const ai: typeof import("./ai") = await import(new URL("./ai.ts", import.meta.url).href);
const { AIError, DEFAULT_AI_MODEL, assertSameOrigin, buildGenerationRequest, generateIcons, parseConnectionInput, parseGenerationInput, parseGenerationOutput, readBoundedJson, validateSafeSvg, verifyAIConnection } = ai;
const engine: typeof import("./icon-engine") = await import(new URL("./icon-engine.ts", import.meta.url).href);
const { describeConstructionGrid }: typeof import("./construction-grid") = await import(new URL("./construction-grid.ts", import.meta.url).href);

const standards = {
  style: "line" as const, strokeWidth: 1.5, gridSize: 24, corner: "round" as const,
  primaryColor: "#171717", secondaryColor: "#a3a3a3", padding: 2,
};
const PNG_PREVIEW = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

function svg(index = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#171717" stroke-width="1.5" stroke-linecap="round"><path d="M${4 + index} 4L20 20"/></svg>`;
}

function input(overrides: Record<string, unknown> = {}) {
  return parseGenerationInput({ brief: "An archive box for saved work", mode: "create", count: 4, standards, ...overrides });
}

function output(count = 4) {
  return {
    candidates: Array.from({ length: count }, (_, i) => ({ name: `Direction ${i + 1}`, svg: svg(i), rationale: "A balanced, legible option." })),
    suggestions: ["Keep consistent optical padding.", "Test the final icon at 16 px."],
  };
}

function providerResponse(data: unknown = output()) {
  return Response.json({ status: "completed", output: [
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(data) }] },
  ] });
}

test("input bounds reject excessive spend, malformed standards, and unsafe references", () => {
  assert.equal(input().count, 4);
  for (const request of [
    { count: 9 }, { count: 3 }, { count: 4.5 }, { brief: "x" },
    { standards: { ...standards, strokeWidth: Infinity } },
    { standards: { ...standards, padding: 13 } },
    { standards: { ...standards, primaryColor: "url(https://attacker.example)" } },
    { standards: { ...standards, colorMode: "rainbow" } },
    { mode: "refine" }, { mode: "normalize", references: [] }, { mode: "redesign", references: [] },
    { creativity: "random" },
    { references: Array(13).fill(svg()) },
    { references: ['<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>'] },
    { model: "https://attacker.example" },
    { apiKey: "a-valid-looking-key\nInjected-Header: true" },
  ]) assert.throws(() => input(request), AIError);
});

test("redesign accepts combined style and creativity while preserving legacy inputs", () => {
  const parsed = input({ mode: "redesign", references: [svg()], standards: { ...standards, style: "combined" } });
  assert.equal(parsed.mode, "redesign");
  assert.equal(parsed.standards.style, "combined");
  assert.equal(parsed.creativity, "exploratory");
  assert.deepEqual(parsed.referenceImages, []);
  assert.equal(input({ creativity: "faithful" }).creativity, "faithful");
  assert.equal(input({ creativity: "radical" }).creativity, "radical");
  assert.equal(input({ mode: "normalize", references: [svg()], standards: { ...standards, style: "duotone" } }).standards.style, "duotone");
});

test("live corner radius has bounded defaults and generated angular geometry stays editable", () => {
  assert.equal(input().standards.cornerRadius, 1);
  assert.equal(input({ standards: { ...standards, corner: "square" } }).standards.cornerRadius, 0);
  assert.equal(input({ standards: { ...standards, corner: "square", cornerRadius: 3 } }).standards.cornerRadius, 0);
  for (const cornerRadius of [0, .5, 2.25, 12]) {
    const parsed = input({ standards: { ...standards, cornerRadius } });
    assert.equal(parsed.standards.cornerRadius, cornerRadius);
    const request = buildGenerationRequest(parsed, DEFAULT_AI_MODEL);
    assert.match(request.instructions, new RegExp(`target live corner radius is ${cornerRadius} pixels = ${cornerRadius} SVG units`));
    assert.match(request.instructions, /return the sharp base construction/);
    assert.match(request.instructions, /use miter joins, and set rectangle rx=0 and ry=0/);
    assert.match(request.instructions, /Preserve intrinsic curves that communicate the subject/);
    assert.match(request.instructions, /do not bake decorative corner rounding/);
    assert.match(request.instructions, /A radius of 0 leaves angular corners sharp/);
  }
  for (const cornerRadius of [-1, 12.1, Infinity, NaN, "1", null]) assert.throws(() => input({ standards: { ...standards, cornerRadius } }), AIError);
  assert.equal(input({ standards: { ...standards, gridSize: 32, cornerRadius: 16 } }).standards.cornerRadius, 16);
  const rough = buildGenerationRequest(input({ standards: { ...standards, corner: "square" } }), DEFAULT_AI_MODEL);
  assert.match(rough.instructions, /target corner radius is 0 pixels/);
});

test("minimum internal spacing uses grid units, excludes intentional contacts, and validates bounds", () => {
  assert.equal(input().standards.minSpacing, 1);
  for (const minSpacing of [0, .5, 1, 2.25, 6]) {
    const parsed = input({ standards: { ...standards, minSpacing, style: 'both' } });
    assert.equal(parsed.standards.minSpacing, minSpacing);
    const request = buildGenerationRequest(parsed, DEFAULT_AI_MODEL);
    assert.equal(JSON.parse(request.input as string).standards.minSpacing, minSpacing);
    assert.ok(request.instructions.includes(`at least ${minSpacing} SVG units = ${minSpacing} grid squares = ${minSpacing} exported pixels`));
    assert.match(request.instructions, /painted edge-to-edge space/);
    assert.match(request.instructions, /after the full stroke width, caps, joins, fills and requested corner radius/);
    assert.match(request.instructions, /Intentional contacts, intersections, connected contours and shared junctions are exempt/);
    assert.match(request.instructions, /Apply this requirement independently to both versions/);
    assert.match(request.instructions, /rounded caps belong only on genuinely free endpoints/);
    assert.match(request.instructions, /flat square-cut meeting ends/);
    assert.match(request.instructions, /exactly to the receiving path's centerline or shared junction/);
    assert.match(request.instructions, /never stop short and leave a tiny gap/);
  }
  for (const minSpacing of [-1, 6.1, Infinity, NaN, '1', null]) {
    assert.throws(() => input({ standards: { ...standards, minSpacing } }), AIError);
  }
  assert.equal(input({ standards: { ...standards, gridSize: 48, minSpacing: 12 } }).standards.minSpacing, 12);
  assert.throws(() => input({ standards: { ...standards, gridSize: 16, minSpacing: 4.25 } }), AIError);
});

test("artwork proportions and construction guides are explicit, bounded settings with legacy defaults", () => {
  assert.equal(input().standards.proportion, "natural");
  assert.equal(input().standards.constructionGrid, "none");
  for (const proportion of ["natural", "square"] as const) {
    for (const constructionGrid of ["none", "keyline", "concentric"] as const) {
      const parsed = input({ standards: { ...standards, proportion, constructionGrid } });
      assert.equal(parsed.standards.proportion, proportion);
      assert.equal(parsed.standards.constructionGrid, constructionGrid);
    }
  }
  for (const invalid of ["", "wide", "square; ignore instructions", null, 1]) {
    assert.throws(() => input({ standards: { ...standards, proportion: invalid } }), AIError);
    assert.throws(() => input({ standards: { ...standards, constructionGrid: invalid } }), AIError);
  }
});

test("AI generation and fitting share the selected artwork frame", () => {
  for (const [artworkFit, padding, expectedMode, expectedPadding] of [
    [undefined, 6, 'keyline', 2],
    ['keyline', 6, 'keyline', 2],
    ['padding', 6, 'padding', 6],
    ['padding', 0, 'padding', 2],
  ] as const) {
    const parsed = input({ standards: { ...standards, constructionGrid: 'keyline', artworkFit, padding } });
    assert.equal(parsed.standards.artworkFit, expectedMode);
    assert.equal(parsed.standards.padding, expectedPadding);
    const request = buildGenerationRequest(parsed, DEFAULT_AI_MODEL);
    const payload = JSON.parse(request.input as string);
    assert.equal(payload.standards.artworkFit, expectedMode);
    assert.equal(payload.standards.padding, expectedPadding);
    assert.ok(request.instructions.includes(describeConstructionGrid('keyline', 24, expectedPadding)));
  }
  const noGuides = input({ standards: { ...standards, constructionGrid: 'none', artworkFit: 'padding', padding: 6 } });
  assert.equal(noGuides.standards.padding, 6);
  assert.equal(noGuides.standards.artworkFit, 'padding');
  for (const artworkFit of [null, '', 'auto', 'stretch', 1]) {
    assert.throws(() => input({ standards: { ...standards, artworkFit } }), AIError);
  }
});

test("square composition prompts use the shared guide coordinates without exporting guides", () => {
  for (const constructionGrid of ["keyline", "concentric"] as const) {
    for (const [gridSize, padding] of [[24, 3], [32, 4]]) {
      const request = buildGenerationRequest(input({ standards: { ...standards, proportion: "square", constructionGrid, gridSize, padding, artworkFit: 'padding' } }), DEFAULT_AI_MODEL);
      assert.equal(typeof request.input, "string");
      const data = JSON.parse(request.input as string);
      assert.equal(data.standards.proportion, "square");
      assert.equal(data.standards.constructionGrid, constructionGrid);
      assert.ok(request.instructions.includes(describeConstructionGrid(constructionGrid, gridSize, padding)));
      assert.match(request.instructions, /VISIBLE artwork width must equal its height \(target 1:1\), not just a square viewBox/);
      assert.match(request.instructions, /full visible fill and stroke extents/);
      assert.match(request.instructions, /Recompose the silhouette/);
      assert.match(request.instructions, /Do not apply nonuniform stretching/);
      assert.match(request.instructions, /Do not add invisible geometry, background frames, or unrelated marks to game the bounds/);
      assert.match(request.instructions, /small optical overshoot, but the target geometric extents remain equal/);
      assert.match(request.instructions, /Tall or wide keylines may guide internal details; they never authorize a tall or wide final outline/);
      assert.match(request.instructions, /Never draw or export guide lines, guide circles, grid marks, or background frames/);
      assert.match(request.instructions, /do not override the selected artwork proportion, padding, corner treatment, or geometry style/);
    }
  }
  const legacy = buildGenerationRequest({ ...input(), standards }, DEFAULT_AI_MODEL);
  assert.match(legacy.instructions, /NATURAL ARTWORK/);
  assert.doesNotMatch(legacy.instructions, /SQUARE ARTWORK/);
  assert.ok(legacy.instructions.includes(describeConstructionGrid("none", standards.gridSize, standards.padding)));
  const data = JSON.parse(legacy.input as string);
  assert.equal(data.standards.proportion, "natural");
  assert.equal(data.standards.constructionGrid, "none");
});

test("every generation mode uses native pixel coordinates with or without construction guides", () => {
  for (const mode of ["create", "refine", "redesign", "normalize"] as const) {
    for (const constructionGrid of ["none", "keyline", "concentric"] as const) {
      const request = buildGenerationRequest(input({ mode, references: [svg()], standards: { ...standards, gridSize: 32, constructionGrid, perspective: "isometric" } }), DEFAULT_AI_MODEL);
      assert.match(request.instructions, /1 exported pixel = 1 SVG unit = 1 grid square/);
      assert.match(request.instructions, /selected canvas contains exactly 32 × 32 cells/);
      const expectedPadding = constructionGrid === 'none' ? 2 : 32 / 12;
      const expectedExtent = 32 - 2 * expectedPadding;
      assert.ok(request.instructions.includes(`usable region extends from ${expectedPadding} to ${32 - expectedPadding} on both axes, a ${expectedExtent} × ${expectedExtent} canvas-unit area`));
      assert.match(request.instructions, /Preserve natural proportions, meaningful negative space and deliberate optical adjustments/);
      assert.match(request.instructions, /viewBox="0 0 32 32", width="32" and height="32"/);
      assert.match(request.instructions, /applies even when construction guides are off/);
      assert.match(request.instructions, /Preview zoom changes only the display, never the exported dimensions or coordinates/);
      assert.match(request.instructions, /Stroke width is exactly 1\.5 exported pixels = 1\.5 SVG units/);
      assert.match(request.instructions, /Fractional Bézier control points, isometric coordinates, optical adjustments and half-pixel stroke alignment are allowed/);
    }
  }
});

test("generated export dimensions match their grid without scaling fractional geometry or references", () => {
  for (const grid of [16, 24, 32, 48]) {
    const roots = [
      `<svg viewBox="0 0 ${grid} ${grid}">`,
      `<svg width="96" height="8" viewBox="0 0 ${grid} ${grid}">`,
      `<svg width='${grid}' viewBox="0 0 ${grid} ${grid}" aria-label="Use width='8' details">`,
      `<svg width="0" height="-1" viewBox="0 0 ${grid} ${grid}">`,
    ];
    const generated = output();
    generated.candidates = generated.candidates.map((candidate, index) => ({
      ...candidate,
      svg: `${roots[index]}<path d="M${2 + index}.5 3.5C4.25 5.75 8.625 7.125 10.5 11.5" fill="none" stroke="#171717" stroke-width="1.5"/><rect x="3.25" y="6.5" width="7.5" height="2.75"/></svg>`,
    }));
    const parsed = parseGenerationOutput(generated, 4, DEFAULT_AI_MODEL, grid);
    parsed.candidates.forEach((candidate, index) => {
      const root = candidate.svg.slice(0, candidate.svg.indexOf(">") + 1);
      const dimensions = new Map([...root.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1], match[2] ?? match[3]]));
      assert.equal(Number(dimensions.get("width")), grid);
      assert.equal(Number(dimensions.get("height")), grid);
      assert.equal(dimensions.get("viewBox"), `0 0 ${grid} ${grid}`);
      assert.equal(candidate.svg.slice(root.length), generated.candidates[index].svg.slice(roots[index].length));
      assert.equal(validateSafeSvg(generated.candidates[index].svg, grid), generated.candidates[index].svg, "reference validation must not rewrite source dimensions");
    });
    assert.match(parsed.candidates[2].svg, /aria-label="Use width='8' details"/);
    assert.equal(parseGenerationInput({ brief: "Refine the source", mode: "refine", count: 4, standards, references: [generated.candidates[1].svg] }).references[0], generated.candidates[1].svg);
    assert.throws(() => parseGenerationOutput(generated, 4, DEFAULT_AI_MODEL, grid + 1), AIError, "wrong coordinate systems must reject rather than stretch");
  }
  const generated = output();
  assert.deepEqual(parseGenerationOutput(generated, 4, DEFAULT_AI_MODEL, 24).candidates, generated.candidates, "correct native dimensions stay unchanged");
});

test("generated visible strokes use the requested canvas units while preserving creative geometry", async () => {
  for (const gridSize of [16, 24, 32, 64]) {
    for (const strokeWidth of [.5, 1, 1.5, 6]) {
      const generated = output();
      generated.candidates = generated.candidates.map((candidate, index) => ({ ...candidate, svg:
        `<svg viewBox="0 0 ${gridSize} ${gridSize}" fill="none" stroke="#171717" stroke-width="4"><g stroke-width="2"><path d="M${3 + index}.25 3.5C4.5 1.25 9.25 5.5 10.75 9.5" stroke-width="${index === 0 ? -.5 : .25}" stroke-linecap="round"/><circle cx="9" cy="10" r="1.25"/></g></svg>`,
      }));
      const result = await generateIcons(input({ standards: { ...standards, gridSize, strokeWidth } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch });
      result.candidates.forEach((candidate, index) => {
        const path = candidate.svg.match(/<path\b[^>]*>/)![0];
        const circle = candidate.svg.match(/<circle\b[^>]*>/)![0];
        assert.match(path, new RegExp(`stroke-width="${strokeWidth}"`));
        assert.match(circle, new RegExp(`stroke-width="${strokeWidth}"`));
        assert.equal(path.match(/d="([^"]*)"/)![1], generated.candidates[index].svg.match(/d="([^"]*)"/)![1]);
        assert.match(path, /stroke-linecap="round"/);
        assert.match(circle, /cx="9" cy="10" r="1.25"/);
        assert.match(candidate.svg, new RegExp(`width="${gridSize}" height="${gridSize}"`));
        assert.equal(validateSafeSvg(candidate.svg, gridSize), candidate.svg);
      });
    }
  }
});

test("stroke normalization composes nested transforms and removes viewport-dependent weights", async () => {
  const cases = [
    { outer: "translate(2 3) scale(2)", inner: "rotate(30 6 6)", scale: 2 },
    { outer: "scale(4)", inner: "scale(.5) rotate(45)", scale: 2 },
    { outer: "scale(2 1)", inner: "scale(.5 1)", scale: 1 },
    { outer: "matrix(0 -3 3 0 12 12)", inner: "scale(-1 1)", scale: 3 },
  ];
  const generated = output();
  generated.candidates = generated.candidates.map((candidate, index) => ({ ...candidate, svg:
    `<svg width="240" height="240" viewBox="0 0 24 24" fill="none" stroke="#171717" stroke-width="5"><g transform="${cases[index].outer}"><path transform="${cases[index].inner}" vector-effect="non-scaling-stroke" d="M${2 + index} 2C3.5 2 4.5 3 5 4"/></g></svg>`,
  }));
  const result = await generateIcons(input({ standards: { ...standards, strokeWidth: 1 } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch });
  result.candidates.forEach((candidate, index) => {
    const path = candidate.svg.match(/<path\b[^>]*>/)![0];
    const width = Number(path.match(/stroke-width="([^"]*)"/)![1]);
    assert.ok(Math.abs(width * cases[index].scale - 1) < 1e-10, "effective stroke must cover one canvas cell");
    assert.match(candidate.svg, /width="24" height="24"/);
    assert.ok(candidate.svg.includes(`transform="${cases[index].outer}"`));
    assert.ok(path.includes(`transform="${cases[index].inner}"`));
    assert.equal(path.match(/d="([^"]*)"/)![1], generated.candidates[index].svg.match(/d="([^"]*)"/)![1]);
    assert.doesNotMatch(candidate.svg, /vector-effect="non-scaling-stroke"/);
    assert.equal(validateSafeSvg(candidate.svg, 24), candidate.svg);
  });
});

test("uncompensable stroke transforms reject without imposing bounds or reshaping filled artwork", async () => {
  for (const transform of ["scale(2 1)", "skewX(20)", "matrix(1 0 .2 1 0 0)", "scale(0)", "rotate(1 2)", "scale(1e999)"]) {
    const generated = output();
    generated.candidates[0].svg = svg().replace("<path", `<path transform="${transform}"`);
    await assert.rejects(generateIcons(input(), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "invalid_output");
  }
  const generated = output();
  generated.candidates = generated.candidates.map((candidate, index) => ({ ...candidate, svg:
    `<svg width="24" height="24" viewBox="0 0 24 24" fill="#171717"><g transform="scale(2 1)"><path d="M${3 + index} 3Q5 2 6 3L5 5Z"/><path d="M1 1L2 2" stroke="#171717" stroke-width="4" opacity="0"/></g></svg>`,
  }));
  const result = await generateIcons(input({ standards: { ...standards, style: "filled" } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch });
  assert.deepEqual(result.candidates, generated.candidates, "small organic filled silhouettes retain their own geometry and optical size");
});

test("color mode is independent of geometry style and hides unused accent colors", () => {
  for (const style of ["line", "filled", "combined"] as const) {
    const mono = input({ standards: { ...standards, style } });
    assert.equal(mono.standards.colorMode, "mono");
    assert.equal(mono.standards.secondaryColor, standards.primaryColor);
    const request = buildGenerationRequest(mono, DEFAULT_AI_MODEL);
    assert.match(request.instructions, /NO second color and no decorative accent/);
    assert.ok(!JSON.stringify(request).includes(standards.secondaryColor));
    const duo = input({ standards: { ...standards, style, colorMode: "duo" } });
    assert.equal(duo.standards.secondaryColor, standards.secondaryColor);
    assert.match(buildGenerationRequest(duo, DEFAULT_AI_MODEL).instructions, /outlined icons may use both chosen colors in their strokes/);
  }
  const legacy = input({ standards: { ...standards, style: "duotone" } });
  assert.equal(legacy.standards.colorMode, "duo");
  assert.equal(legacy.standards.secondaryColor, standards.secondaryColor);
  assert.equal(input({ standards: { ...standards, style: "duotone", colorMode: "mono" } }).standards.secondaryColor, standards.primaryColor);
  const direct = buildGenerationRequest({ ...input(), standards: { ...standards, secondaryColor: "#7c3aed" } }, DEFAULT_AI_MODEL);
  assert.ok(!JSON.stringify(direct).includes("#7c3aed"));
  assert.match(direct.instructions, /Checkerboard patterns.*are presentation aids, not part of the icon/);
  assert.match(buildGenerationRequest(input({ standards: { ...standards, style: "combined" } }), DEFAULT_AI_MODEL).instructions, /Combined does not imply a second color/);
});

test("color palettes validate up to four percentage targets before building an AI request", () => {
  const colors = ["#171717", "#36a269", "#2877c7", "#d58d33"];
  for (let count = 1; count <= 4; count++) {
    const palette = colors.slice(0, count).map((color, index) => ({ color, percentage: count === 3 ? index === 2 ? 33.34 : 33.33 : 100 / count, locked: false }));
    const parsed = input({ standards: { ...standards, colorMode: "color", palette } });
    assert.deepEqual(parsed.standards.palette, palette);
    assert.equal(parsed.standards.colorMode, "color");
  }
  const valid = [{ color: "#171717", percentage: 60, locked: true }, { color: "#36a269", percentage: 40, locked: false }];
  for (const palette of [
    undefined, null, [], Array(5).fill({ color: "#171717", percentage: 20, locked: false }),
    [{ ...valid[0], color: "red", percentage: 100 }], [{ ...valid[0], color: "url(https://attacker.example)", percentage: 100 }],
    [{ ...valid[0], percentage: NaN }], [{ ...valid[0], percentage: Infinity }],
    [{ ...valid[0], percentage: -1 }, { ...valid[1], percentage: 101 }],
    [{ ...valid[0], percentage: "60" }, valid[1]], [{ ...valid[0], locked: "true" }, valid[1]],
    [{ color: "#171717", percentage: 100 }], [null],
    [{ ...valid[0], percentage: 59.9 }, valid[1]], [{ ...valid[0], percentage: 60.1 }, valid[1]],
    [{ ...valid[0], percentage: 60.01 }, { ...valid[1], locked: true }],
  ]) assert.throws(() => input({ standards: { ...standards, colorMode: "color", palette } }), AIError);
  assert.deepEqual(input({ standards: { ...standards, colorMode: "color", palette: valid } }).standards.palette, valid);
});

test("AI color percentages describe painted coverage and omit zero-share and dormant colors", () => {
  const palette = [
    { color: "#fa0011", percentage: 0, locked: true },
    { color: "#171717", percentage: 60, locked: true },
    { color: "#36a269", percentage: 20, locked: false },
    { color: "#2877c7", percentage: 20, locked: false },
  ];
  for (const style of ["line", "filled", "combined", "both"] as const) {
    const request = buildGenerationRequest(input({ standards: { ...standards, style, colorMode: "color", palette } }), DEFAULT_AI_MODEL);
    assert.match(request.instructions, /#171717: 60%, #36a269: 20%, #2877c7: 20%/);
    assert.match(request.instructions, /approximate shares of the icon's visible painted area/);
    assert.match(request.instructions, /NOT opacity values, transparency, gradients/);
    assert.match(request.instructions, /same coverage targets independently in every direction and each outlined\/filled version/);
    assert.match(request.instructions, /Keep the requested minimum spacing/);
    assert.ok(!JSON.stringify(request).includes("#fa0011"), "zero-share colors must not leak into model design data");
    assert.ok(!JSON.stringify(request).includes(standards.secondaryColor), "legacy secondary color must not override the chosen palette");
  }
  const mono = input({ standards: { ...standards, colorMode: "mono", palette } });
  assert.deepEqual(mono.standards.palette, [{ color: "#171717", percentage: 100, locked: false }]);
  const request = buildGenerationRequest(mono, DEFAULT_AI_MODEL);
  for (const color of ["#fa0011", "#36a269", "#2877c7"]) assert.ok(!JSON.stringify(request).includes(color));
});

test("generated multicolor palettes allow all selected paints and reject excluded and zero-share paints", async () => {
  const palette = ["#171717", "#36a269", "#2877c7", "#d58d33"].map((color) => ({ color, percentage: 25, locked: false }));
  const generated = output();
  generated.candidates = generated.candidates.map((candidate, index) => ({ ...candidate, svg: candidate.svg.replace("#171717", palette[index].color) }));
  const options = { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch };
  const parsed = input({ standards: { ...standards, colorMode: "color", palette } });
  const result = await generateIcons(parsed, options);
  assert.deepEqual(result.candidates, generated.candidates, "allowed paints do not rewrite vector geometry");
  for (const color of ["#ff0011", "currentColor"]) {
    generated.candidates[3].svg = svg(3).replace("#171717", color);
    await assert.rejects(generateIcons(parsed, options), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
  }
  generated.candidates[3].svg = svg(3).replace("#171717", "#d58d33");
  const zeroShare = palette.map((entry, index) => ({ ...entry, percentage: index === 3 ? 0 : index === 2 ? 33.34 : 33.33, locked: index === 3 }));
  await assert.rejects(generateIcons(input({ standards: { ...standards, colorMode: "color", palette: zeroShare } }), options), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
});

test("generated palettes reject unexpected visible colors without rewriting icon geometry", async () => {
  const generated = output();
  generated.candidates[0].svg = generated.candidates[0].svg.replace("<path", '<circle cx="12" cy="8" r="2" fill="#7c3aed" stroke="none"/><path');
  const options = { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch };
  await assert.rejects(generateIcons(input(), options), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
  const duo = input({ standards: { ...standards, colorMode: "duo", secondaryColor: "#7c3aed" } });
  const result = await generateIcons(duo, options);
  assert.equal(result.candidates[0].svg, generated.candidates[0].svg);
  generated.candidates[0].svg = generated.candidates[0].svg.replace('fill="#7c3aed"', 'fill="white"');
  await assert.rejects(generateIcons(duo, options), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
  generated.candidates[0].svg = svg().replace("<path", '<g stroke="#7c3aed"><path').replace("</svg>", "</g></svg>");
  await assert.rejects(generateIcons(input(), options), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
});

test("palette validation checks strokes after invalid negative weights are repaired", async () => {
  const generated = output();
  generated.candidates[0].svg = svg().replace('stroke="#171717"', 'stroke="#ff0000"').replace('stroke-width="1.5"', 'stroke-width="-1"');
  await assert.rejects(generateIcons(input(), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "palette_mismatch");
});

test("palette checks respect inherited paints, equivalent notation, and transparent geometry", async () => {
  const generated = output();
  generated.candidates[0].svg = svg().replace('stroke="#171717"', 'stroke="rgb(23, 23, 23)"');
  generated.candidates[1].svg = svg(1).replace('stroke="#171717"', 'stroke="#171717ff"').replace("<path", '<g fill="#7c3aed"><path fill="none"').replace("</svg>", "</g></svg>");
  generated.candidates[2].svg = svg(2).replace("<path", '<circle cx="12" cy="8" r="2" fill="#7c3aed" opacity="0"/><path');
  generated.candidates[3].svg = svg(3).replace('stroke="#171717"', 'stroke="currentColor"').replace("<path", '<circle cx="12" cy="8" r="2" fill="rgba(124,58,237,0)" stroke="transparent"/><path');
  const result = await generateIcons(input(), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch });
  assert.deepEqual(result.candidates, generated.candidates);
  const black = output();
  black.candidates = black.candidates.map((candidate) => ({ ...candidate, svg: candidate.svg.replace("#171717", "#000") }));
  const shortened = await generateIcons(input({ standards: { ...standards, primaryColor: "#000000" } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(black)) as typeof fetch });
  assert.equal(shortened.candidates[0].svg, black.candidates[0].svg);
});

test("image references allow only bounded local PNG previews aligned to SVG references", () => {
  assert.deepEqual(input({ references: [svg()], referenceImages: [PNG_PREVIEW] }).referenceImages, [PNG_PREVIEW]);
  const oversizedDimensions = Buffer.from(PNG_PREVIEW.split(",")[1], "base64");
  oversizedDimensions.writeUInt32BE(4096, 16);
  for (const preview of [
    "https://example.com/image.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,bm90LXBuZw==",
    "data:image/png;base64,%%%bad%%%",
    `data:image/png;base64,${oversizedDimensions.toString("base64")}`,
    `data:image/png;base64,${"A".repeat(140_000)}`,
    PNG_PREVIEW.slice(0, -4),
  ]) assert.throws(() => input({ references: [svg()], referenceImages: [preview] }), AIError);
  assert.throws(() => input({ referenceImages: [PNG_PREVIEW] }), AIError);
  assert.throws(() => input({ references: [svg()], referenceImages: [PNG_PREVIEW, PNG_PREVIEW] }), AIError);
  assert.throws(() => input({ references: Array(5).fill(svg()), referenceImages: Array(5).fill(PNG_PREVIEW) }), AIError);
});

test("SVG parser permits self-contained vector shapes and rejects executable or ambiguous SVG", () => {
  assert.equal(validateSafeSvg(svg(), 24), svg());
  assert.ok(validateSafeSvg('<svg viewBox="0 0 24 24"><title>Save &amp; archive</title><g transform="translate(1 1)"><rect x="1" y="2" width="12" height="10" rx="2" fill="#000"/></g></svg>'));
  const attacks = [
    '<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><foreignObject><div>Hi</div></foreignObject></svg>',
    '<svg viewBox="0 0 24 24"><image href="https://attacker.example"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" style="fill:url(https://attacker.example)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" fill="url(#external)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" fill="&#117;rl(test)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1"/><animate attributeName="href"/></svg>',
    '<svg xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 24 24"><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" xlink:href="javascript:alert(1)"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" stroke="red"stroke="blue"/></svg>',
    '<svg viewBox="0 0 24 24"><path d="M0 0L1 1" stroke="red" stroke="blue"/></svg>',
    '<svg viewBox="0 0 24 24"><g><path d="M0 0L1 1"/></svg>',
    '<svg viewBox="0 0 24 24"><title><path d="M0 0L1 1"/></title></svg>',
    '<svg viewBox="0 0 24 24"/>',
    svg() + svg(),
    svg() + "<",
  ];
  for (const attack of attacks) assert.throws(() => validateSafeSvg(attack), AIError, attack);
  assert.throws(() => validateSafeSvg(svg(), 32), AIError);
});

test("edited references preserve paired path-corner metadata without admitting active or malformed attributes", () => {
  for (const radius of [0, .5, 2, 10_000]) {
    const reference = svg().replace("<path", `<path data-iconify-base-path="M4.5 4L20 4L20 20Z" data-iconify-corner-radius="${radius}"`);
    assert.equal(validateSafeSvg(reference), reference);
    assert.equal(input({ mode: "refine", references: [reference] }).references[0], reference);
  }
  for (const attributes of [
    'data-iconify-base-path="M4 4L20 20"',
    'data-iconify-corner-radius="1"',
    'data-iconify-base-path="javascript:alert(1)" data-iconify-corner-radius="1"',
    'data-iconify-base-path="M4 4L1e999 20" data-iconify-corner-radius="1"',
    'data-iconify-base-path="M4 4L20 20" data-iconify-corner-radius="url(https://attacker.example)"',
    'data-iconify-base-path="M4 4L20 20" data-iconify-corner-radius="&#49;"',
    'data-iconify-base-path="M4 4L20 20" data-iconify-corner-radius="1" onload="alert(1)"',
    ...[-1, 10_001, Infinity, "NaN", "1e999", "1px"].map((radius) => `data-iconify-base-path="M4 4L20 20" data-iconify-corner-radius="${radius}"`),
  ]) assert.throws(() => validateSafeSvg(svg().replace("<path", `<path ${attributes}`)), AIError);
  const metadata = 'data-iconify-base-path="M4 4L20 20" data-iconify-corner-radius="1"';
  assert.throws(() => validateSafeSvg(svg().replace("<svg ", `<svg ${metadata} `)), AIError);
  assert.throws(() => validateSafeSvg(svg().replace("<path", `<g ${metadata}><path`).replace("</svg>", "</g></svg>")), AIError);
});

test("junction metadata uses exact values on its designated elements", () => {
  const reference = svg().replace('<svg ', '<svg data-iconify-junctions="1" ').replace('<path ', '<path data-iconify-junction-cap="1" ');
  assert.equal(validateSafeSvg(reference, 24), reference);
  assert.equal(input({ mode: 'refine', references: [reference] }).references[0], reference);
  for (const value of ['', '0', '2', 'true', '1px', '&#49;']) {
    assert.throws(() => validateSafeSvg(svg().replace('<svg ', `<svg data-iconify-junctions="${value}" `)), AIError);
    assert.throws(() => validateSafeSvg(svg().replace('<path ', `<path data-iconify-junction-cap="${value}" `)), AIError);
  }
  assert.throws(() => validateSafeSvg(svg().replace('<path ', '<path data-iconify-junctions="1" ')), AIError);
  assert.throws(() => validateSafeSvg(svg().replace('<svg ', '<svg data-iconify-junction-cap="1" ')), AIError);
  for (const attribute of ['data-iconify-junctions', 'data-iconify-junction-cap']) {
    assert.throws(() => validateSafeSvg(`<svg viewBox="0 0 24 24"><g ${attribute}="1"><path d="M0 0L1 1"/></g></svg>`), AIError);
    assert.throws(() => validateSafeSvg(`<svg viewBox="0 0 24 24"><rect ${attribute}="1" x="2" y="2" width="20" height="20"/></svg>`), AIError);
  }
});

test("exported junction caps survive sanitization and AI-reference round trips", async () => {
  const { default: paper } = await import('paper');
  const { Window } = await import('happy-dom');
  const { createVectorShape, exportVectorSvg, importVectorSvg }: typeof import('./vector-editor-geometry') = await import(new URL('./vector-editor-geometry.ts', import.meta.url).href);
  const window = new Window();
  const previousParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  const previousSerializer = Object.getOwnPropertyDescriptor(globalThis, 'XMLSerializer');
  Object.defineProperty(globalThis, 'DOMParser', { value: window.DOMParser, configurable: true });
  Object.defineProperty(globalThis, 'XMLSerializer', { value: window.XMLSerializer, configurable: true });
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
  try {
    const shapes = ['M12 4V12', 'M5 12H19'].map(d => createVectorShape(d, { fill: 'none', stroke: '#171717', strokeWidth: 1, lineCap: 'round' }));
    const exported = exportVectorSvg({ width: 24, height: 24, shapes }, scope);
    assert.match(exported, /data-iconify-junctions="1"/);
    assert.match(exported, /data-iconify-junction-cap="1"/);
    const reference = engine.sanitizeSvg(exported);
    const parsed = input({ mode: 'refine', references: [reference] });
    assert.equal(parsed.references[0], reference);
    const reopened = importVectorSvg(scope, parsed.references[0]);
    assert.equal(reopened.shapes.length, 2);
    const reexported = exportVectorSvg(reopened, scope);
    assert.equal(validateSafeSvg(reexported, 24), reexported);
    assert.equal((reexported.match(/data-iconify-junction-cap="1"/g) ?? []).length, 1);
  } finally {
    scope.project.remove();
    if (previousParser) Object.defineProperty(globalThis, 'DOMParser', previousParser);
    else Reflect.deleteProperty(globalThis, 'DOMParser');
    if (previousSerializer) Object.defineProperty(globalThis, 'XMLSerializer', previousSerializer);
    else Reflect.deleteProperty(globalThis, 'XMLSerializer');
    await window.happyDOM.close();
  }
});

test("all engine demo directions can become AI refinement references", () => {
  for (const style of ["line", "filled", "duotone"] as const) {
    for (const corner of ["round", "square"] as const) {
      for (const brief of ["workspace", "collection", "search", "notification", "settings", "profile"]) {
        const candidates = engine.createDemoCandidates(brief, { ...standards, style, corner }, 8);
        const parsed = input({ mode: "refine", references: candidates.map((candidate) => candidate.svg) });
        assert.equal(parsed.references.length, 8);
        assert.match(parsed.references[0], /data-iconify-source-viewbox="3 3 18 18"/);
        assert.match(parsed.references[0], /data-iconify-fit="1"/);
      }
    }
  }
  for (const metadata of [
    'data-iconify-source-viewbox="0 0 -20 24"',
    'data-iconify-source-viewbox="0 0 Infinity 24"',
    'data-iconify-source-viewbox="url(https://example.com)"',
  ]) assert.throws(() => validateSafeSvg(svg().replace("<svg ", `<svg ${metadata} `)), AIError);
  assert.throws(() => validateSafeSvg(svg().replace("<path ", '<path data-iconify-fit="1" ')), AIError);
  assert.throws(() => validateSafeSvg('<svg viewBox="0 0 24 24"><g data-iconify-fit="2"><path d="M0 0L1 1"/></g></svg>'), AIError);
});

test("browser-normalized and canvas-resized engine SVGs remain valid AI refinement references", async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
  const previousSerializer = Object.getOwnPropertyDescriptor(globalThis, "XMLSerializer");
  Object.defineProperty(globalThis, "DOMParser", { value: window.DOMParser, configurable: true });
  Object.defineProperty(globalThis, "XMLSerializer", { value: window.XMLSerializer, configurable: true });
  try {
    for (const style of ["line", "filled", "duotone"] as const) {
      const normalized = engine.createDemoCandidates("workspace", standards, 4).map((candidate) => engine.normalizeSvg(candidate.svg, { ...standards, style, gridSize: 32, padding: 4 }));
      const parsed = input({ mode: "refine", standards: { ...standards, style, gridSize: 32, padding: 4 }, references: normalized });
      assert.equal(parsed.references.length, 4);
      for (const reference of parsed.references) {
        assert.match(reference, /data-iconify-source-viewbox="3 3 18 18"/);
        assert.match(reference, /data-iconify-fit="1"/);
        assert.doesNotThrow(() => validateSafeSvg(reference, 32));
      }
    }
    const resized = Array.from({ length: 4 }, (_, index) => engine.updateSvgCanvasSize(svg(index), 32, 1));
    const parsed = input({ mode: "refine", standards: { ...standards, gridSize: 32, strokeWidth: 1 }, references: resized });
    assert.deepEqual(parsed.references, resized);
    for (const reference of parsed.references) {
      assert.match(reference, /data-iconify-canvas="1"/);
      assert.doesNotThrow(() => validateSafeSvg(reference, 32));
    }
  } finally {
    if (previousParser) Object.defineProperty(globalThis, "DOMParser", previousParser);
    else Reflect.deleteProperty(globalThis, "DOMParser");
    if (previousSerializer) Object.defineProperty(globalThis, "XMLSerializer", previousSerializer);
    else Reflect.deleteProperty(globalThis, "XMLSerializer");
    await window.happyDOM.close();
  }
});

test("canvas-resize metadata permits only the value one on group elements", () => {
  for (const value of ["0", "2", "true", "", "1px", "url(https://example.com)"]) {
    assert.throws(() => validateSafeSvg(`<svg viewBox="0 0 24 24"><g data-iconify-canvas="${value}"><path d="M4 4L20 20"/></g></svg>`), AIError);
  }
  assert.throws(() => validateSafeSvg(svg().replace("<svg ", '<svg data-iconify-canvas="1" ')), AIError);
  assert.throws(() => validateSafeSvg(svg().replace("<path ", '<path data-iconify-canvas="1" ')), AIError);
  assert.throws(() => validateSafeSvg('<svg viewBox="0 0 24 24"><g data-iconify-canvas="1" onclick="alert(1)"><path d="M4 4L20 20"/></g></svg>'), AIError);
});

test("reference comments are stripped safely and reference limits do not weaken generated output", () => {
  const commented = svg().replace("<path", '<!-- <script>untrusted()</script> --><path');
  assert.equal(validateSafeSvg(commented), svg());
  assert.throws(() => validateSafeSvg(svg().replace("<path", '<!-- invalid -- comment --><path')), AIError);
  assert.throws(() => validateSafeSvg(svg().replace('stroke="#171717"', 'stroke="<!-- -->#171717"')), AIError);
  const large = svg().replace("<path", `<!-- ${"a".repeat(40_000)} --><path`);
  assert.equal(input({ mode: "refine", references: [large] }).references[0], svg());
  assert.throws(() => validateSafeSvg(large), (error: unknown) => error instanceof AIError && error.code === "svg_too_large");
  assert.throws(() => input({ mode: "refine", references: [svg().replace("<path", `<!-- ${"a".repeat(205_000)} --><path`)] }), (error: unknown) => error instanceof AIError && error.code === "reference_too_large" && error.message.includes("200 KB"));
  const gradients = '<svg viewBox="0 0 24 24"><defs><linearGradient id="paint"/></defs><path d="M0 0L1 1" fill="url(#paint)"/></svg>';
  assert.throws(() => input({ mode: "refine", references: [gradients] }), (error: unknown) => error instanceof AIError && error.code === "unsupported_reference" && error.message.includes("flatten gradients"));
});

test("origin checks prevent cross-site use and missing-origin calls", () => {
  assert.doesNotThrow(() => assertSameOrigin(new Request("https://iconify.example/api/generate", { headers: { origin: "https://iconify.example", "sec-fetch-site": "same-origin" } })));
  const invalidHeaders: Record<string, string>[] = [{ origin: "https://attacker.example" }, {}, { origin: "https://iconify.example", "sec-fetch-site": "cross-site" }];
  for (const headers of invalidHeaders) {
    assert.throws(() => assertSameOrigin(new Request("https://iconify.example/api/generate", { headers })), AIError);
  }
});

test("bounded JSON reader limits streamed bodies without trusting Content-Length", async () => {
  assert.deepEqual(await readBoundedJson(Response.json({ ok: true }), 100), { ok: true });
  await assert.rejects(readBoundedJson(new Response("x".repeat(101)), 100), (error: unknown) => error instanceof AIError && error.status === 413);
  await assert.rejects(readBoundedJson(new Response("not-json"), 100), AIError);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(60)); controller.enqueue(new Uint8Array(60)); controller.close(); } });
  await assert.rejects(readBoundedJson(new Response(stream), 100), (error: unknown) => error instanceof AIError && error.code === "payload_too_large");
});

test("request body excludes key, requests exact count, and opts out of stored Responses", () => {
  const key = "sk-test-do-not-send-to-the-model";
  const request = buildGenerationRequest(input({ apiKey: key, mode: "normalize", references: [svg()] }), DEFAULT_AI_MODEL);
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.properties.candidates.minItems, 4);
  assert.equal(request.text.format.schema.properties.candidates.maxItems, 4);
  assert.ok(!JSON.stringify(request).includes(key));
  assert.match(request.instructions, /FIRST reference/);
});

test("redesign prompts require semantic interpretation, centerline reconstruction, and restrained corner presets", () => {
  const outlined = buildGenerationRequest(input({ mode: "redesign", references: [svg()], standards: { ...standards, corner: "square" } }), DEFAULT_AI_MODEL);
  assert.match(outlined.instructions, /First analyze what the icon communicates/);
  assert.match(outlined.instructions, /meaning = the inferred subject/);
  assert.match(outlined.instructions, /Be tentative when clues are ambiguous/);
  assert.match(outlined.instructions, /meaningful centerline paths/);
  assert.match(outlined.instructions, /Do not put a stroke around both borders/);
  assert.match(outlined.instructions, /square line caps, and miter joins/);
  assert.match(outlined.instructions, /rx=0 and ry=0/);
  assert.match(outlined.instructions, /FIRST reference is the source icon/);
  assert.match(outlined.instructions, /visual-family context ONLY/);
  assert.match(outlined.instructions, /substantial design differences/);
  const rounded = buildGenerationRequest(input({ mode: "redesign", references: [svg()], standards: { ...standards, style: "combined" }, creativity: "radical" }), DEFAULT_AI_MODEL);
  assert.match(rounded.instructions, /mix filled shapes AND outlined geometry/);
  assert.match(rounded.instructions, /two fill colors alone are not Combined/);
  assert.match(rounded.instructions, /restrained, subtle corner radii/);
  assert.match(rounded.instructions, /Do not inflate shapes into bubbly/);
  assert.match(rounded.instructions, /be extremely inventive/);
  assert.match(rounded.instructions, /different visual metaphors/);
  assert.ok(rounded.text.format.schema.required.includes("analysis"));
});

test("mocked multimodal redesign carries ordered PNG previews and returns typed interpretation", async () => {
  const analysis = { meaning: "Likely a saved-work archive.", visualNotes: "The container silhouette suggests storage; the exact product action is ambiguous.", designIntent: "Explore a folder, an archive tray, and a negative-space collection metaphor." };
  const generated = { ...output(), analysis };
  generated.candidates = generated.candidates.map((candidate, index) => ({ ...candidate, svg: candidate.svg.replace("<path", `<rect x="${3 + index}" y="3" width="5" height="5" fill="#171717" stroke="none"/><path`) }));
  const result = await generateIcons(input({ mode: "redesign", references: [svg(8), svg(9)], referenceImages: [PNG_PREVIEW, PNG_PREVIEW], creativity: "radical", standards: { ...standards, style: "combined" } }), {
    apiKey: "sk-test-server-key",
    fetcher: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as ReturnType<typeof buildGenerationRequest>;
      assert.ok(Array.isArray(body.input));
      const content = body.input[0].content;
      assert.equal(content[0].type, "input_text");
      assert.equal(content[1].type, "input_text");
      if (content[1].type === "input_text") assert.match(content[1].text, /references\[0\].*source icon/);
      assert.deepEqual(content[2], { type: "input_image", image_url: PNG_PREVIEW, detail: "high" });
      if (content[3].type === "input_text") assert.match(content[3].text, /references\[1\].*family/);
      assert.deepEqual(content[4], { type: "input_image", image_url: PNG_PREVIEW, detail: "high" });
      assert.ok(!JSON.stringify(body).includes("sk-test-server-key"));
      return providerResponse(generated);
    }) as typeof fetch,
  });
  assert.deepEqual(result.analysis, analysis);
});

test("analysis fields are bounded and legacy provider responses remain accepted", () => {
  assert.equal(parseGenerationOutput(output(), 4, DEFAULT_AI_MODEL, 24).analysis, undefined);
  assert.throws(() => parseGenerationOutput({ ...output(), analysis: { meaning: "x".repeat(501), visualNotes: "clue", designIntent: "direction" } }, 4, DEFAULT_AI_MODEL, 24), AIError);
  assert.throws(() => parseGenerationOutput({ ...output(), analysis: { meaning: "archive", visualNotes: "clue" } }, 4, DEFAULT_AI_MODEL, 24), AIError);
});

test("redesign rejects exact source geometry with new paint and cosmetic-only alternatives", async () => {
  const recolored = output();
  recolored.candidates[0].svg = svg().replace('stroke="#171717"', 'stroke="#333333"').replace('d="M4 4L20 20"', 'd="M 4,4 L 20,20"');
  await assert.rejects(generateIcons(input({ mode: "redesign", references: [svg()] }), { apiKey: "sk-test", fetcher: (async () => providerResponse(recolored)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "redesign_required");
  const repeated = output();
  repeated.candidates[1].svg = repeated.candidates[0].svg.replace('stroke="#171717"', 'stroke="#333333"');
  await assert.rejects(generateIcons(input({ mode: "redesign", references: [svg(8)] }), { apiKey: "sk-test", fetcher: (async () => providerResponse(repeated)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "insufficient_variation");
  const legacy = await generateIcons(input({ mode: "normalize", references: [svg()], standards: { ...standards, colorMode: "duo", secondaryColor: "#333333" } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(recolored)) as typeof fetch });
  assert.equal(legacy.candidates.length, 4);
});

test("output boundary rejects wrong count, duplicates, unsafe SVG, and wrong grid", () => {
  assert.equal(parseGenerationOutput(output(), 4, DEFAULT_AI_MODEL, 24).candidates.length, 4);
  assert.throws(() => parseGenerationOutput(output(3), 4, DEFAULT_AI_MODEL, 24), AIError);
  const repeated = output();
  repeated.candidates[1].svg = repeated.candidates[0].svg;
  assert.throws(() => parseGenerationOutput(repeated, 4, DEFAULT_AI_MODEL, 24), AIError);
  const unsafe = output();
  unsafe.candidates[0].svg = '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>';
  assert.throws(() => parseGenerationOutput(unsafe, 4, DEFAULT_AI_MODEL, 24), AIError);
  assert.throws(() => parseGenerationOutput(output(), 4, DEFAULT_AI_MODEL, 32), AIError);
});

test("mocked Responses call uses only OpenAI, ephemeral key, no redirects, and finds text after reasoning", async () => {
  const result = await generateIcons(input({ apiKey: "sk-ephemeral-key-for-testing", model: "gpt-6-luna" }), {
    apiKey: "sk-server-key-for-testing",
    fetcher: (async (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-ephemeral-key-for-testing");
      assert.ok(!String(init?.body).includes("sk-"));
      return providerResponse();
    }) as typeof fetch,
  });
  assert.equal(result.model, "gpt-6-luna");
  assert.equal(result.candidates.length, 4);
});

test("missing credentials never make an upstream call", async () => {
  await assert.rejects(generateIcons(input(), { fetcher: (() => { throw new Error("must not call"); }) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "api_key_required");
});

test("connection input validates credentials and model without retaining extra fields", () => {
  assert.deepEqual(parseConnectionInput({ apiKey: "sk-ephemeral-test-key", model: "gpt-6-luna", ignored: "private" }), { apiKey: "sk-ephemeral-test-key", model: "gpt-6-luna" });
  assert.deepEqual(parseConnectionInput({}), { apiKey: undefined, model: undefined });
  for (const invalid of [null, { apiKey: "short" }, { apiKey: "sk-test-invalid\nheader:value" }, { model: "https://example.com" }, { model: "x".repeat(101) }]) {
    assert.throws(() => parseConnectionInput(invalid), AIError);
  }
});

test("connection check uses a non-generating model GET and only returns verified after a valid 200", async () => {
  const model = "ft:gpt-6-luna:example:custom";
  const result = await verifyAIConnection({ apiKey: "sk-ephemeral-test-key", model }, {
    apiKey: "sk-server-default-key",
    fetcher: (async (url, init) => {
      assert.equal(url, `https://api.openai.com/v1/models/${encodeURIComponent(model)}`);
      assert.equal(init?.method, "GET");
      assert.equal(init?.body, undefined);
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-ephemeral-test-key");
      return Response.json({ id: model, object: "model", owned_by: "example" });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { verified: true, model });
  assert.ok(!JSON.stringify(result).includes("sk-"));
  const serverResult = await verifyAIConnection({}, {
    apiKey: "sk-server-default-key",
    defaultModel: "gpt-6-luna",
    fetcher: (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-server-default-key");
      return Response.json({ id: "gpt-6-luna", object: "model" });
    }) as typeof fetch,
  });
  assert.equal(serverResult.model, "gpt-6-luna");
});

test("connection check reports missing key, authentication, permissions, model access, and redirects safely", async () => {
  await assert.rejects(verifyAIConnection({}, { fetcher: (() => { throw new Error("must not call"); }) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "api_key_required");
  for (const [status, code] of [[401, "invalid_api_key"], [403, "provider_access_denied"], [404, "model_unavailable"], [429, "provider_rate_limit"], [302, "provider_unavailable"]] as const) {
    let calls = 0;
    await assert.rejects(verifyAIConnection({ apiKey: "sk-ephemeral-test-key" }, {
      fetcher: (async (_url, init) => {
        calls++;
        assert.equal(init?.redirect, "manual");
        return new Response("private error sk-ephemeral-test-key", { status, headers: { Location: "https://example.com/do-not-follow" } });
      }) as typeof fetch,
    }), (error: unknown) => error instanceof AIError && error.code === code && !error.message.includes("sk-"));
    assert.equal(calls, 1);
  }
  for (const body of [{}, { object: "model" }, { object: "other", id: "gpt-6-luna" }]) {
    await assert.rejects(verifyAIConnection({ apiKey: "sk-ephemeral-test-key" }, { fetcher: (async () => Response.json(body)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === "invalid_connection_response");
  }
});

test("connection verification has a bounded timeout and supports cancellation", async () => {
  const fetcher = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  await assert.rejects(verifyAIConnection({ apiKey: "sk-ephemeral-test-key" }, { fetcher, timeoutMs: 5 }), (error: unknown) => error instanceof AIError && error.code === "timeout");
  const controller = new AbortController();
  const pending = verifyAIConnection({ apiKey: "sk-ephemeral-test-key" }, { fetcher, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AIError && error.code === "cancelled");
});

test("network failures identify server access problems without blaming keys or exposing exceptions", async () => {
  for (const [cause, code, message] of [
    [{ code: "ENOTFOUND" }, "server_dns_error", "server could not resolve"],
    [{ code: "EPERM" }, "server_network_blocked", "server is blocked"],
    [{ code: "ECONNRESET" }, "network_error", "server could not reach"],
  ] as const) {
    await assert.rejects(generateIcons(input(), {
      apiKey: "sk-private-value",
      fetcher: (async () => { throw new Error("sensitive transport error sk-private-value", { cause }); }) as typeof fetch,
    }), (error: unknown) => error instanceof AIError && error.code === code && error.message.includes(message) && !error.message.includes("sk-private-value"));
  }
});

test("provider failures, refusals, and malformed responses become safe actionable errors", async () => {
  for (const [status, code] of [[401, "invalid_api_key"], [403, "provider_access_denied"], [404, "model_unavailable"], [429, "provider_rate_limit"], [500, "provider_unavailable"]] as const) {
    await assert.rejects(generateIcons(input(), {
      apiKey: "sk-server-secret",
      fetcher: (async () => new Response("sensitive provider body sk-server-secret", { status })) as typeof fetch,
    }), (error: unknown) => error instanceof AIError && error.code === code && !error.message.includes("sk-server-secret"));
  }
  const responses = [
    { body: { status: "incomplete", output: [] }, code: "incomplete_output" },
    { body: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }, code: "refused" },
    { body: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] }, code: "invalid_output" },
  ];
  for (const { body, code } of responses) {
    await assert.rejects(generateIcons(input(), { apiKey: "sk-test", fetcher: (async () => Response.json(body)) as typeof fetch }), (error: unknown) => error instanceof AIError && error.code === code);
  }
});

test("timeout and client cancellation abort upstream requests", async () => {
  const waitingFetcher = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  await assert.rejects(generateIcons(input(), { apiKey: "sk-test", fetcher: waitingFetcher, timeoutMs: 5 }), (error: unknown) => error instanceof AIError && error.code === "timeout");
  const controller = new AbortController();
  const pending = generateIcons(input(), { apiKey: "sk-test", fetcher: waitingFetcher, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof AIError && error.code === "cancelled");
});

test("Both requests exactly 4–8 paired designs in one schema and validates perspective", () => {
  const parsed = input({standards:{...standards,style:"both",perspective:"isometric"}});
  assert.equal(parsed.standards.perspective,"isometric");
  assert.equal(input().standards.perspective,"front");
  assert.throws(()=>input({standards:{...standards,perspective:"perspective"}}),AIError);
  const request = buildGenerationRequest(parsed,DEFAULT_AI_MODEL);
  assert.equal(request.text.format.schema.properties.candidates.minItems,4);
  assert.deepEqual(request.text.format.schema.properties.candidates.items.required,["name","outlinedSvg","filledSvg","rationale"]);
  assert.match(request.instructions,/30 degrees/);
  assert.match(request.instructions,/Do not merely skew/);
  assert.match(request.instructions,/single request with 8 SVGs/);
  assert.equal(request.max_output_tokens,24_000);
  const front = buildGenerationRequest(input(),DEFAULT_AI_MODEL);
  assert.match(front.instructions,/FACE-ON PERSPECTIVE/);
});

function pairedOutput() {
  return { ...output(), candidates:Array.from({length:4},(_,i)=>({name:`Pair ${i+1}`,outlinedSvg:svg(i),filledSvg:`<svg viewBox="0 0 24 24" fill="#171717"><path fill-rule="evenodd" d="M${3+i} 3H21V21H${3+i}Z M8 8H16V16H8Z"/></svg>`,rationale:"Matched composition with a closed filled silhouette and negative space."})) };
}

test("Both parser preserves matching names and rejects missing, duplicate or fake filled versions", () => {
  const parsed = parseGenerationOutput(pairedOutput(),4,DEFAULT_AI_MODEL,24,"both");
  assert.equal(parsed.candidates.length,8);
  for (let i=0;i<8;i+=2) {
    assert.equal(parsed.candidates[i].pairId,parsed.candidates[i+1].pairId);
    assert.equal(parsed.candidates[i].name,parsed.candidates[i+1].name);
    assert.equal(parsed.candidates[i].treatment,"line");
    assert.equal(parsed.candidates[i+1].treatment,"filled");
    assert.notEqual(parsed.candidates[i].svg,parsed.candidates[i+1].svg);
    for (const candidate of [parsed.candidates[i], parsed.candidates[i+1]]) {
      assert.match(candidate.svg.match(/^<svg\b[^>]*>/)![0], /width="24"/);
      assert.match(candidate.svg.match(/^<svg\b[^>]*>/)![0], /height="24"/);
    }
  }
  const missing = pairedOutput(); missing.candidates[0].filledSvg="";
  assert.throws(()=>parseGenerationOutput(missing,4,DEFAULT_AI_MODEL,24,"both"),AIError);
  const duplicate = pairedOutput(); duplicate.candidates[1]=duplicate.candidates[0];
  assert.throws(()=>parseGenerationOutput(duplicate,4,DEFAULT_AI_MODEL,24,"both"),AIError);
  const openFill = pairedOutput(); openFill.candidates[0].filledSvg='<svg viewBox="0 0 24 24"><path fill="#171717" d="M4 4L20 4L20 20"/></svg>';
  assert.throws(()=>parseGenerationOutput(openFill,4,DEFAULT_AI_MODEL,24,"both"),AIError);
  const strokeOnly = pairedOutput(); strokeOnly.candidates[0].filledSvg=svg(9);
  assert.throws(()=>parseGenerationOutput(strokeOnly,4,DEFAULT_AI_MODEL,24,"both"),AIError);
  const mixedOutline = pairedOutput(); mixedOutline.candidates[0].outlinedSvg='<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" fill="#171717" stroke="#171717"/></svg>';
  assert.throws(()=>parseGenerationOutput(mixedOutline,4,DEFAULT_AI_MODEL,24,"both"),AIError);
});

test("Both generation calls the provider once and returns all paired SVGs", async () => {
  let calls=0;
  const result=await generateIcons(input({standards:{...standards,style:"both"}}),{apiKey:"test-not-a-real-api-key",fetcher:async()=>{calls++;return providerResponse(pairedOutput());}});
  assert.equal(calls,1);
  assert.equal(result.candidates.length,8);
  assert.equal(new Set(result.candidates.map(c=>c.pairId)).size,4);
});

test("Both normalizes outlined weights and intentional filled detail strokes to the same canvas unit", async () => {
  const generated = pairedOutput();
  generated.candidates.forEach((candidate) => {
    candidate.outlinedSvg = candidate.outlinedSvg.replace('stroke-width="1.5"', 'stroke-width=".25"');
    candidate.filledSvg = candidate.filledSvg.replace('<path ', '<path stroke="#171717" stroke-width="3" ');
  });
  const result = await generateIcons(input({ standards: { ...standards, style: "both", strokeWidth: 1 } }), { apiKey: "sk-test", fetcher: (async () => providerResponse(generated)) as typeof fetch });
  result.candidates.forEach((candidate) => {
    assert.match(candidate.svg.match(/<path\b[^>]*>/)![0], /stroke-width="1"/);
  });
  assert.match(result.candidates[1].svg, /fill-rule="evenodd"/);
  assert.equal(result.candidates[1].svg.match(/d="([^"]*)"/)![1], generated.candidates[0].filledSvg.match(/d="([^"]*)"/)![1]);
});


test("Both rejects zero-alpha filled and outlined paints as invisible versions", () => {
  for (const color of ["rgba(23,23,23,0)", "rgba(23,23,23,0%)", "#1230", "#17171700"]) {
    const invisibleFill=pairedOutput();
    invisibleFill.candidates[0].filledSvg=`<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" fill="${color}"/></svg>`;
    assert.throws(()=>parseGenerationOutput(invisibleFill,4,DEFAULT_AI_MODEL,24,"both"),AIError);
    const invisibleOutline=pairedOutput();
    invisibleOutline.candidates[0].outlinedSvg=svg().replace('stroke="#171717"',`stroke="${color}"`);
    assert.throws(()=>parseGenerationOutput(invisibleOutline,4,DEFAULT_AI_MODEL,24,"both"),AIError);
  }
});
