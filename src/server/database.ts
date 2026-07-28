import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic } from "sql.js";
import config from "./config.ts";
import { type CodedError, toError } from "./errors.ts";

const require = createRequire(import.meta.url);

const dbPath = path.join(config.DATA_DIR, "gifselector.db");
const sqlJsDistDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
let dbInstancePromise: Promise<{ SQL: SqlJsStatic; db: Database }> | undefined;

export interface GifCategory {
  id: number;
  name: string;
}

export interface GifRow {
  id: number;
  slug: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface GifWithCategories extends GifRow {
  categories: GifCategory[];
}

export interface CategoryRow {
  id: number;
  name: string;
  createdAt: string;
  gifCount: number;
}

interface AddGifInput {
  slug: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

function locateSqlJsFile(file: string): string {
  return path.join(sqlJsDistDir, file);
}

async function initialiseDatabase(): Promise<{ SQL: SqlJsStatic; db: Database }> {
  const SQL = await initSqlJs({ locateFile: locateSqlJsFile });
  const existingFile = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const db = existingFile ? new SQL.Database(existingFile) : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS gifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS gif_categories (
      gif_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      PRIMARY KEY (gif_id, category_id),
      FOREIGN KEY (gif_id) REFERENCES gifs(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  if (!existingFile) {
    persistDatabase(db);
  }

  return { SQL, db };
}

function getDatabase(): Promise<{ SQL: SqlJsStatic; db: Database }> {
  if (!dbInstancePromise) {
    dbInstancePromise = initialiseDatabase();
  }
  return dbInstancePromise;
}

function persistDatabase(db: Database): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export async function addGif({
  slug,
  filename,
  originalName,
  mimeType,
  sizeBytes,
}: AddGifInput): Promise<void> {
  const { db } = await getDatabase();
  const stmt = db.prepare(`
    INSERT INTO gifs (slug, filename, original_name, mime_type, size_bytes)
    VALUES (:slug, :filename, :originalName, :mimeType, :sizeBytes)
  `);
  stmt.run({
    ":slug": slug,
    ":filename": filename,
    ":originalName": originalName,
    ":mimeType": mimeType,
    ":sizeBytes": sizeBytes,
  });
  stmt.free();
  persistDatabase(db);
}

function attachCategories(db: Database, results: GifWithCategories[]): void {
  if (results.length === 0) {
    return;
  }
  const placeholders = results.map((_, index) => `:gifId${index}`);
  const relationQuery = `
    SELECT
      gc.gif_id AS gifId,
      c.id AS categoryId,
      c.name AS categoryName
    FROM gif_categories gc
    INNER JOIN categories c ON c.id = gc.category_id
    WHERE gc.gif_id IN (${placeholders.join(", ")})
    ORDER BY c.name COLLATE NOCASE
  `;
  const relationStmt = db.prepare(relationQuery);
  const params: Record<string, number> = {};
  results.forEach((gif, index) => {
    params[`:gifId${index}`] = gif.id;
  });
  relationStmt.bind(params);
  const assignments = new Map<number, GifCategory[]>();
  while (relationStmt.step()) {
    const row = relationStmt.getAsObject() as unknown as {
      gifId: number;
      categoryId: number;
      categoryName: string;
    };
    if (!assignments.has(row.gifId)) {
      assignments.set(row.gifId, []);
    }
    assignments.get(row.gifId)?.push({ id: row.categoryId, name: row.categoryName });
  }
  relationStmt.free();
  results.forEach((gif) => {
    gif.categories = assignments.get(gif.id) || [];
  });
}

export async function listGifs(): Promise<GifWithCategories[]> {
  const { db } = await getDatabase();
  const stmt = db.prepare(`
    SELECT id, slug, filename, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt
    FROM gifs
    ORDER BY datetime(created_at) DESC
  `);
  const results: GifWithCategories[] = [];
  while (stmt.step()) {
    const record = stmt.getAsObject() as unknown as GifWithCategories;
    record.categories = [];
    results.push(record);
  }
  stmt.free();

  attachCategories(db, results);

  return results;
}

export async function findGifBySlug(slug: string): Promise<GifRow | null> {
  const { db } = await getDatabase();
  const stmt = db.prepare(`
    SELECT id, slug, filename, original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes, created_at AS createdAt
    FROM gifs
    WHERE slug = :slug
    LIMIT 1
  `);
  stmt.bind({ ":slug": slug });
  const gif = stmt.step() ? (stmt.getAsObject() as unknown as GifRow) : null;
  stmt.free();
  return gif;
}

export async function deleteGifBySlug(slug: string): Promise<boolean> {
  const { db } = await getDatabase();
  const stmt = db.prepare(`
    DELETE FROM gifs
    WHERE slug = :slug
  `);
  stmt.run({ ":slug": slug });
  stmt.free();
  const modified = db.getRowsModified();
  if (modified > 0) {
    persistDatabase(db);
    return true;
  }
  return false;
}

export async function listCategories(): Promise<CategoryRow[]> {
  const { db } = await getDatabase();
  const stmt = db.prepare(`
    SELECT
      c.id AS id,
      c.name AS name,
      c.created_at AS createdAt,
      COALESCE(g.count, 0) AS gifCount
    FROM categories c
    LEFT JOIN (
      SELECT category_id, COUNT(*) AS count
      FROM gif_categories
      GROUP BY category_id
    ) g ON g.category_id = c.id
    ORDER BY c.name COLLATE NOCASE
  `);
  const categories: CategoryRow[] = [];
  while (stmt.step()) {
    categories.push(stmt.getAsObject() as unknown as CategoryRow);
  }
  stmt.free();
  return categories;
}

export async function addCategory(name: string | undefined): Promise<CategoryRow | null> {
  const trimmedName = (typeof name === "string" ? name : "").trim();
  if (!trimmedName) {
    const error: CodedError = new Error("Category name is required.");
    error.code = "CATEGORY_NAME_REQUIRED";
    throw error;
  }
  if (trimmedName.length > config.MAX_CATEGORY_NAME_LENGTH) {
    const error: CodedError = new Error(
      `Category name must be ${config.MAX_CATEGORY_NAME_LENGTH} characters or fewer.`,
    );
    error.code = "CATEGORY_NAME_TOO_LONG";
    throw error;
  }
  const { db } = await getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT INTO categories (name)
      VALUES (:name)
    `);
    stmt.run({ ":name": trimmedName });
    stmt.free();
    const fetchStmt = db.prepare(`
      SELECT id, name, created_at AS createdAt
      FROM categories
      WHERE id = last_insert_rowid()
      LIMIT 1
    `);
    const category = fetchStmt.step() ? (fetchStmt.getAsObject() as unknown as CategoryRow) : null;
    fetchStmt.free();
    persistDatabase(db);
    if (category) {
      return { ...category, gifCount: 0 };
    }
    return null;
  } catch (error) {
    const err = toError(error);
    if (err.message.includes("UNIQUE")) {
      const duplicateError: CodedError = new Error("Category name already exists.");
      duplicateError.code = "CATEGORY_NAME_DUPLICATE";
      throw duplicateError;
    }
    throw err;
  }
}

export async function deleteCategoryById(categoryId: number): Promise<boolean> {
  const { db } = await getDatabase();
  const cleanupStmt = db.prepare(`
    DELETE FROM gif_categories
    WHERE category_id = :id
  `);
  cleanupStmt.run({ ":id": categoryId });
  cleanupStmt.free();
  const relationsModified = db.getRowsModified();
  const stmt = db.prepare(`
    DELETE FROM categories
    WHERE id = :id
  `);
  stmt.run({ ":id": categoryId });
  stmt.free();
  const modified = db.getRowsModified();
  if (modified > 0 || relationsModified > 0) {
    persistDatabase(db);
    return true;
  }
  return false;
}

export async function setGifCategories(
  slug: string,
  categoryIds: unknown,
): Promise<GifCategory[] | null> {
  const { db } = await getDatabase();
  const lookupStmt = db.prepare(`
    SELECT id
    FROM gifs
    WHERE slug = :slug
    LIMIT 1
  `);
  lookupStmt.bind({ ":slug": slug });
  const gifRow = lookupStmt.step() ? (lookupStmt.getAsObject() as unknown as { id: number }) : null;
  lookupStmt.free();
  if (!gifRow) {
    return null;
  }

  const uniqueIds = Array.from(
    new Set(
      (Array.isArray(categoryIds) ? categoryIds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );

  let validatedCategories: GifCategory[] = [];

  if (uniqueIds.length > 0) {
    const placeholders = uniqueIds.map((_, index) => `:category${index}`);
    const validateStmt = db.prepare(`
      SELECT id, name
      FROM categories
      WHERE id IN (${placeholders.join(", ")})
    `);
    const params: Record<string, number> = {};
    uniqueIds.forEach((value, index) => {
      params[`:category${index}`] = value;
    });
    validateStmt.bind(params);
    const found = new Map<number, string>();
    while (validateStmt.step()) {
      const row = validateStmt.getAsObject() as unknown as { id: number; name: string };
      found.set(row.id, row.name);
    }
    validateStmt.free();
    if (found.size !== uniqueIds.length) {
      const error: CodedError = new Error("One or more categories do not exist.");
      error.code = "CATEGORY_NOT_FOUND";
      throw error;
    }
    validatedCategories = uniqueIds.map((id) => ({
      id,
      name: found.get(id) || "",
    }));
  }

  db.run("BEGIN TRANSACTION");
  try {
    const deleteStmt = db.prepare(`
      DELETE FROM gif_categories
      WHERE gif_id = :gifId
    `);
    deleteStmt.run({ ":gifId": gifRow.id });
    deleteStmt.free();

    if (uniqueIds.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO gif_categories (gif_id, category_id)
        VALUES (:gifId, :categoryId)
      `);
      uniqueIds.forEach((categoryId) => {
        insertStmt.run({ ":gifId": gifRow.id, ":categoryId": categoryId });
      });
      insertStmt.free();
    }

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  persistDatabase(db);
  return validatedCategories;
}

export async function getGifsByCategory(categoryIdentifier: string): Promise<GifWithCategories[]> {
  const { db } = await getDatabase();

  const isNumeric = /^\d+$/.test(String(categoryIdentifier));
  const whereClause = isNumeric ? "(c.id = :val OR c.name = :val)" : "c.name = :val";

  const stmt = db.prepare(`
    SELECT g.id, g.slug, g.filename, g.original_name AS originalName, g.mime_type AS mimeType, g.size_bytes AS sizeBytes, g.created_at AS createdAt
    FROM gifs g
    JOIN gif_categories gc ON g.id = gc.gif_id
    JOIN categories c ON gc.category_id = c.id
    WHERE ${whereClause}
    ORDER BY datetime(g.created_at) DESC
  `);
  stmt.bind({ ":val": categoryIdentifier });
  const results: GifWithCategories[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as GifWithCategories;
    row.categories = [];
    results.push(row);
  }
  stmt.free();

  attachCategories(db, results);

  return results;
}
