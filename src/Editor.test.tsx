import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Editor from './Editor';
import { newBoard, type Annotation } from './model';

vi.mock('./PdfPage', () => ({ PdfPage: () => null }));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly pressure: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'pen';
    this.isPrimary = init.isPrimary ?? true;
    this.pressure = init.pressure ?? 0.5;
  }
  getCoalescedEvents() { return []; }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const changes = vi.fn<(annotations: Annotation[]) => void>();
  function Harness() {
    const [lesson, setLesson] = useState(() => newBoard());
    const [selected, setSelected] = useState<string | null>(null);
    return <Editor lesson={lesson} index={0} zoom={1} tool="pen" color="#173a43" width={3} opacity={1}
      selected={selected} onSelect={setSelected} onText={vi.fn()} onChange={annotations => {
        changes(annotations);
        setLesson(current => ({ ...current, pages: [{ ...current.pages[0], annotations }] }));
      }} />;
  }
  const view = render(<Harness />), canvas = view.getByTestId('annotation-canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1600, 1000));
  const captured = new Set<number>();
  Object.defineProperties(canvas, {
    setPointerCapture: { value: vi.fn((id: number) => captured.add(id)) },
    hasPointerCapture: { value: (id: number) => captured.has(id) },
    releasePointerCapture: { value: vi.fn((id: number) => captured.delete(id)) },
  });
  const input = (type: string, x: number, y: number, extra: PointerEventInit = {}) => {
    fireEvent(canvas, new TestPointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'pen', isPrimary: true,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: x, clientY: y, ...extra,
    }));
  };
  const stroke = () => { input('pointerdown', 100, 100); input('pointermove', 150, 150); input('pointerup', 180, 160); };
  return { ...view, canvas, captured, changes, input, stroke };
}

describe('pen input continuity', () => {
  it('uses the parent event when coalesced samples are empty and includes the pen-up endpoint', () => {
    const { input, changes } = setup();
    input('pointerdown', 100, 100);
    input('pointermove', 150, 140);
    input('pointerup', 200, 180);
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.lastCall![0][0].points.map(({ x, y }) => [x, y])).toEqual([[100, 100], [150, 140], [200, 180]]);
  });

  it('retains pressure samples from a coalesced batch without duplicating its parent endpoint', () => {
    const { input, changes, canvas } = setup();
    input('pointerdown', 100, 100);
    const event = new TestPointerEvent('pointermove', { bubbles: true, pointerId: 7, buttons: 1, clientX: 150, clientY: 140, pressure: 0.8 });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => [
      new TestPointerEvent('pointermove', { clientX: 130, clientY: 120, pressure: 0.2 }),
      event,
    ] });
    fireEvent(canvas, event);
    input('pointerup', 180, 160);
    const points = changes.mock.lastCall![0][0].points;
    expect(points.map(p => p.x)).toEqual([100, 130, 150, 180]);
    expect(points.slice(1, 3).map(p => p.pressure)).toEqual([0.2, 0.8]);
  });

  it('batches dense move previews into one animation frame without dropping their saved samples', () => {
    const { input, changes, canvas } = setup();
    input('pointerdown', 100, 100);
    for (let i = 1; i <= 100; i++) input('pointermove', 100 + i, 100 + i);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(16));
    expect(canvas.querySelector('path[fill="#173a43"]')).not.toBeNull();
    input('pointerup', 210, 210);
    expect(changes.mock.lastCall![0][0].points).toHaveLength(102);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let another primary touch or its cancellation replace/end the pen stroke', () => {
    const { input, changes } = setup();
    input('pointerdown', 100, 100);
    input('pointermove', 140, 140);
    input('pointerdown', 900, 900, { pointerId: 8, pointerType: 'touch' });
    input('pointermove', 950, 950, { pointerId: 8, pointerType: 'touch' });
    input('pointercancel', 950, 950, { pointerId: 8, pointerType: 'touch' });
    input('pointerup', 950, 950, { pointerId: 8, pointerType: 'touch' });
    expect(changes).not.toHaveBeenCalled();
    input('pointermove', 180, 160);
    input('pointerup', 200, 180);
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.lastCall![0][0].points.every(p => p.x <= 200 && p.y <= 180)).toBe(true);
    expect(changes.mock.lastCall![0][0].points).toHaveLength(4);
  });

  it('a fresh primary pen contact recovers from a missing terminal event and changed pointer ID', () => {
    const { input, changes, captured } = setup();
    input('pointerdown', 100, 100);
    input('pointermove', 150, 140);
    input('pointerdown', 500, 300, { pointerId: 9 });
    expect(changes).toHaveBeenCalledOnce();
    expect(captured.has(7)).toBe(false);
    input('pointermove', 550, 340, { pointerId: 9 });
    input('pointerup', 600, 350, { pointerId: 9 });
    expect(changes.mock.lastCall![0]).toHaveLength(2);
    expect(changes.mock.lastCall![0][0].points.map(p => p.x)).toEqual([100, 150]);
    expect(changes.mock.lastCall![0][1].points.map(p => p.x)).toEqual([500, 550, 600]);
  });

  it('lets the pen take priority over an unfinished touch without committing stray touch ink', () => {
    const { input, changes, captured } = setup();
    input('pointerdown', 900, 900, { pointerId: 8, pointerType: 'touch' });
    input('pointermove', 950, 950, { pointerId: 8, pointerType: 'touch' });
    input('pointerdown', 100, 100);
    expect(captured.has(8)).toBe(false);
    input('pointerup', 950, 950, { pointerId: 8, pointerType: 'touch' });
    expect(changes).not.toHaveBeenCalled();
    input('pointermove', 150, 140);
    input('pointerup', 180, 160);
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.lastCall![0]).toHaveLength(1);
    expect(changes.mock.lastCall![0][0].points.map(p => p.x)).toEqual([100, 150, 180]);
  });

  for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'hidden', 'hover'] as const) {
    it(`preserves sampled ink on ${interruption} and accepts the next pen stroke without stray connections`, () => {
      const { input, changes, stroke, captured } = setup();
      input('pointerdown', 100, 100);
      input('pointermove', 150, 140);
      if (interruption === 'blur') fireEvent(window, new Event('blur'));
      else if (interruption === 'hidden') {
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange')); visibility.mockRestore();
      } else if (interruption === 'hover') input('pointermove', 900, 900, { buttons: 0, pressure: 0 });
      else input(interruption, 0, 0, { buttons: 0 });
      expect(changes).toHaveBeenCalledOnce();
      expect(changes.mock.lastCall![0][0].points.map(p => p.x)).toEqual([100, 150]);
      expect(captured.size).toBe(0);
      stroke();
      expect(changes).toHaveBeenCalledTimes(2);
      expect(changes.mock.lastCall![0]).toHaveLength(2);
      expect(changes.mock.lastCall![0][1].points.map(p => p.x)).toEqual([100, 150, 180]);
    });
  }

  it('finishes using the latest samples even when pen-up arrives before the next animation frame', () => {
    const { stroke, changes } = setup();
    for (let i = 0; i < 80; i++) stroke();
    expect(changes).toHaveBeenCalledTimes(80);
    expect(changes.mock.lastCall![0]).toHaveLength(80);
    expect(changes.mock.lastCall![0].every(a => a.points.length === 3)).toBe(true);
    act(() => vi.runOnlyPendingTimers());
    expect(changes).toHaveBeenCalledTimes(80);
  });
});
