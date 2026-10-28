import { openDB } from 'idb';
import { lessonSchema, type Lesson } from './model';

const db = () => openDB('teacher-studio', 1, {
  upgrade(database) { database.createObjectStore('lessons', { keyPath: 'id' }); },
  blocked() { console.error('Teacher Studio storage upgrade is blocked by another window.'); },
});
const JOURNAL = 'teacher-studio:recovery:';
export type Recovery = Omit<Lesson, 'source'>;

export function journal(lesson: Lesson): void {
  const { source: _source, ...recovery } = lesson;
  void _source;
  try { localStorage.setItem(JOURNAL + lesson.id, JSON.stringify(recovery)); }
  catch { throw new Error('Recovery storage is full or unavailable. Export an editable project now before closing.'); }
}

export async function saveLesson(lesson: Lesson): Promise<void> {
  const database = await db();
  try {
    await database.put('lessons', lesson);
    const pending = localStorage.getItem(JOURNAL + lesson.id);
    if (pending && JSON.parse(pending).updatedAt === lesson.updatedAt) localStorage.removeItem(JOURNAL + lesson.id);
  } catch (error) { throw new Error(`Could not save lesson: ${error instanceof Error ? error.message : String(error)}. Export a project to keep your work.`); }
  finally { database.close(); }
}

export async function loadLessons(): Promise<Lesson[]> {
  const database = await db();
  try {
    const records: unknown[] = await database.getAll('lessons');
    const lessons = records.map(record => lessonSchema.parse(record));
    for (const lesson of lessons) {
      const saved = localStorage.getItem(JOURNAL + lesson.id);
      if (saved) {
        const recovery: unknown = JSON.parse(saved);
        const restored = lessonSchema.parse({ ...lesson, ...Object(recovery), source: lesson.source });
        if (restored.updatedAt >= lesson.updatedAt) Object.assign(lesson, restored);
      }
    }
    return lessons;
  } catch (error) { throw new Error(`Library could not be loaded. Existing data was not replaced. ${error instanceof Error ? error.message : String(error)}`); }
  finally { database.close(); }
}

export async function deleteLesson(id: string) {
  const database = await db();
  try { await database.delete('lessons', id); localStorage.removeItem(JOURNAL + id); }
  finally { database.close(); }
}
