import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initDb, getDb, closeDb, runSchema, getDbPath, getDbIntegrityResult } from './client';
import { Database } from 'bun:sqlite';

// Helper: check that a table exists in sqlite_master
function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName);
  return row !== null;
}

describe('Database Client', () => {
  afterEach(() => {
    closeDb();
  });

  describe('getDbPath / getDbIntegrityResult', () => {
    it('getDbPath returns null before initDb', () => {
      closeDb();
      expect(getDbPath()).toBeNull();
    });

    it('getDbPath returns :memory: path after in-memory init', () => {
      initDb(':memory:');
      expect(getDbPath()).toBe(':memory:');
    });

    it('getDbIntegrityResult returns not_checked for :memory: db', () => {
      initDb(':memory:');
      expect(getDbIntegrityResult()).toBe('not_checked');
    });

    it('getDbPath returns file path after file-based init', () => {
      const { mkdtempSync, rmSync } = require('node:fs');
      const { join } = require('node:path');
      const tmpDir = mkdtempSync('/tmp/opencode-test-path-');
      try {
        const dbPath = join(tmpDir, 'path-test.db');
        initDb(dbPath);
        expect(getDbPath()).toBe(dbPath);
      } finally {
        closeDb();
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('getDbIntegrityResult returns ok for a healthy file-based db', () => {
      const { mkdtempSync, rmSync } = require('node:fs');
      const { join } = require('node:path');
      const tmpDir = mkdtempSync('/tmp/opencode-test-integrity-');
      try {
        const dbPath = join(tmpDir, 'integrity-test.db');
        initDb(dbPath);
        expect(getDbIntegrityResult()).toBe('ok');
      } finally {
        closeDb();
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('in-memory database (:memory:)', () => {
    it('connect successfully via initDb', () => {
      const db = initDb(':memory:');
      expect(db).toBeInstanceOf(Database);
    });

    it('getDb() returns the same singleton after initDb', () => {
      const db = initDb(':memory:');
      expect(getDb()).toBe(db);
    });

    it('getDb() throws if database was never initialized', () => {
      // close any previously open db
      closeDb();
      expect(() => getDb()).toThrow(/not initialized/i);
    });

    it('creates the _migrations meta-table on init', () => {
      const db = initDb(':memory:');
      expect(tableExists(db, '_migrations')).toBe(true);
    });

    it('runs schema idempotently — runSchema twice does not throw', () => {
      const db = initDb(':memory:');
      // First call is done by initDb, call again explicitly
      expect(() => runSchema(db)).not.toThrow();
      // _migrations table should still exist
      expect(tableExists(db, '_migrations')).toBe(true);
    });

    it('foreign keys are enforced after init', () => {
      const db = initDb(':memory:');
      const row = db.query('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(row.foreign_keys).toBe(1);
    });
  });

  describe('file-based database', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync('/tmp/opencode-test-');
    });

    afterEach(() => {
      closeDb();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates the database file on disk', () => {
      const dbPath = join(tmpDir, 'test.db');
      initDb(dbPath);
      expect(existsSync(dbPath)).toBe(true);
    });

    it('WAL mode is enabled on file-based databases', () => {
      const dbPath = join(tmpDir, 'wal-test.db');
      const db = initDb(dbPath);
      const row = db.query('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode).toBe('wal');
    });

    it('creates parent directories automatically', () => {
      const dbPath = join(tmpDir, 'nested', 'dir', 'test.db');
      initDb(dbPath);
      expect(existsSync(dbPath)).toBe(true);
    });

    it('re-initializing closes the old connection and opens a new one', () => {
      const dbPath = join(tmpDir, 'reinit.db');
      const db1 = initDb(dbPath);
      // Create a test table to verify we can re-connect to the same file
      db1.exec('CREATE TABLE IF NOT EXISTS _test (id INTEGER)');
      db1.exec('INSERT INTO _test VALUES (42)');

      // Re-init
      const db2 = initDb(dbPath);
      const row = db2.query('SELECT id FROM _test').get() as { id: number };
      expect(row.id).toBe(42);
    });

    it('schema runs idempotently on file DB (init twice does not break)', () => {
      const dbPath = join(tmpDir, 'idempotent.db');

      // First init
      initDb(dbPath);
      expect(tableExists(getDb(), '_migrations')).toBe(true);

      // Second init on the same file
      initDb(dbPath);
      expect(tableExists(getDb(), '_migrations')).toBe(true);
    });
  });

  describe('closeDb', () => {
    it('closeDb is safe to call multiple times', () => {
      initDb(':memory:');
      closeDb();
      expect(() => closeDb()).not.toThrow();
    });

    it('after closeDb, getDb() throws', () => {
      initDb(':memory:');
      closeDb();
      expect(() => getDb()).toThrow(/not initialized/i);
    });
  });
});
