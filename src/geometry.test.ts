import { describe, expect, it } from 'vitest';
import { bounds, documentPoint, hitTest, resize, translate } from './geometry';
import type { Annotation } from './model';
import { commit, history, redo, undo } from './history';

const object: Annotation = { id: 'stroke', type: 'pen', color: '#173a43', width: 3, opacity: 1, points: [{ x: 100, y: 200, pressure: 0.5 }, { x: 300, y: 400, pressure: 1 }] };
describe('stable page geometry', () => {
  it('maps to the same document coordinates at different zoom levels and window offsets', () => {
    expect(documentPoint(160, 220, { left: 10, top: 20, width: 300, height: 400 }, 600, 800)).toMatchObject({ x: 300, y: 400 });
    expect(documentPoint(700, 900, { left: 100, top: 100, width: 1200, height: 1600 }, 600, 800)).toMatchObject({ x: 300, y: 400 });
  });
  it('clamps to document boundaries and preserves pressure', () => {
    expect(documentPoint(-1, 900, { left: 0, top: 0, width: 300, height: 400 }, 600, 800, 0.9)).toEqual({ x: 0, y: 800, pressure: 0.9 });
  });
  it('moves and resizes objects without mutating original data', () => {
    expect(bounds(translate(object, 10, -20))).toEqual({ x: 110, y: 180, width: 200, height: 200 });
    expect(bounds(resize(object, 400, 100))).toEqual({ x: 100, y: 200, width: 400, height: 100 });
    expect(object.points[0].x).toBe(100);
  });
  it('hit-tests actual stroke segments, not only their bounding box', () => {
    expect(hitTest(object, { x: 200, y: 300, pressure: 0.5 })).toBe(true);
    expect(hitTest(object, { x: 100, y: 400, pressure: 0.5 })).toBe(false);
  });
});
it('undo/redo restores snapshots; a new edit clears redo; history is bounded', () => {
  let state = history([object]);
  state = commit(state, [translate(object, 10, 0)]);
  expect(undo(state).present).toEqual([object]);
  expect(redo(undo(state)).present).toEqual(state.present);
  expect(commit(undo(state), []).future).toEqual([]);
  for (let i = 0; i < 80; i++) state = commit(state, []);
  expect(state.past).toHaveLength(50);
});
