"use client";
import { vectorJunctionCaps } from "../lib/vector-junction-caps";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import StudioSelect from './studio-select';
import PreviewBackgroundToggle from './preview-background-toggle';
import type paper from "paper";
import type { Standards } from "../lib/icon-types";
import { GuideShapes } from "./construction-guide";
import { loadPaper, disposePaperScope } from "../lib/load-paper";
import { ArrowDown, ArrowUp, Check, ChevronLeft, Circle, Copy, CornerDownLeft, Crosshair, Hand, Layers, Link2, Maximize2, Minus, MousePointer2, PenTool, Plus, Redo2, Scissors, Square, Trash2, Undo2, X } from "lucide-react";
import { renderedPathData, recoverEditableCorners, addAnchor, nearestAnchor, nearestCurve, curveAnchorRefs, divideShapes, makeCompoundShape, releaseCompoundShape, reverseShape, anchorConnectionState, connectAnchors, continuePenPath, splitShapeAtAnchor, translateAnchors, deleteAnchors, selectionBounds, resizeShape, rotateShape, flipShape, appendPenPoint, changeAnchor, closeContour, closeShape, combineShapes, createVectorShape, exportVectorSvg, importVectorSvg, moveAnchor, shapeAnchors, shapeBounds, translateShape, vectorId, type BooleanOperation, type VectorDocument, type VectorPoint, type VectorShape } from "../lib/vector-editor-geometry";
import "./vector-editor.css";
import "./geometry-settings.css";

type ToolName = "select" | "direct" | "pen" | "rectangle" | "ellipse" | "hand" | "add" | "remove" | "convert";
type AnchorSelection = { id: string; contour: number; index: number };
type Bounds = { x: number; y: number; width: number; height: number };
type Drag = { kind: "move" | "anchor" | "pen" | "shape" | "pan" | "marquee" | "resize" | "rotate"; start: VectorPoint; clientX: number; clientY: number; before: VectorDocument; ids?: string[]; id?: string; contour?: number; index?: number; handle?: "point" | "handleIn" | "handleOut"; view?: ViewBox; scale?: number; shapeType?: "rectangle" | "ellipse"; anchors?: AnchorSelection[]; additive?: boolean; direct?: boolean; clickAnchors?: AnchorSelection[]; clickShapeId?: string; bounds?: Bounds; grip?: string; center?: VectorPoint };
type ViewBox = { x: number; y: number; width: number; height: number };
const toolList: { id: ToolName; title: string; key: string; Icon: typeof MousePointer2 }[] = [
  { id: "select", title: "Select", key: "V", Icon: MousePointer2 },
  { id: "direct", title: "Edit points", key: "A", Icon: Crosshair },
  { id: "pen", title: "Pen", key: "P", Icon: PenTool },
  { id: "add", title: "Add anchor", key: "+", Icon: Plus },
  { id: "remove", title: "Delete anchor", key: "−", Icon: Minus },
  { id: "convert", title: "Convert anchor", key: "C", Icon: Scissors },
  { id: "rectangle", title: "Rectangle", key: "R", Icon: Square },
  { id: "ellipse", title: "Ellipse", key: "E", Icon: Circle },
  { id: "hand", title: "Pan", key: "H", Icon: Hand },
];
const hints: Record<ToolName, string> = {
  select: "Cmd/Ctrl-drag a box to select anchors. Connect joins two open endpoints into one path. Shift adds to selection.",
  direct: "Select two open endpoints to Connect. To open a closed path, select one anchor and choose Cut at selected anchor.",
  pen: "Click for corners; drag for curves. Click an open endpoint to continue. First anchor closes; Enter finishes. + / − edits anchors.",
  rectangle: "Drag to draw a rectangle. Hold Shift for a square.",
  ellipse: "Drag to draw an ellipse. Hold Shift for a circle.",
  add: "Click a path to insert an anchor without changing its curve.",
  remove: "Click an anchor to remove it. Undo restores the original path.",
  convert: "Click an anchor to make a corner. Drag from it to create smooth, linked curve handles.",
  hand: "Drag the canvas to pan. Use + and − to zoom, or Fit to return to the artboard.",
};
const colorInput = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}` : "#231c2a";

export default function VectorEditor({ svg, name, standards, darkCanvas = false, onToggleDarkCanvas, onSave, onClose }: { svg: string; name: string; standards?: Standards; darkCanvas?: boolean; onToggleDarkCanvas?: () => void; onSave: (svg: string) => void; onClose: () => void }) {
  const [doc, setDoc] = useState<VectorDocument | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolName>("select");
  const [anchorSelection, setAnchorSelection] = useState<AnchorSelection[]>([]);
  const [isolation, setIsolation] = useState<{ id: string } | null>(null);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [modifierDown, setModifierDown] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [view, setView] = useState<ViewBox>({ x: -4, y: -4, width: 32, height: 32 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [grid, setGrid] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [snap, setSnap] = useState(false);
  const [penId, setPenId] = useState<string | null>(null);
  const [historyStatus, setHistoryStatus] = useState({ undo: false, redo: false });
  const [renderScope, setRenderScope] = useState<paper.PaperScope | null>(null);
  const [defaults, setDefaults] = useState<Pick<VectorShape, "fill" | "stroke" | "strokeWidth" | "lineCap" | "lineJoin" | "opacity" | "cornerRadius">>({ cornerRadius: 0, fill: "none", stroke: "#231c2a", strokeWidth: 1.5, lineCap: "round", lineJoin: "round", opacity: 1 });
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [initialDoc, setInitialDoc] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 700, height: 600 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scope = useRef<paper.PaperScope | null>(null);
  const docRef = useRef<VectorDocument | null>(null);
  const history = useRef<{ past: VectorDocument[]; future: VectorDocument[] }>({ past: [], future: [] });
  const drag = useRef<Drag | null>(null);
  const setDocument = useCallback((next: VectorDocument) => { docRef.current = next; setDoc(next); }, []);
  const commit = useCallback((next: VectorDocument, before: VectorDocument | null = docRef.current) => {
    if (before && JSON.stringify(before) !== JSON.stringify(next)) {
      history.current.past = [...history.current.past.slice(-79), before]; history.current.future = [];
      setHistoryStatus({ undo: !!history.current.past.length, redo: !!history.current.future.length });
    }
    setDocument(next);
  }, [setDocument]);
  const fit = useCallback((target?: VectorDocument) => {
    const data = target || docRef.current; if (!data) return;
    const padding = Math.max(data.width, data.height) * .2;
    setView({ x: -padding, y: -padding, width: data.width + padding * 2, height: data.height + padding * 2 });
  }, []);

  useEffect(() => {
    let alive = true;
    let createdScope: paper.PaperScope | null = null;
    void loadPaper().then((library) => {
      if (!alive) return;
      const instance = new library.PaperScope();
      instance.setup(new library.Size(24, 24));
      createdScope = instance; scope.current = instance; setRenderScope(instance);
      try {
        const imported = importVectorSvg(instance, svg);
        const data = { ...imported, shapes: imported.shapes.map(shape => recoverEditableCorners(instance, shape)) };
        setDocument(data); setInitialDoc(JSON.stringify(data)); fit(data);
        const source = data.shapes[0];
        if (source) setDefaults({ fill: source.fill, stroke: source.stroke, strokeWidth: source.strokeWidth, lineCap: source.lineCap, lineJoin: source.lineJoin, opacity: source.opacity, cornerRadius: source.cornerRadius ?? 0 });
      } catch (cause) { setError(cause instanceof Error ? cause.message : "This SVG could not be opened for editing."); }
    }).catch(() => { if (alive) setError("The vector editor could not load. Reload the page and try again."); });
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => { alive = false; if (createdScope) disposePaperScope(createdScope); scope.current = null; document.body.style.overflow = originalOverflow; previous?.focus(); };
  }, [svg, fit, setDocument]);

  const isLoaded = doc !== null;
  useEffect(() => {
    const element = svgRef.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, [isLoaded]);

  const active = doc?.shapes.find((shape) => selected.includes(shape.id));
  const style = active || defaults;
  const connection = useMemo(() => renderScope && doc && anchorSelection.length === 2 ? anchorConnectionState(renderScope, doc.shapes, anchorSelection) : null, [renderScope, doc, anchorSelection]);
  const unit = Math.max(view.width / Math.max(canvasSize.width, 1), view.height / Math.max(canvasSize.height, 1));
  const anchorRadius = unit * 4;
  const isDirty = !!doc && JSON.stringify(doc) !== initialDoc;
  const requestClose = () => { if (isDirty) setDiscardPrompt(true); else onClose(); };
  const changeTool = (next: ToolName) => { setPenId(null); setTool(next); setAnchorSelection([]); if (isolation) setSelected([isolation.id]); setMessage(""); };
  const pointFromEvent = (event: { clientX: number; clientY: number }, shouldSnap = true): VectorPoint => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: snap && shouldSnap ? Math.round(point.x) : point.x, y: snap && shouldSnap ? Math.round(point.y) : point.y };
  };
  const undo = () => {
    if (!docRef.current || !history.current.past.length) return;
    history.current.future.push(docRef.current);
    setDocument(history.current.past.pop()!); setIsolation(null); setSelected([]); setAnchorSelection([]); setPenId(null); setHistoryStatus({ undo: !!history.current.past.length, redo: !!history.current.future.length });
  };
  const redo = () => {
    if (!docRef.current || !history.current.future.length) return;
    history.current.past.push(docRef.current);
    setDocument(history.current.future.pop()!); setIsolation(null); setSelected([]); setAnchorSelection([]); setPenId(null); setHistoryStatus({ undo: !!history.current.past.length, redo: !!history.current.future.length });
  };
  const alterSelected = (change: (shape: VectorShape) => VectorShape) => {
    const current = docRef.current; if (!current) return;
    commit({ ...current, shapes: current.shapes.map((shape) => selected.includes(shape.id) ? change(shape) : shape) });
    setError("");
  };
  const updateStyle = (patch: Partial<VectorShape>) => {
    if (selected.length) alterSelected((shape) => ({ ...(patch.cornerRadius !== undefined ? recoverEditableCorners(scope.current!, shape, { preserveAppearance: false }) : shape), ...patch }));
    if (patch.cornerRadius !== undefined) setAnchorSelection([]);
    setDefaults((previous) => ({ ...previous, ...patch }));
  };
  const deleteSelection = () => {
    const current = docRef.current; if (!current || !scope.current) return;
    if (anchorSelection.length && tool === "direct") {
      const shapes = current.shapes.map((shape) => deleteAnchors(scope.current!, shape, anchorSelection.filter((a) => a.id === shape.id))).filter((shape) => !!shape.d);
      commit({ ...current, shapes }); setAnchorSelection([]);
      if (isolation && !shapes.some((shape) => shape.id === isolation.id)) { setIsolation(null); setSelected([]); }
      return;
    }
    commit({ ...current, shapes: current.shapes.filter((shape) => !selected.includes(shape.id)) });
    setSelected([]); setAnchorSelection([]); setPenId(null); setIsolation(null);
  };
  const duplicate = () => {
    const current = docRef.current; if (!current || !scope.current || !selected.length) return;
    const copies = current.shapes.filter((shape) => selected.includes(shape.id)).map((shape) => ({ ...translateShape(scope.current!, shape, { x: 1, y: 1 }), id: vectorId(), name: `${shape.name} copy` }));
    commit({ ...current, shapes: [...current.shapes, ...copies] }); setSelected(copies.map((shape) => shape.id)); setAnchorSelection([]); setPenId(null);
    if (isolation) setIsolation(copies.length === 1 ? { id: copies[0].id } : null);
  };
  const boolean = (operation: BooleanOperation) => {
    const current = docRef.current; if (!current || !scope.current) return;
    try {
      const result = combineShapes(scope.current, current.shapes.filter((shape) => selected.includes(shape.id)), operation);
      const lastIndex = Math.max(...current.shapes.map((s, i) => selected.includes(s.id) ? i : -1));
      const shapes = current.shapes.flatMap((shape, index) => index === lastIndex ? [result] : selected.includes(shape.id) ? [] : [shape]);
      commit({ ...current, shapes }); setSelected([result.id]); setAnchorSelection([]); setError(""); setMessage(`${result.name} created. Undo is always available.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The paths could not be combined."); }
  };
  const pathCommand = (command: "divide" | "compound" | "release" | "reverse") => {
    const current = docRef.current, lib = scope.current; if (!current || !lib) return;
    try {
      const chosen = current.shapes.filter((shape) => selected.includes(shape.id));
      let results: VectorShape[];
      const replaced = selected;
      if (command === "divide") results = divideShapes(lib, chosen);
      else if (command === "compound") results = [makeCompoundShape(lib, chosen)];
      else if (command === "release") results = chosen.flatMap((shape) => releaseCompoundShape(lib, shape));
      else results = chosen.map((shape) => reverseShape(lib, shape));
      const last = Math.max(...current.shapes.map((shape, index) => replaced.includes(shape.id) ? index : -1));
      const nextShapes = command === "reverse" ? current.shapes.map((shape) => selected.includes(shape.id) ? results.find((result) => result.id === shape.id)! : shape)
        : command === "release" ? current.shapes.flatMap((shape) => selected.includes(shape.id) ? releaseCompoundShape(lib, shape) : [shape])
        : current.shapes.flatMap((shape, index) => index === last ? results : replaced.includes(shape.id) ? [] : [shape]);
      if (command === "release") results = nextShapes.filter((shape) => !current.shapes.some((original) => original.id === shape.id && !selected.includes(original.id)));
      commit({ ...current, shapes: nextShapes });
      setSelected(results.map((shape) => shape.id)); setAnchorSelection([]); setIsolation(null); setError(""); setMessage({ divide: "Overlaps divided into separate editable regions.", compound: "Compound path created. Overlapping areas become cutouts.", release: "Contours released as separate paths.", reverse: "Path direction reversed." }[command]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This path operation could not be completed."); }
  };
  const connectSelection = () => {
    const current = docRef.current, lib = scope.current; if (!current || !lib) return;
    try {
      const result = connectAnchors(lib, current, anchorSelection);
      commit(result.document); setSelected(result.selectedIds); setAnchorSelection([]); setIsolation(null); setPenId(null); setError("");
      setMessage(result.kind === "join" ? "Endpoints joined into one continuous path. Undo is available." : "Path closed at the selected endpoints. Undo is available.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "These anchors could not be connected."); }
  };
  const reorder = (direction: "front" | "back") => {
    const current = docRef.current; if (!current) return;
    const chosen = current.shapes.filter((s) => selected.includes(s.id)), rest = current.shapes.filter((s) => !selected.includes(s.id));
    commit({ ...current, shapes: direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest] });
  };
  const zoom = (factor: number) => setView((v) => {
    const width = v.width * factor, height = v.height * factor;
    if (!doc || width < doc.width / 20 || width > doc.width * 10) return v;
    return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height };
  });
  const finishPen = () => { setPenId(null); setAnchorSelection([]); setMessage("Path finished. Select Edit points to adjust its curves."); };

  const sameAnchor = (a: AnchorSelection, b: AnchorSelection) => a.id === b.id && a.contour === b.contour && a.index === b.index;
  const selectAnchors = (entries: AnchorSelection[], additive = false) => {
    const next = additive ? [...anchorSelection, ...entries.filter((entry) => !anchorSelection.some((a) => sameAnchor(a, entry)))] : entries;
    setAnchorSelection(next); setSelected([...new Set(next.map((a) => a.id))]); return next;
  };
  const exitIsolation = () => { setIsolation(null); setAnchorSelection([]); setPenId(null); setMessage(""); };
  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    const current = docRef.current; const lib = scope.current; if (!current || !lib) return;
    dialogRef.current?.focus({ preventScroll: true });
    setError(""); setMessage("");
    const target = event.target as SVGElement;
    const point = pointFromEvent(event);
    const id = target.dataset.shape;
    const shape = current.shapes.find((s) => s.id === id);
    const handle = target.dataset.handle as "point" | "handleIn" | "handleOut" | undefined;
    const base = { start: point, clientX: event.clientX, clientY: event.clientY, before: current };
    const direct = tool === "direct" || event.metaKey || event.ctrlKey;
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    if (tool === "hand" || spaceDown || event.button === 1) {
      drag.current = { ...base, kind: "pan", view: { ...view }, scale: svgRef.current?.getScreenCTM()?.a || 1 }; return;
    }
    if (target.dataset.transform && selected.length && !direct) {
      const box = selectionBounds(lib, current.shapes.filter((s) => selected.includes(s.id)));
      if (box) drag.current = { ...base, kind: target.dataset.transform === "rotate" ? "rotate" : "resize", grip: target.dataset.transform, ids: selected, bounds: box, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } }; return;
    }
    if (isolation && id && isolation.id !== id) return;
    if (!direct && (tool === "add" || tool === "remove" || tool === "convert")) {
      if (!shape) return;
      setSelected([shape.id]);
      if (tool === "add") { commit({ ...current, shapes: current.shapes.map((s) => s.id === id ? addAnchor(lib, s, point) : s) }); setAnchorSelection([]); setMessage("Anchor added without changing the curve."); return; }
      const found = nearestAnchor(lib, shape, point, unit * 14); if (!found) return;
      const entry = { id: shape.id, contour: found.contour, index: found.index }; selectAnchors([entry]);
      if (tool === "remove") {
        const shapes = current.shapes.map((s) => s.id === id ? deleteAnchors(lib, s, [entry]) : s).filter((s) => !!s.d);
        commit({ ...current, shapes }); setAnchorSelection([]);
        if (isolation && !shapes.some((s) => s.id === isolation.id)) { setIsolation(null); setSelected([]); }
        return;
      }
      const converted = { ...current, shapes: current.shapes.map((s) => s.id === id ? changeAnchor(lib, s, entry.contour, entry.index, "corner") : s) }; setDocument(converted);
      drag.current = { ...base, kind: "pen", ...entry, handle: "handleOut" }; return;
    }
    if (!direct && tool === "pen") {
      let penShape = current.shapes.find((s) => s.id === penId && (!isolation || s.id === isolation.id));
      if (!penShape && shape) {
        const endpoint = nearestAnchor(lib, shape, point, unit * 12);
        if (endpoint && !endpoint.closed) {
          const contour = shapeAnchors(lib, shape).filter((a) => a.contour === endpoint.contour);
          if (endpoint.index === 0 || endpoint.index === contour.length - 1) {
            const continued = continuePenPath(lib, shape, endpoint);
            commit({ ...current, shapes: current.shapes.map((s) => s.id === shape.id ? continued : s) }); setSelected([shape.id]); setPenId(shape.id); setAnchorSelection([]); setMessage("Continue from this endpoint. Click to extend the path."); return;
          }
        }
      }
      if (penShape) {
        const points = shapeAnchors(lib, penShape).filter((entry) => entry.contour === 0);
        if (points.length >= 3 && Math.hypot(point.x - points[0].point.x, point.y - points[0].point.y) < anchorRadius * 2.5) {
          commit({ ...current, shapes: current.shapes.map((s) => s.id === penShape!.id ? closeContour(lib, s, 0) : s) }); finishPen(); return;
        }
        penShape = appendPenPoint(lib, penShape, point);
        setDocument({ ...current, shapes: current.shapes.map((s) => s.id === penShape!.id ? penShape! : s) });
      } else {
        if (isolation) { setMessage("Exit isolation to draw a new path. You can continue an open endpoint of this path."); return; }
        penShape = createVectorShape(`M${point.x},${point.y}`, { ...defaults, name: `Pen path ${current.shapes.length + 1}` });
        setDocument({ ...current, shapes: [...current.shapes, penShape] }); setPenId(penShape.id);
      }
      const points = shapeAnchors(lib, penShape).filter((entry) => entry.contour === 0);
      const entry = { id: penShape.id, contour: 0, index: points.length - 1 }; selectAnchors([entry]);
      drag.current = { ...base, kind: "pen", ...entry, handle: "handleOut" }; return;
    }
    if (!direct && (tool === "rectangle" || tool === "ellipse")) {
      if (isolation) { setMessage("Exit isolation to draw a new shape."); return; }
      const newShape = createVectorShape(`M${point.x},${point.y}`, { ...defaults, name: `${tool === "rectangle" ? "Rectangle" : "Ellipse"} ${current.shapes.length + 1}` });
      setDocument({ ...current, shapes: [...current.shapes, newShape] }); setSelected([newShape.id]); setAnchorSelection([]);
      drag.current = { ...base, kind: "shape", id: newShape.id, shapeType: tool }; return;
    }
    if (direct) {
      setTool("direct"); setPenId(null);
      if (shape) {
        const near = handle ? { contour: Number(target.dataset.contour), index: Number(target.dataset.index) } : nearestAnchor(lib, shape, point, unit * 10);
        const curve = !near ? nearestCurve(lib, shape, point, unit * 14) : null;
        const entries = near ? [{ id: shape.id, contour: near.contour, index: near.index }] : curve ? curveAnchorRefs(lib, shape, curve).map((a) => ({ ...a, id: shape.id })) : [];
        if (!near && ((event.metaKey || event.ctrlKey) || !entries.length)) {
          if (!event.shiftKey) { setSelected([]); setAnchorSelection([]); }
          drag.current = { ...base, kind: "marquee", additive: event.shiftKey, direct: true, ids: event.shiftKey ? selected : [], anchors: event.shiftKey ? anchorSelection : [], clickAnchors: entries, clickShapeId: shape.id };
          setMarquee({ x: point.x, y: point.y, width: 0, height: 0 }); return;
        }
        if (event.shiftKey && entries.length === 1 && anchorSelection.some((a) => sameAnchor(a, entries[0]))) {
          const next = anchorSelection.filter((a) => !sameAnchor(a, entries[0])); setAnchorSelection(next); return;
        }
        const chosen = !event.shiftKey && entries.every((entry) => anchorSelection.some((a) => sameAnchor(a, entry))) ? anchorSelection : selectAnchors(entries, event.shiftKey);
        setSelected([...new Set(chosen.map((a) => a.id))]);
        drag.current = { ...base, kind: "anchor", ...entries[0], handle: handle || "point", anchors: chosen }; return;
      }
    }
    if (!id) {
      if (!event.shiftKey) { setSelected([]); setAnchorSelection([]); }
      drag.current = { ...base, kind: "marquee", additive: event.shiftKey, direct, ids: event.shiftKey ? selected : [], anchors: event.shiftKey ? anchorSelection : [] }; setMarquee({ x: point.x, y: point.y, width: 0, height: 0 }); return;
    }
    const ids = event.shiftKey ? (selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]) : selected.includes(id) ? selected : [id];
    setSelected(ids); setAnchorSelection([]);
    if (tool === "select" && ids.includes(id)) drag.current = { ...base, kind: "move", ids };
  };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    const interaction = drag.current; const current = docRef.current; const lib = scope.current;
    if (!interaction || !current || !lib) return;
    let delta = { x: point.x - interaction.start.x, y: point.y - interaction.start.y };
    if (event.shiftKey && (interaction.kind === "move" || interaction.kind === "anchor")) delta = Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
    if (interaction.kind === "pan") {
      setView({ ...interaction.view!, x: interaction.view!.x - (event.clientX - interaction.clientX) / interaction.scale!, y: interaction.view!.y - (event.clientY - interaction.clientY) / interaction.scale! }); return;
    }
    if (interaction.kind === "marquee") {
      const box = { x: Math.min(point.x, interaction.start.x), y: Math.min(point.y, interaction.start.y), width: Math.abs(delta.x), height: Math.abs(delta.y) }; setMarquee(box);
      const shapes = current.shapes.filter((s) => !isolation || s.id === isolation.id);
      if (interaction.direct) {
        const entries = shapes.flatMap((shape) => shapeAnchors(lib, shape).filter((a) => a.point.x >= box.x && a.point.x <= box.x + box.width && a.point.y >= box.y && a.point.y <= box.y + box.height).map((a) => ({ id: shape.id, contour: a.contour, index: a.index })));
        const next = [...(interaction.anchors || []), ...entries.filter((entry) => !interaction.anchors?.some((a) => sameAnchor(a, entry)))];
        setAnchorSelection(next); setSelected([...new Set(next.map((a) => a.id))]);
      } else {
        const ids = shapes.filter((shape) => { const b = shapeBounds(lib, shape); return b.x <= box.x + box.width && b.x + b.width >= box.x && b.y <= box.y + box.height && b.y + b.height >= box.y; }).map((s) => s.id);
        setSelected([...new Set([...(interaction.ids || []), ...ids])]);
      } return;
    }
    if (interaction.kind === "move") {
      setDocument({ ...current, shapes: interaction.before.shapes.map((s) => interaction.ids?.includes(s.id) ? translateShape(lib, s, delta) : s) }); return;
    }
    if (interaction.kind === "resize" || interaction.kind === "rotate") {
      const b = interaction.bounds!; const center = interaction.center!;
      if (interaction.kind === "rotate") {
        let degrees = (Math.atan2(point.y - center.y, point.x - center.x) - Math.atan2(interaction.start.y - center.y, interaction.start.x - center.x)) * 180 / Math.PI;
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
        setDocument({ ...current, shapes: interaction.before.shapes.map((s) => interaction.ids?.includes(s.id) ? rotateShape(lib, s, degrees, center) : s) }); return;
      }
      const grip = interaction.grip!; const origin = { x: event.altKey ? center.x : grip.includes("w") ? b.x + b.width : b.x, y: event.altKey ? center.y : grip.includes("n") ? b.y + b.height : b.y };
      let sx = grip.includes("w") || grip.includes("e") ? (point.x - origin.x) / ((grip.includes("w") ? b.x : b.x + b.width) - origin.x || 1) : 1;
      let sy = grip.includes("n") || grip.includes("s") ? (point.y - origin.y) / ((grip.includes("n") ? b.y : b.y + b.height) - origin.y || 1) : 1;
      if (event.shiftKey) { const scale = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy; sx = scale; sy = scale; }
      sx = Math.max(.01, sx); sy = Math.max(.01, sy);
      const target = { x: origin.x + (b.x - origin.x) * sx, y: origin.y + (b.y - origin.y) * sy, width: b.width * sx, height: b.height * sy };
      setDocument({ ...current, shapes: interaction.before.shapes.map((s) => interaction.ids?.includes(s.id) ? resizeShape(lib, s, b, target) : s) }); return;
    }
    if (interaction.kind === "anchor" && interaction.handle === "point") {
      setDocument({ ...current, shapes: interaction.before.shapes.map((s) => translateAnchors(lib, s, (interaction.anchors || []).filter((a) => a.id === s.id), delta)) }); return;
    }
    if (interaction.kind === "anchor" || interaction.kind === "pen") {
      if (interaction.kind === "pen" && Math.hypot(event.clientX - interaction.clientX, event.clientY - interaction.clientY) < 3) return;
      let destination = point;
      if (event.shiftKey) { const entry = shapeAnchors(lib, current.shapes.find((s) => s.id === interaction.id)!).find((a) => a.contour === interaction.contour && a.index === interaction.index); if (entry) { const angle = Math.round(Math.atan2(point.y - entry.point.y, point.x - entry.point.x) / (Math.PI / 4)) * Math.PI / 4; const length = Math.hypot(point.x - entry.point.x, point.y - entry.point.y); destination = { x: entry.point.x + Math.cos(angle) * length, y: entry.point.y + Math.sin(angle) * length }; } }
      setDocument({ ...current, shapes: current.shapes.map((s) => s.id === interaction.id ? moveAnchor(lib, s, interaction.contour!, interaction.index!, interaction.handle!, destination, interaction.kind === "pen" || !event.altKey) : s) }); return;
    }
    if (interaction.kind === "shape") {
      let dx = delta.x, dy = delta.y;
      if (event.shiftKey) { const size = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * size; dy = Math.sign(dy || 1) * size; }
      const rectangle = new lib.Rectangle(event.altKey ? interaction.start.x - Math.abs(dx) : Math.min(interaction.start.x, interaction.start.x + dx), event.altKey ? interaction.start.y - Math.abs(dy) : Math.min(interaction.start.y, interaction.start.y + dy), Math.abs(dx) * (event.altKey ? 2 : 1), Math.abs(dy) * (event.altKey ? 2 : 1));
      const item = interaction.shapeType === "rectangle" ? new lib.Path.Rectangle({ rectangle, insert: false }) : new lib.Path.Ellipse({ rectangle, insert: false });
      const d = item.pathData; item.remove(); setDocument({ ...current, shapes: current.shapes.map((s) => s.id === interaction.id ? { ...s, d } : s) });
    }
  };
  const pointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const interaction = drag.current; drag.current = null; setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!interaction || interaction.kind === "pan" || !docRef.current) return;
    if (interaction.kind === "marquee") {
      if (Math.hypot(event.clientX - interaction.clientX, event.clientY - interaction.clientY) < 3) {
        if (interaction.clickAnchors?.length) selectAnchors(interaction.clickAnchors, interaction.additive);
        else if (interaction.clickShapeId && !interaction.additive) { setSelected([interaction.clickShapeId]); setAnchorSelection([]); }
      }
      return;
    }
    if (interaction.kind === "shape" && Math.hypot(event.clientX - interaction.clientX, event.clientY - interaction.clientY) < 3) { setDocument(interaction.before); setSelected([]); return; }
    commit(docRef.current, interaction.before);
  };
  const doubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const lib = scope.current, current = docRef.current;
    if (!["select", "direct"].includes(tool) || !lib || !current) return;
    const point = pointFromEvent(event, false);
    // Capturing pointer drags on the SVG can retarget the subsequent dblclick
    // to the canvas itself. Resolve the painted path under the pointer again.
    const targetId = (event.target as SVGElement).dataset.shape;
    const hitId = targetId || document.elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element instanceof SVGElement ? element.dataset.shape : undefined)
      .find((id) => !!id && current.shapes.some((shape) => shape.id === id));
    const candidates = hitId ? current.shapes.filter((shape) => shape.id === hitId) : current.shapes.toReversed();
    for (const shape of candidates) {
      if (shape.opacity <= 0 || (isolation && shape.id !== isolation.id)) continue;
      const tolerance = Math.max(unit * 10, (shape.stroke === "none" ? 0 : shape.strokeWidth / 2) + unit * 5);
      // A painted fill can be far from its edge. Only proximity-test when
      // the browser did not identify a path directly under the pointer.
      if (!hitId && !nearestCurve(lib, shape, point, tolerance)) continue;
      const id = shape.id;
      setIsolation({ id }); setTool("direct"); setSelected([id]); setAnchorSelection([]);
      setMessage("Path isolated. Edit any anchor or press V to transform the whole path. Enter returns to the full icon."); return;
    }
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "Meta" || event.key === "Control") setModifierDown(true);
      if (event.key === "Tab") {
        const focusRoot = discardPrompt ? dialogRef.current?.querySelector(".ve-discard") : dialogRef.current;
        const elements = Array.from(focusRoot?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]') || []).filter((element) => element.offsetParent !== null);
        if (elements.length) {
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (event.code === "Space") { event.preventDefault(); setSpaceDown(true); return; }
      if (discardPrompt) { if (event.key === "Escape") setDiscardPrompt(false); return; }
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (modifier && event.key.toLowerCase() === "a") { event.preventDefault(); const shapes = (docRef.current?.shapes || []).filter((s) => !isolation || s.id === isolation.id); if (tool === "direct" && scope.current) selectAnchors(shapes.flatMap((s) => shapeAnchors(scope.current!, s).map((a) => ({ id: s.id, contour: a.contour, index: a.index })))); else setSelected(shapes.map((s) => s.id)); return; }
      if (modifier && event.key.toLowerCase() === "d") { event.preventDefault(); duplicate(); return; }
      if (modifier && event.key.toLowerCase() === "j") { event.preventDefault(); connectSelection(); return; }
      if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); if (docRef.current) onSave(exportVectorSvg(docRef.current, scope.current!)); return; }
      if (modifier) return;
      if (event.key === "Enter" && target.closest('button, [role="button"], a[href]')) return;
      if (event.key === "Escape") { event.preventDefault(); if (discardPrompt) setDiscardPrompt(false); else if (penId) finishPen(); else if (isolation) exitIsolation(); else if (selected.length) { setSelected([]); setAnchorSelection([]); } else requestClose(); return; }
      if (event.key === "Enter" && isolation) { event.preventDefault(); exitIsolation(); return; }
      if (event.key === "Enter" && penId) { event.preventDefault(); finishPen(); return; }
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); return; }
      if (event.key.startsWith("Arrow") && selected.length && scope.current) {
        event.preventDefault(); const amount = event.shiftKey ? 1 : .25;
        const delta = { x: event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0, y: event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0 };
        if (anchorSelection.length && tool === "direct") alterSelected((shape) => translateAnchors(scope.current!, shape, anchorSelection.filter((a) => a.id === shape.id), delta));
        else alterSelected((shape) => translateShape(scope.current!, shape, delta));
        return;
      }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); changeTool("add"); return; }
      if (event.key === "-") { event.preventDefault(); changeTool("remove"); return; }
      if (event.key === "?") { event.preventDefault(); setShortcutsOpen((open) => !open); return; }
      if (event.key === "0") { event.preventDefault(); fit(); return; }
      const next = toolList.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (next) { event.preventDefault(); changeTool(next.id); }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceDown(false); if (event.key === "Meta" || event.key === "Control") setModifierDown(false); };
    const blur = () => { setSpaceDown(false); setModifierDown(false); };
    window.addEventListener("keydown", keyDown); window.addEventListener("keyup", keyUp); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keyDown); window.removeEventListener("keyup", keyUp); window.removeEventListener("blur", blur); };
  });

  const renderedPaths = useMemo(() => new Map(doc && renderScope ? doc.shapes.map(shape => [shape.id, renderedPathData(renderScope, shape)]) : []), [doc, renderScope]);
  const junctionCaps = useMemo(() => doc && renderScope ? vectorJunctionCaps(renderScope, doc.shapes.map(shape => ({ ...shape, d: renderedPaths.get(shape.id) || shape.d }))) : [], [doc, renderScope, renderedPaths]);
  const anchors = renderScope && doc ? doc.shapes.filter((s) => isolation ? s.id === isolation.id : selected.includes(s.id)).flatMap((shape) => shapeAnchors(renderScope!, shape).map((entry) => ({ ...entry, id: shape.id }))) : [];
  const bounds = useMemo(() => renderScope && doc ? selectionBounds(renderScope, doc.shapes.filter((shape) => selected.includes(shape.id))) : null, [renderScope, doc, selected]);
  const transformField = (key: keyof Bounds, value: number) => {
    if (!bounds || !scope.current || !Number.isFinite(value) || ((key === "width" || key === "height") && value <= 0)) return;
    const next = { ...bounds, [key]: value }; alterSelected((shape) => resizeShape(scope.current!, shape, bounds, next));
  };
  const convertSelected = (action: "smooth" | "corner") => alterSelected((shape) => anchorSelection.filter((a) => a.id === shape.id).reduce((result, a) => changeAnchor(scope.current!, result, a.contour, a.index, action), shape));
  const splitAtSelection = () => {
    const current = docRef.current, lib = scope.current, entry = anchorSelection[0]; if (!current || !lib || !entry) return;
    try {
      const source = current.shapes.find((shape) => shape.id === entry.id); if (!source) return;
      const parts = splitShapeAtAnchor(lib, source, entry);
      commit({ ...current, shapes: current.shapes.flatMap((shape) => shape.id === entry.id ? parts : [shape]) }); setSelected(parts.map((shape) => shape.id)); setAnchorSelection([]); setIsolation(null); setMessage("Path cut at the selected anchor. Both sides remain editable.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This path could not be split."); }
  };
  const transformGrips = bounds ? [["nw", bounds.x, bounds.y], ["n", bounds.x + bounds.width / 2, bounds.y], ["ne", bounds.x + bounds.width, bounds.y], ["e", bounds.x + bounds.width, bounds.y + bounds.height / 2], ["se", bounds.x + bounds.width, bounds.y + bounds.height], ["s", bounds.x + bounds.width / 2, bounds.y + bounds.height], ["sw", bounds.x, bounds.y + bounds.height], ["w", bounds.x, bounds.y + bounds.height / 2]] as [string, number, number][] : [];
  const constructionGrid = standards?.constructionGrid || 'none';
  return <div className="ve-backdrop">
    <div className="ve-editor" role="dialog" aria-modal="true" aria-labelledby="ve-title" tabIndex={-1} ref={dialogRef}>
      <header className="ve-header">
        <button className="ve-back" onClick={requestClose}><ChevronLeft size={17} /> Back to explorations</button>
        <div className="ve-title"><span className="ve-title-icon"><PenTool size={17} /></span><div><h2 id="ve-title">{name}</h2><span>Vector editor <span className="ve-separator">/</span> {doc ? `${doc.width} × ${doc.height}` : "Loading"}</span></div><span className="ve-draft">{isDirty ? "Unsaved changes" : "Original"}</span></div>
        <button className="ve-save" disabled={!doc?.shapes.length} onClick={() => { if (doc) { setPenId(null); onSave(exportVectorSvg(doc, scope.current!)); } }}><Check size={16} /> Save changes</button>
      </header>
      <div className="ve-commandbar">
        <div className="ve-command-group"><button title="Undo (⌘Z)" aria-label="Undo" disabled={!historyStatus.undo} onClick={undo}><Undo2 size={17} /></button><button title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!historyStatus.redo} onClick={redo}><Redo2 size={17} /></button></div>
        <span className="ve-divider" />
        {connection && <div className="ve-command-group ve-connect-control"><button className="ve-connect-button" disabled={!connection.allowed} aria-describedby="ve-connect-state" title={`${connection.reason} (Cmd/Ctrl+J)`} onClick={connectSelection}><Link2 size={17} /><span>Connect</span></button><span id="ve-connect-state" className="ve-connect-state" title={connection.reason}>{connection.allowed ? '2 open endpoints selected' : connection.reason}</span></div>}
        <div className="ve-command-group ve-boolean-tools" aria-label="Boolean operations">
          <button disabled={selected.length < 2} title="Unite selected closed shapes" onClick={() => boolean("unite")}><BooleanIcon type="unite" /><span>Unite</span></button>
          <button disabled={selected.length < 2} title="Subtract front shapes from the back shape" onClick={() => boolean("subtract")}><BooleanIcon type="subtract" /><span>Subtract</span></button>
          <button disabled={selected.length < 2} title="Keep the intersection" onClick={() => boolean("intersect")}><BooleanIcon type="intersect" /><span>Intersect</span></button>
          <button disabled={selected.length < 2} title="Exclude overlapping areas (XOR)" onClick={() => boolean("exclude")}><BooleanIcon type="exclude" /><span>Exclude</span></button>
          <button disabled={selected.length < 2} title="Divide overlapping closed paths into editable regions" onClick={() => pathCommand("divide")}><Scissors size={17} /><span>Divide</span></button>
        </div>
        <span className="ve-divider" />
        <div className="ve-command-group"><button disabled={!selected.length} title="Duplicate (⌘D)" aria-label="Duplicate selected shapes" onClick={duplicate}><Copy size={16} /></button><button disabled={!selected.length} title="Delete selected shapes or anchor" aria-label="Delete selection" onClick={deleteSelection}><Trash2 size={16} /></button></div>
        <div className="ve-command-spacer" />
        <label className="ve-check" title="One square = one SVG unit = one pixel at export size"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid</label>
        {constructionGrid !== 'none' && <div className="ve-guide-control"><label className="ve-check"><input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} /> Guides</label><span>{constructionGrid === 'keyline' ? 'Keylines' : 'Concentric'}</span></div>}
        <button className="ve-properties-toggle" onClick={()=>setPropertiesOpen(!propertiesOpen)} aria-pressed={propertiesOpen} aria-label="Toggle appearance and layers"><Layers size={16}/></button>
        <label className="ve-check"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap</label>
      </div>
      <div className="ve-workspace">
        <nav className="ve-tools" aria-label="Drawing tools">{toolList.map(({ id, title, key, Icon }, index) => <div key={id}>{(index === 2 || id === "rectangle" || id === "hand") && <div className="ve-tool-rule" />}<button className={tool === id ? "active" : ""} title={`${title} (${key})`} aria-label={`${title} (${key})`} aria-pressed={tool === id} onClick={() => changeTool(id)}><Icon size={19} /><span>{key}</span></button></div>)}</nav>
        <div className={`ve-canvas-wrap ve-tool-${spaceDown ? "hand" : tool} ${darkCanvas ? "dark-previews" : ""}`}>
          <div className="ve-artboard-label">{name} <span>{doc?.width || 24} × {doc?.height || 24} units</span><span title="One SVG unit equals one pixel at the exported artboard size">1 square = 1 unit</span></div>
          {isolation && <div className="ve-isolation-bar"><span>Isolated path</span><button onClick={exitIsolation} title="Return to the full icon (Enter or Esc)"><X size={14} /> Exit <kbd>Enter</kbd></button></div>}
          {doc && <svg ref={svgRef} className="ve-canvas" aria-label="Editable vector artboard" role="img" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={(e) => { if (drag.current?.before) setDocument(drag.current.before); drag.current = null; setMarquee(null); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onDoubleClick={doubleClick}>
            <defs><pattern id="ve-grid" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke={darkCanvas ? "#ffffff28" : "#e8e4ed"} strokeWidth={unit * .65} /></pattern></defs>
            <rect x={0} y={0} width={doc.width} height={doc.height} fill={darkCanvas ? "#283748" : "white"} stroke={darkCanvas ? "#71839a" : "#e0dbe5"} strokeWidth={unit} />
            {grid && <rect x={0} y={0} width={doc.width} height={doc.height} fill="url(#ve-grid)" pointerEvents="none" />}
            {showGuides && constructionGrid !== 'none' && <GuideShapes grid={constructionGrid} canvas={{ x: 0, y: 0, width: doc.width, height: doc.height }} strokeWidth={unit * 1.1} showGrid={false} />}
            {doc.shapes.map((shape) => <g key={shape.id} opacity={isolation && isolation.id !== shape.id ? .18 : 1} pointerEvents={isolation && isolation.id !== shape.id ? "none" : undefined}><path data-shape={shape.id} d={renderedPaths.get(shape.id) || shape.d} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.strokeWidth} strokeLinecap={shape.lineCap} strokeLinejoin={shape.lineJoin} fillRule={shape.fillRule} opacity={shape.opacity} strokeDasharray={shape.dashArray} strokeDashoffset={shape.dashOffset} strokeMiterlimit={shape.miterLimit} />
              {junctionCaps.filter(cap => cap.shapeId === shape.id).map((cap, index) => <path key={index} data-shape={shape.id} d={cap.d} fill="none" stroke={shape.stroke} strokeWidth={shape.strokeWidth} strokeLinecap="square" />)}
              <path data-shape={shape.id} d={renderedPaths.get(shape.id) || shape.d} fill="none" stroke="transparent" strokeWidth={Math.max(shape.strokeWidth, unit * 12)} pointerEvents="stroke" />
              {selected.includes(shape.id) && <path d={shape.d} fill="none" stroke="#467699" strokeWidth={unit * 1.15} pointerEvents="none" />}
            </g>)}
            {tool === "select" && !modifierDown && bounds && <g className="ve-transform-box">
              <rect x={bounds.x} y={bounds.y} width={Math.max(bounds.width, unit)} height={Math.max(bounds.height, unit)} fill="none" stroke="#467699" strokeWidth={unit} pointerEvents="none" />
              <line x1={bounds.x + bounds.width / 2} x2={bounds.x + bounds.width / 2} y1={bounds.y} y2={bounds.y - unit * 24} stroke="#467699" strokeWidth={unit} pointerEvents="none" />
              <circle data-transform="rotate" aria-label="Rotate selection" cx={bounds.x + bounds.width / 2} cy={bounds.y - unit * 24} r={unit * 5} fill="white" stroke="#467699" strokeWidth={unit * 1.3} />
              {transformGrips.map(([grip, x, y]) => <rect key={grip} data-transform={grip} aria-label={`Resize ${grip}`} x={x - anchorRadius} y={y - anchorRadius} width={anchorRadius * 2} height={anchorRadius * 2} fill="white" stroke="#467699" strokeWidth={unit * 1.3} />)}
            </g>}
            {(tool === "direct" || tool === "pen" || tool === "convert" || tool === "remove" || modifierDown) && anchors.map((entry) => {
              const chosen = anchorSelection.some((a) => sameAnchor(a, entry));
              const controls = (["handleIn", "handleOut"] as const).filter((key) => Math.hypot(entry[key].x, entry[key].y) > .0001);
              return <g key={`${entry.id}-${entry.contour}-${entry.index}`}>
                {controls.map((key) => <g key={key}><line x1={entry.point.x} y1={entry.point.y} x2={entry.point.x + entry[key].x} y2={entry.point.y + entry[key].y} stroke="#467699" strokeWidth={unit} pointerEvents="none" /><circle data-shape={entry.id} data-contour={entry.contour} data-index={entry.index} data-handle={key} cx={entry.point.x + entry[key].x} cy={entry.point.y + entry[key].y} r={anchorRadius} fill="#fff" stroke="#467699" strokeWidth={unit * 1.3} /></g>)}
                <rect data-shape={entry.id} data-contour={entry.contour} data-index={entry.index} data-handle="point" x={entry.point.x - anchorRadius} y={entry.point.y - anchorRadius} width={anchorRadius * 2} height={anchorRadius * 2} rx={unit * .5} fill={chosen ? "#467699" : "white"} stroke="#467699" strokeWidth={unit * 1.3} />
                {tool === "pen" && penId === entry.id && entry.contour === 0 && entry.index === 0 && <circle cx={entry.point.x} cy={entry.point.y} r={anchorRadius * 2} fill="none" stroke="#467699" strokeWidth={unit * .7} pointerEvents="none" />}
              </g>;
            })}
            {marquee && <rect {...marquee} fill="#46769918" stroke="#467699" strokeWidth={unit} strokeDasharray={`${unit * 4} ${unit * 3}`} pointerEvents="none" />}
          </svg>}
          {!doc && <div className="ve-empty">{error ? <><Scissors size={30} /><h3>This icon needs a little preparation</h3><p>{error}</p><button onClick={onClose}>Return to icon</button></> : <><div className="ve-spinner" /><p>Opening your vector workspace…</p></>}</div>}
          {doc && error && <div className="ve-feedback ve-error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={14} /></button></div>}
          {doc && message && !error && <div className="ve-feedback" role="status"><Check size={14} /><span>{message}</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X size={14} /></button></div>}
          <div className="ve-zoom"><button aria-label="Zoom out" onClick={() => zoom(1.25)}><Minus size={15} /></button><span>{doc ? Math.round(doc.width * 1.4 / view.width * 100) : 100}%</span><button aria-label="Zoom in" onClick={() => zoom(.8)}><Plus size={15} /></button><span className="ve-divider" /><button aria-label="Fit artboard" title="Fit artboard (0)" onClick={() => fit()}><Maximize2 size={15} /><span>Fit</span></button></div>
        </div>
        <aside className={`ve-properties ${propertiesOpen?"ve-properties-open":""}`}>
          <div className="ve-inspector-heading"><button className="ve-properties-close" aria-label="Close appearance panel" onClick={()=>setPropertiesOpen(false)}><X size={15}/></button><span>Design</span><span className="ve-selection-count">{selected.length ? `${selected.length} selected` : "New paths"}</span></div>
          {bounds && <section className="ve-property-section"><h3>Transform</h3><div className="ve-transform-fields">{(["x", "y", "width", "height"] as const).map((key) => <label key={key}>{({ x: "X", y: "Y", width: "W", height: "H" })[key]}<input aria-label={`Selection ${key}`} type="number" step="0.25" key={`${key}-${bounds[key]}`} defaultValue={Number(bounds[key].toFixed(3))} onBlur={(event) => { const value = Number(event.target.value); if (!event.target.value.trim() || !Number.isFinite(value) || ((key === "width" || key === "height") && value <= 0)) { event.currentTarget.value = String(Number(bounds[key].toFixed(3))); return; } transformField(key, value); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>)}</div><div className="ve-two-buttons"><button onClick={() => alterSelected((shape) => flipShape(scope.current!, shape, "horizontal", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }))}>Flip horizontal</button><button onClick={() => alterSelected((shape) => flipShape(scope.current!, shape, "vertical", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }))}>Flip vertical</button></div><p className="ve-small-note">V shows resize handles. Drag the circle to rotate. Shift constrains; Alt resizes from the center.</p></section>}
          <section className="ve-property-section"><h3>Appearance</h3>
            <div className="ve-color-row"><label htmlFor="ve-fill">Fill</label><div className="ve-color-control"><input id="ve-fill" aria-label="Fill color" type="color" value={colorInput(style.fill)} onChange={(e) => updateStyle({ fill: e.target.value })} /><span>{style.fill === "none" ? "None" : style.fill.toUpperCase()}</span><button className={style.fill === "none" ? "is-none" : ""} aria-label="Remove fill" title="No fill" onClick={() => updateStyle({ fill: "none" })}>∅</button></div></div>
            <div className="ve-color-row"><label htmlFor="ve-stroke">Stroke</label><div className="ve-color-control"><input id="ve-stroke" aria-label="Stroke color" type="color" value={colorInput(style.stroke)} onChange={(e) => updateStyle({ stroke: e.target.value })} /><span>{style.stroke === "none" ? "None" : style.stroke.toUpperCase()}</span><button className={style.stroke === "none" ? "is-none" : ""} aria-label="Remove stroke" title="No stroke" onClick={() => updateStyle({ stroke: "none" })}>∅</button></div></div>
            <div className="ve-property-row"><label htmlFor="ve-weight">Weight</label><div className="ve-number"><input id="ve-weight" type="number" min="0" max="100" step="0.25" value={Number(style.strokeWidth.toFixed(3))} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= 100) updateStyle({ strokeWidth: value }); }} /><span title="SVG units">u</span></div></div>
            <p className="ve-small-note">1 unit = 1 grid square = 1 px at export size.</p>
            <div className="ve-property-row"><label htmlFor="ve-radius">Corner radius</label><div className="ve-number"><input id="ve-radius" aria-label="Corner radius" type="number" min="0" max={Math.min(doc?.width || 24, doc?.height || 24) / 2} step="0.25" placeholder="Set" value={active && active.cornerRadius === undefined ? "" : Number((style.cornerRadius ?? 0).toFixed(3))} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0 && value <= Math.min(doc?.width || 24, doc?.height || 24) / 2) updateStyle({ cornerRadius: value, lineJoin: "miter" }); }} /><span>px</span></div></div>
            <input className="ve-radius-slider" aria-label="Adjust corner radius" type="range" min="0" max={Math.min(doc?.width || 24, doc?.height || 24) / 2} step="0.25" value={style.cornerRadius ?? 0} onChange={e => updateStyle({ cornerRadius: Number(e.target.value), lineJoin: "miter" })} />
            <p className="ve-small-note ve-corner-note">{active && active.cornerRadius === undefined ? "Set a radius to make rounded corners editable. " : "Live corners keep the sharp anchors editable. "}0 restores sharp corners; small edges limit the applied radius. Curved artwork stays curved.</p>
            <div className="ve-property-row"><label htmlFor="ve-cap">Line cap</label><StudioSelect id="ve-cap" className="ve-style-select" label="Line cap" size="sm" value={style.lineCap} onValueChange={value=>updateStyle({ lineCap: value as VectorShape["lineCap"] })} options={[{'value': 'round', 'label': 'Round'}, {'value': 'butt', 'label': 'Butt'}, {'value': 'square', 'label': 'Square'}]}/></div>
            <div className="ve-property-row"><label htmlFor="ve-join">Line join</label><StudioSelect id="ve-join" className="ve-style-select" label="Line join" size="sm" value={style.lineJoin} onValueChange={value=>updateStyle({ lineJoin: value as VectorShape["lineJoin"] })} options={[{'value': 'round', 'label': 'Round'}, {'value': 'miter', 'label': 'Miter'}, {'value': 'bevel', 'label': 'Bevel'}]}/></div>
            {active && <div className="ve-property-row"><label htmlFor="ve-opacity">Opacity</label><div className="ve-number"><input id="ve-opacity" type="number" min="0" max="100" step="5" value={Math.round(active.opacity * 100)} onChange={(e) => updateStyle({ opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} /><span>%</span></div></div>}
          </section>
          {anchorSelection.length > 0 && tool === "direct" && <section className="ve-property-section"><h3>{anchorSelection.length} anchor{anchorSelection.length > 1 ? "s" : ""} selected</h3><button className="ve-full-button ve-connect-button" disabled={!connection?.allowed} title={connection?.reason || 'Select two open endpoints'} onClick={connectSelection}><Link2 size={15} />Connect anchors<kbd>⌘/Ctrl J</kbd></button><p className="ve-small-note ve-connect-hint">{connection?.reason || 'Select two open endpoints. Cut at a selected anchor to open its path.'}</p><div className="ve-two-buttons"><button onClick={() => convertSelected("smooth")}>Make smooth</button><button onClick={() => convertSelected("corner")}>Make corner</button></div><button className="ve-text-button" onClick={deleteSelection}><Minus size={13} /> Remove selected anchors</button><button className="ve-text-button" disabled={anchorSelection.length !== 1} onClick={splitAtSelection}><Scissors size={13} /> Cut at selected anchor</button><p className="ve-small-note">Drag a handle to keep both sides linked. Alt-drag adjusts one handle independently.</p></section>}
          {penId && <section className="ve-property-section"><h3>Drawing a path</h3><button className="ve-full-button" onClick={finishPen}><CornerDownLeft size={15} /> Finish open path <kbd>↵</kbd></button></section>}
          {selected.length > 0 && <section className="ve-property-section"><h3>Path actions</h3><div className="ve-two-buttons"><button onClick={() => reorder("front")}><ArrowUp size={13} /> To front</button><button onClick={() => reorder("back")}><ArrowDown size={13} /> To back</button></div><button className="ve-text-button" onClick={() => { alterSelected((shape) => closeShape(scope.current!, shape)); setMessage("Selected paths closed. They can now be used in Boolean operations."); }}><PenTool size={13} /> Close selected paths</button><div className="ve-path-actions"><button disabled={selected.length < 2} onClick={() => pathCommand("compound")}>Make compound</button><button onClick={() => pathCommand("release")}>Release compound</button><button onClick={() => pathCommand("reverse")}>Reverse direction</button></div><p className="ve-small-note">Subtract cuts front shapes out of the back shape. Layers at the top are in front.</p></section>}
          <section className="ve-property-section ve-layer-section"><h3><Layers size={14} /> Layers <span>{doc?.shapes.length || 0}</span></h3><div className="ve-layer-list">{doc?.shapes.toReversed().map((shape, index) => <button key={shape.id} className={`ve-layer ${selected.includes(shape.id) ? "selected" : ""}`} disabled={!!isolation && isolation.id !== shape.id} onClick={(event) => { setSelected((previous) => event.shiftKey ? previous.includes(shape.id) ? previous.filter((id) => id !== shape.id) : [...previous, shape.id] : [shape.id]); setAnchorSelection([]); }}><svg viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden="true"><path d={renderedPaths.get(shape.id) || shape.d} fill={shape.fill} stroke={shape.stroke} strokeWidth={shape.strokeWidth} strokeLinecap={shape.lineCap} strokeLinejoin={shape.lineJoin} /></svg><span>{shape.name}</span><small>{index === 0 ? "Front" : ""}</small></button>)}</div><p className="ve-small-note">Shift-click to select multiple shapes.</p></section>
        </aside>
      </div>
      <footer className="ve-status"><span><span className="ve-status-dot" />{toolList.find((item) => item.id === tool)?.title}</span><p>{hints[tool]}</p>{onToggleDarkCanvas&&<PreviewBackgroundToggle dark={darkCanvas} onToggle={onToggleDarkCanvas}/>}<button className="ve-shortcuts-button" onClick={() => setShortcutsOpen(!shortcutsOpen)} aria-expanded={shortcutsOpen}>Shortcuts ?</button></footer>
      {shortcutsOpen && <div className="ve-shortcuts"><div><strong>Editing shortcuts</strong><button aria-label="Close shortcuts" onClick={() => setShortcutsOpen(false)}><X size={15} /></button></div><dl><dt>V / A</dt><dd>Select paths / select anchors</dd><dt>Cmd / Ctrl-drag</dt><dd>Draw a box to select anchors, even over filled shapes</dd><dt>Cmd / Ctrl-click</dt><dd>Select a point or segment</dd><dt>Cmd / Ctrl J</dt><dd>Join two selected open endpoints</dd><dt>Shift-click / drag</dt><dd>Add points or paths / marquee selection</dd><dt>Double-click</dt><dd>Isolate the whole path; Enter or Escape exits</dd><dt>P / + / − / C</dt><dd>Pen / add point / remove point / convert</dd><dt>Shift / Alt</dt><dd>Constrain movement / independent curve handle</dd><dt>Space + drag</dt><dd>Pan the canvas</dd><dt>Cmd / Ctrl Z</dt><dd>Undo; add Shift to redo</dd><dt>Cmd / Ctrl D</dt><dd>Duplicate selected paths</dd><dt>Arrows / Shift</dt><dd>Nudge 0.25 px / 1 px</dd></dl></div>}
      {discardPrompt && <div className="ve-discard-overlay"><div className="ve-discard" role="alertdialog" aria-labelledby="ve-discard-title"><h3 id="ve-discard-title">Keep your changes?</h3><p>You have unsaved vector edits. Save them to this exploration or discard them.</p><div><button onClick={() => setDiscardPrompt(false)}>Keep editing</button><button className="ve-discard-button" onClick={onClose}>Discard</button><button className="ve-save" onClick={() => { if (doc) onSave(exportVectorSvg(doc, scope.current!)); }}>Save changes</button></div></div></div>}
    </div>
  </div>;
}

function BooleanIcon({ type }: { type: BooleanOperation }) {
  return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1" fill={type === "unite" || type === "subtract" || type === "exclude" ? "currentColor" : "none"} fillOpacity=".2" stroke="currentColor" strokeWidth="1.3" /><rect x="8" y="8" width="10" height="10" rx="1" fill={type === "unite" || type === "exclude" ? "currentColor" : "white"} fillOpacity={type === "subtract" ? ".9" : ".2"} stroke="currentColor" strokeWidth="1.3" />{type === "intersect" && <rect x="8" y="8" width="4" height="4" fill="currentColor" />}{type === "exclude" && <rect x="8" y="8" width="4" height="4" fill="white" />}</svg>;
}
