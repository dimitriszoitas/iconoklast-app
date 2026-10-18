import assert from "node:assert/strict";
import test from "node:test";
import { addPaletteColor, allocatePaletteColors, getPalette, normalizePalette, removePaletteColor, setPalettePercentage, unlockPaletteColor } from "../lib/color-palette.ts";
import type { PaletteColor } from "../lib/icon-types.ts";

const one: PaletteColor[] = [{ color: "#112233", percentage: 100, locked: false }];
const shares = (palette: PaletteColor[]) => palette.map(entry => entry.percentage);

test("automatic colors split equally and fixed colors reserve their shares", () => {
  let palette = addPaletteColor(one, "#445566");
  assert.deepEqual(shares(palette), [50, 50]);
  palette = setPalettePercentage(palette, 0, 60);
  assert.deepEqual(shares(palette), [60, 40]);
  assert.deepEqual(palette.map(entry => entry.locked), [true, false]);
  palette = addPaletteColor(palette, "#778899");
  assert.deepEqual(shares(palette), [60, 20, 20]);
  palette = setPalettePercentage(palette, 1, 10);
  assert.deepEqual(shares(palette), [60, 10, 30]);
  palette = addPaletteColor(palette, "#aabbcc");
  assert.deepEqual(shares(palette), [60, 10, 15, 15]);
  palette = setPalettePercentage(palette, 2, 20);
  assert.deepEqual(shares(palette), [60, 10, 20, 10]);
  assert.deepEqual(shares(setPalettePercentage(palette, 3, 5)), [60, 10, 20, 10], "last auto share remains the remainder");
  assert.throws(() => addPaletteColor(palette, "#ffffff"), /four colors/);
});

test("rounding, unlock, removal and zero shares conserve exactly 100 percent", () => {
  let palette = addPaletteColor(addPaletteColor(one, "#445566"), "#778899");
  assert.deepEqual(shares(palette), [33.34, 33.33, 33.33]);
  palette = setPalettePercentage(palette, 0, 90);
  palette = setPalettePercentage(palette, 1, 50);
  assert.deepEqual(shares(palette), [90, 10, 0], "an edit is clamped to space left by other fixed shares");
  assert.deepEqual(shares(unlockPaletteColor(palette, 0)), [45, 10, 45]);
  assert.deepEqual(shares(removePaletteColor(palette, 0)), [10, 90]);
  assert.deepEqual(shares(removePaletteColor(removePaletteColor(palette, 2), 1)), [100]);
  assert.deepEqual(removePaletteColor(one, 0), one);
  assert.deepEqual(normalizePalette(normalizePalette(palette)), normalizePalette(palette));
});

test("legacy palettes and monochrome have safe defaults without mutating saved data", () => {
  const settings = { style: "line" as const, primaryColor: "#112233", secondaryColor: "#445566" };
  assert.deepEqual(shares(getPalette(settings)), [100]);
  assert.deepEqual(shares(getPalette({ ...settings, colorMode: "duo" })), [50, 50]);
  assert.deepEqual(shares(getPalette({ ...settings, style: "duotone" })), [50, 50]);
  assert.deepEqual(shares(getPalette({ ...settings, colorMode: "color", palette: one })), [100]);
  assert.deepEqual(getPalette({ ...settings, colorMode: "mono", palette: [{ color: "#ffffff", percentage: 100, locked: true }] }), one);
  assert.deepEqual(one, [{ color: "#112233", percentage: 100, locked: false }]);
});

test("invalid or overcommitted palettes are rejected", () => {
  assert.throws(() => normalizePalette([]), /one and four/);
  assert.throws(() => normalizePalette([{ color: "red", percentage: 100, locked: false }]), /hex colors/);
  assert.throws(() => normalizePalette([{ color: "#123456", percentage: NaN, locked: true }]), /between 0 and 100/);
  assert.throws(() => normalizePalette([{ color: "#123456", percentage: 80, locked: true }, { color: "#456789", percentage: 30, locked: true }]), /more than 100/);
});

test("whole paint groups approximate target coverage without inventing new geometry", () => {
  const palette = [{ color: "#112233", percentage: 80, locked: true }, { color: "#445566", percentage: 20, locked: false }];
  assert.deepEqual(allocatePaletteColors([20, 80], palette), ["#445566", "#112233"]);
  assert.deepEqual(allocatePaletteColors([100], palette), ["#112233"]);
  assert.deepEqual(allocatePaletteColors([1, 1], [{ ...palette[0], percentage: 100 }, { ...palette[1], percentage: 0 }]), ["#112233", "#112233"]);
});
