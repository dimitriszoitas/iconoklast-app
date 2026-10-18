import type paper from 'paper';
import type { VectorShape } from './vector-editor-geometry';

export type JunctionCap = { shapeId: string; d: string };

/** Derive square ends only where an open, round-capped stroke lands on a
 * transverse stroke. Input paths must already include their live corner effect.
 * The tiny stroke uses the original width, so exported caps remain responsive
 * to ordinary SVG stroke-width changes. Editable centerlines are untouched.
 */
export function vectorJunctionCaps(scope: paper.PaperScope, shapes: VectorShape[]): JunctionCap[] {
  scope.activate();
  const records: { shape: VectorShape; item: paper.CompoundPath; paths: paper.Path[] }[] = [];
  const opaqueStroke = (shape: VectorShape) => {
    if (shape.opacity < 1 || shape.strokeWidth <= 0 || !shape.stroke || shape.stroke === 'none' || (shape.dashArray && shape.dashArray !== 'none')) return false;
    try { return new scope.Color(shape.stroke).alpha === 1; } catch { return false; }
  };
  try {
    for (const shape of shapes) {
      if (!opaqueStroke(shape)) continue;
      const item = new scope.CompoundPath({ pathData: shape.d, insert: false });
      records.push({ shape, item, paths: item.children as paper.Path[] });
    }
    const caps: JunctionCap[] = [];
    for (const { shape, paths } of records) {
      if (shape.lineCap !== 'round') continue;
      for (const path of paths) {
        if (path.closed || !path.curves.length || path.length < 1e-6) continue;
        for (const atStart of [true, false]) {
          const endpoint = atStart ? path.firstSegment.point : path.lastSegment.point;
          const tangent = path.getTangentAt(atStart ? 0 : path.length);
          if (!tangent || tangent.length < 1e-8) continue;
          const outward = tangent.normalize().multiply(atStart ? -1 : 1);
          const connected = records.some(target => target.paths.some(other => {
            if (other === path || !other.curves.length) return false;
            const nearest = other.getNearestLocation(endpoint);
            if (!nearest || !nearest.tangent) return false;
            // Test the endpoint against actual visible stroke coverage. A nearby
            // parallel detail is not a junction, and a real gap is never bridged.
            if (nearest.point.getDistance(endpoint) > target.shape.strokeWidth / 2 + 1e-6) return false;
            if (Math.abs(outward.cross(nearest.tangent.normalize())) < .2) return false;
            return true;
          }));
          if (!connected) continue;
          const inward = endpoint.subtract(outward.multiply(.0001));
          const n = (value: number) => String(Math.round(value * 1e8) / 1e8);
          caps.push({ shapeId: shape.id, d: `M${n(inward.x)} ${n(inward.y)}L${n(endpoint.x)} ${n(endpoint.y)}` });
        }
      }
    }
    return caps;
  } finally { records.forEach(record => record.item.remove()); }
}
