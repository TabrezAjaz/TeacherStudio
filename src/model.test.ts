import { describe, expect, it } from 'vitest';
import { deserializeProject, fromBase64, newBoard, pageIndex, serializeProject, toBase64 } from './model';

describe('versioned projects', () => {
  it('round-trips fully editable objects, metadata, source and paper settings', () => {
    const lesson = newBoard('flowchart');
    lesson.source = { kind: 'pdf', name: 'original.pdf', data: toBase64(new Uint8Array([37, 80, 68, 70])) };
    lesson.subject = 'Computer Science'; lesson.folder = 'Class 10';
    const restored = deserializeProject(serializeProject(lesson));
    expect(restored).toEqual(lesson);
    expect(restored.pages[0].annotations.map(a => a.type)).toContain('text');
    expect(fromBase64(restored.source!.data)).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
  it('rejects damaged, future-version, nonfinite, unsupported and missing-source projects', () => {
    expect(() => deserializeProject('{')).toThrow('not valid JSON');
    const lesson = newBoard();
    expect(() => deserializeProject(JSON.stringify({ ...lesson, schemaVersion: 999 }))).toThrow('unsupported');
    expect(() => deserializeProject(JSON.stringify({ ...lesson, kind: 'document' }))).toThrow('source');
    expect(() => deserializeProject(JSON.stringify({ ...lesson, pages: [{ ...lesson.pages[0], width: null }] }))).toThrow();
    expect(() => fromBase64('???')).toThrow('damaged');
  });
  it('rejects duplicate page identities', () => {
    const lesson = newBoard(); lesson.pages.push(lesson.pages[0]);
    expect(() => serializeProject(lesson)).toThrow('Duplicate');
  });
  it('all educational templates contain editable objects or configured paper', () => {
    for (const id of ['blank', 'dots', 'grid', 'flowchart', 'mindmap', 'brainstorm', 'code'] as const) {
      const lesson = newBoard(id);
      expect(() => serializeProject(lesson)).not.toThrow();
      if (!['blank', 'dots', 'grid'].includes(id)) expect(lesson.pages[0].annotations.length).toBeGreaterThan(2);
    }
  });
});

it('page navigation is clamped at both document boundaries', () => {
  expect(pageIndex(0, -1, 3)).toBe(0);
  expect(pageIndex(0, 1, 3)).toBe(1);
  expect(pageIndex(2, 1, 3)).toBe(2);
});
