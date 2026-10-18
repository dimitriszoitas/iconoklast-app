import type { PaletteColor, Standards } from "./icon-types.ts";

export type { PaletteColor } from "./icon-types.ts";

const TOTAL = 10000;
const hex = /^#[\da-f]{6}$/i;
const units = (percentage: number) => Math.round(percentage * 100);

/** Resolve shares in hundredths of a percent. Fixed shares remain unchanged;
 * automatic entries split the remainder, with rounding assigned in palette order.
 * Invalid fixed totals are rejected rather than silently changing a user's shares. */
export function normalizePalette(input: readonly PaletteColor[]): PaletteColor[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) throw new Error("Choose between one and four colors.");
  const palette = input.map(entry => {
    if (!entry || !hex.test(entry.color)) throw new Error("Use six-digit hex colors for your palette.");
    if (!Number.isFinite(entry.percentage) || entry.percentage < 0 || entry.percentage > 100 || typeof entry.locked !== "boolean") throw new Error("Color percentages must be between 0 and 100.");
    return { color: entry.color.toLowerCase(), percentage: units(entry.percentage) / 100, locked: entry.locked };
  });
  let fixed = palette.reduce((sum, entry) => sum + (entry.locked ? units(entry.percentage) : 0), 0);
  if (fixed > TOTAL) throw new Error("Fixed color percentages cannot total more than 100%.");
  // A legacy or hand-edited all-fixed palette may leave unassigned paint. Keep
  // its earlier choices and expose the final color as the automatic remainder.
  if (palette.every(entry => entry.locked) && fixed < TOTAL) {
    const last = palette[palette.length - 1];
    fixed -= units(last.percentage); last.locked = false;
  }
  const automatic = palette.filter(entry => !entry.locked);
  if (automatic.length) {
    const remaining = TOTAL - fixed, share = Math.floor(remaining / automatic.length);
    let rounding = remaining % automatic.length;
    for (const entry of automatic) entry.percentage = (share + (rounding-- > 0 ? 1 : 0)) / 100;
  }
  return palette;
}

/** Resolve both current palettes and workspaces saved before proportional color. */
export function getPalette(standards: Pick<Standards, "style" | "colorMode" | "primaryColor" | "secondaryColor" | "palette">): PaletteColor[] {
  const mode = standards.colorMode ?? (standards.style === "duotone" ? "duo" : "mono");
  if (mode === "mono") return normalizePalette([{ color: standards.primaryColor, percentage: 100, locked: false }]);
  return normalizePalette(standards.palette ?? [
    { color: standards.primaryColor, percentage: 50, locked: false },
    { color: standards.secondaryColor, percentage: 50, locked: false },
  ]);
}

export function addPaletteColor(palette: readonly PaletteColor[], color: string): PaletteColor[] {
  return normalizePalette([...normalizePalette(palette), { color, percentage: 0, locked: false }]);
}

export function removePaletteColor(palette: readonly PaletteColor[], index: number): PaletteColor[] {
  const result = normalizePalette(palette);
  if (result.length === 1 || !Number.isInteger(index) || index < 0 || index >= result.length) return result;
  result.splice(index, 1);
  return normalizePalette(result);
}

/** Setting a share fixes it, leaving other automatic entries to share the rest.
 * The final automatic entry is the remainder when all other entries are fixed. */
export function setPalettePercentage(palette: readonly PaletteColor[], index: number, percentage: number): PaletteColor[] {
  const result = normalizePalette(palette);
  if (!Number.isInteger(index) || index < 0 || index >= result.length) return result;
  if (!Number.isFinite(percentage)) throw new Error("Enter a color percentage between 0 and 100.");
  const fixed = result.reduce((sum, entry, position) => sum + (position !== index && entry.locked ? units(entry.percentage) : 0), 0);
  const otherAutomatic = result.some((entry, position) => position !== index && !entry.locked);
  if (!otherAutomatic) {
    result[index] = { ...result[index], percentage: (TOTAL - fixed) / 100, locked: false };
  } else {
    result[index] = { ...result[index], percentage: Math.max(0, Math.min(TOTAL - fixed, units(percentage))) / 100, locked: true };
  }
  return normalizePalette(result);
}

export function unlockPaletteColor(palette: readonly PaletteColor[], index: number): PaletteColor[] {
  return normalizePalette(normalizePalette(palette).map((entry, position) => position === index ? { ...entry, locked: false } : entry));
}

/** Assign whole paint groups to approximate painted-area targets. Geometry is
 * never split to manufacture exact coverage, so a single shape stays one color. */
export function allocatePaletteColors(weights: readonly number[], palette: readonly PaletteColor[]): string[] {
  const colors = normalizePalette(palette).filter(entry => entry.percentage > 0);
  const usable = weights.map(weight => Number.isFinite(weight) && weight > 0 ? weight : 1);
  const total = usable.reduce((sum, weight) => sum + weight, 0);
  const remaining = colors.map(entry => total * entry.percentage / 100);
  const output: string[] = [];
  usable.map((weight, index) => ({ weight, index })).sort((a, b) => b.weight - a.weight || a.index - b.index).forEach(({ weight, index }) => {
    let choice = 0;
    remaining.forEach((amount, color) => { if (amount > remaining[choice]) choice = color; });
    output[index] = colors[choice].color;
    remaining[choice] -= weight;
  });
  return output;
}
