import type { SessionRules } from './session-rules';

export type IconStyle = "line" | "filled" | "combined" | "both" | "duotone";

/** A target share of the icon's painted area. Locked shares are user-defined;
 * automatic shares divide the remaining percentage equally. */
export type PaletteColor = { color: string; percentage: number; locked: boolean };

export type Standards = {
  style: IconStyle;
  perspective?: "front" | "isometric";
  colorMode?: "mono" | "duo" | "color";
  /** Up to four colors. `duo` and primary/secondary colors remain readable for saved workspaces. */
  palette?: PaletteColor[];
  proportion?: "natural" | "square";
  constructionGrid?: "none" | "keyline" | "concentric";
  /** Fit the construction keylines, or explicitly use custom optical padding. */
  artworkFit?: "keyline" | "padding";
  strokeWidth: number;
  /** Minimum painted gap between intentionally separate internal elements, in grid units. */
  minSpacing?: number;
  gridSize: number;
  corner: "round" | "square";
  /** Radius applied to sharp path corners, in SVG units / exported pixels. */
  cornerRadius?: number;
  primaryColor: string;
  secondaryColor: string;
  padding: number;
};

export type Candidate = {
  id: string;
  name: string;
  svg: string;
  rationale: string;
  /** Matching outlined and filled versions of the same design direction. */
  pairId?: string;
  treatment?: "line" | "filled";
  status: "pending" | "shortlisted" | "accepted" | "rejected";
  source: "demo" | "ai" | "normalized" | "edited";
};

export type IconItem = {
  id: string;
  name: string;
  brief: string;
  originalSvg?: string;
  candidates: Candidate[];
  round: number;
  standards?: Standards;
  sessionRules?: SessionRules;
};
