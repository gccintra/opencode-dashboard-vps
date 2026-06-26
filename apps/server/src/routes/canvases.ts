import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/middleware';
import { getDb } from '../db/client';
import { randomUUID } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

function toCanvas(row: DbRow) {
  return {
    id: row.id as string,
    name: row.name as string,
    cols: row.cols as number,
    rows: row.rows as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function getSlotsMap(canvasId: string): Record<number, string | null> {
  const db = getDb();
  const rows = db
    .query('SELECT slot_index, session_id FROM canvas_slots WHERE canvas_id = ?')
    .all(canvasId) as DbRow[];
  const map: Record<number, string | null> = {};
  for (const row of rows) {
    map[row.slot_index as number] = (row.session_id as string | null) ?? null;
  }
  return map;
}

function nextCanvasName(): string {
  const db = getDb();
  const rows = db
    .query("SELECT name FROM canvases WHERE name GLOB 'Canvas [0-9]*'")
    .all() as DbRow[];
  let maxN = 0;
  for (const row of rows) {
    const match = (row.name as string).match(/^Canvas (\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxN) maxN = n;
    }
  }
  return `Canvas ${maxN + 1}`;
}

export const canvasesRoutes = new Elysia({ prefix: '/api/canvases' })
  .guard(authGuard, (app) =>
    app
      // GET /api/canvases — list all with slot counts
      .get('/', () => {
        const db = getDb();
        const rows = db
          .query(`
            SELECT c.*,
              (SELECT COUNT(*) FROM canvas_slots cs
               JOIN sessions s ON s.id = cs.session_id
               WHERE cs.canvas_id = c.id
                 AND s.status NOT IN ('exited', 'killed', 'finished')) AS slot_count
            FROM canvases c
            ORDER BY c.created_at ASC
          `)
          .all() as DbRow[];
        return rows.map((row) => ({
          ...toCanvas(row),
          slotCount: row.slot_count as number,
          totalSlots: (row.cols as number) * (row.rows as number),
        }));
      })

      // POST /api/canvases — create with sequential name + 2×2 default layout
      .post('/', ({ set }) => {
        const db = getDb();
        const id = randomUUID();
        const name = nextCanvasName();
        const now = new Date().toISOString();
        db.query(
          'INSERT INTO canvases (id, name, cols, rows, created_at, updated_at) VALUES (?, ?, 2, 2, ?, ?)',
        ).run(id, name, now, now);
        set.status = 201;
        return {
          id,
          name,
          cols: 2,
          rows: 2,
          createdAt: now,
          updatedAt: now,
        };
      })

      // GET /api/canvases/:id — canvas with all slots
      .get('/:id', ({ params, set }) => {
        const db = getDb();
        const row = db
          .query('SELECT * FROM canvases WHERE id = ?')
          .get(params.id) as DbRow | null;
        if (!row) {
          set.status = 404;
          return { error: 'Canvas not found' };
        }
        const slots = getSlotsMap(params.id);
        const totalSlots = (row.cols as number) * (row.rows as number);
        const fullSlots: Record<number, string | null> = {};
        for (let i = 0; i < totalSlots; i++) {
          fullSlots[i] = slots[i] ?? null;
        }
        return { ...toCanvas(row), slots: fullSlots };
      })

      // PUT /api/canvases/:id — update name and/or layout
      .put(
        '/:id',
        ({ params, body, set }) => {
          const db = getDb();
          const existing = db
            .query('SELECT * FROM canvases WHERE id = ?')
            .get(params.id) as DbRow | null;
          if (!existing) {
            set.status = 404;
            return { error: 'Canvas not found' };
          }

          const name = (body as { name?: string; cols?: number; rows?: number }).name ?? (existing.name as string);
          const cols = (body as { name?: string; cols?: number; rows?: number }).cols ?? (existing.cols as number);
          const rows = (body as { name?: string; cols?: number; rows?: number }).rows ?? (existing.rows as number);
          const now = new Date().toISOString();

          db.query(
            'UPDATE canvases SET name = ?, cols = ?, rows = ?, updated_at = ? WHERE id = ?',
          ).run(name, cols, rows, now, params.id);

          // Prune slots beyond new capacity
          const newCapacity = cols * rows;
          db.query(
            'DELETE FROM canvas_slots WHERE canvas_id = ? AND slot_index >= ?',
          ).run(params.id, newCapacity);

          const slots = getSlotsMap(params.id);
          const fullSlots: Record<number, string | null> = {};
          for (let i = 0; i < newCapacity; i++) {
            fullSlots[i] = slots[i] ?? null;
          }
          return {
            id: params.id,
            name,
            cols,
            rows,
            createdAt: existing.created_at as string,
            updatedAt: now,
            slots: fullSlots,
          };
        },
        {
          body: t.Optional(
            t.Object({
              name: t.Optional(t.String()),
              cols: t.Optional(t.Number()),
              rows: t.Optional(t.Number()),
            }),
          ),
        },
      )

      // DELETE /api/canvases/:id
      .delete('/:id', ({ params, set }) => {
        const db = getDb();
        const existing = db
          .query('SELECT id FROM canvases WHERE id = ?')
          .get(params.id) as DbRow | null;
        if (!existing) {
          set.status = 404;
          return { error: 'Canvas not found' };
        }
        db.query('DELETE FROM canvases WHERE id = ?').run(params.id);
        return { success: true };
      })

      // PUT /api/canvases/:id/slots/:index — assign session to slot
      .put(
        '/:id/slots/:index',
        ({ params, body, set }) => {
          const db = getDb();
          const canvas = db
            .query('SELECT cols, rows FROM canvases WHERE id = ?')
            .get(params.id) as DbRow | null;
          if (!canvas) {
            set.status = 404;
            return { error: 'Canvas not found' };
          }
          const slotIndex = parseInt(params.index, 10);
          const capacity = (canvas.cols as number) * (canvas.rows as number);
          if (Number.isNaN(slotIndex) || slotIndex < 0 || slotIndex >= capacity) {
            set.status = 400;
            return { error: 'Slot index out of range' };
          }
          const sessionId = (body as { sessionId: string }).sessionId;
          db.query(
            'INSERT INTO canvas_slots (canvas_id, slot_index, session_id) VALUES (?, ?, ?) ON CONFLICT(canvas_id, slot_index) DO UPDATE SET session_id = excluded.session_id',
          ).run(params.id, slotIndex, sessionId);
          return { success: true, slotIndex, sessionId };
        },
        {
          body: t.Object({ sessionId: t.String() }),
        },
      )

      // DELETE /api/canvases/:id/slots/:index — clear slot
      .delete('/:id/slots/:index', ({ params, set }) => {
        const db = getDb();
        const canvas = db
          .query('SELECT id FROM canvases WHERE id = ?')
          .get(params.id) as DbRow | null;
        if (!canvas) {
          set.status = 404;
          return { error: 'Canvas not found' };
        }
        const slotIndex = parseInt(params.index, 10);
        db.query(
          'DELETE FROM canvas_slots WHERE canvas_id = ? AND slot_index = ?',
        ).run(params.id, slotIndex);
        return { success: true, slotIndex };
      }),
  );
