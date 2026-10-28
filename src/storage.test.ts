import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { deleteLesson, journal, loadLessons, saveLesson } from './storage';
import { newBoard } from './model';

afterEach(async () => {
  vi.restoreAllMocks(); localStorage.clear();
  const database = await openDB('teacher-studio', 1);
  await database.clear('lessons'); database.close();
});
describe('atomic local storage and recovery', () => {
  it('saves and reloads a complete lesson, even if an external source was moved', async () => {
    const lesson = newBoard('flowchart');
    lesson.source = { kind: 'pdf', name: 'moved.pdf', data: 'JVBERg==' };
    await saveLesson(lesson);
    expect(await loadLessons()).toEqual([lesson]);
  });
  it('recovers the latest edit after an interrupted debounced save', async () => {
    const lesson = newBoard(); await saveLesson(lesson);
    const edited = { ...lesson, title: 'Unfinished work', updatedAt: new Date(Date.now() + 1000).toISOString() };
    journal(edited);
    expect((await loadLessons())[0].title).toBe('Unfinished work');
    await saveLesson(edited);
    expect(localStorage.length).toBe(0);
  });
  it('a stale save cannot clear the newer recovery journal', async () => {
    const lesson = newBoard(), later = { ...lesson, updatedAt: new Date(Date.now() + 1000).toISOString() };
    journal(later); await saveLesson(lesson);
    expect(localStorage.length).toBe(1);
    expect((await loadLessons())[0].updatedAt).toBe(later.updatedAt);
  });
  it('reports denied recovery storage explicitly', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'QuotaExceededError'); });
    expect(() => journal(newBoard())).toThrow('Export an editable project');
  });
  it('a failed transaction leaves previous data intact and retains recovery', async () => {
    const lesson = newBoard(); await saveLesson(lesson);
    const edited = { ...lesson, title: 'Keep me', updatedAt: new Date(Date.now() + 1000).toISOString() };
    journal(edited);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'lessons') throw new DOMException('Disk full', 'QuotaExceededError');
      return original.apply(this, args);
    });
    await expect(saveLesson(edited)).rejects.toThrow('Disk full');
    expect(localStorage.length).toBe(1);
    vi.restoreAllMocks();
    expect((await loadLessons())[0].title).toBe('Keep me');
  });
  it('deletes only the chosen lesson and its recovery entry', async () => {
    const first = newBoard(), second = newBoard(); await saveLesson(first); await saveLesson(second);
    journal(first); await deleteLesson(first.id);
    expect(await loadLessons()).toEqual([second]);
    expect(localStorage.length).toBe(0);
  });
});
