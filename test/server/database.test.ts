import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tempEnv } from "./helpers.ts";

tempEnv();
const db = await import("../../src/server/database.ts");

describe("database", () => {
  it("creates, lists and counts categories", async () => {
    const created = await db.addCategory("Reactions");
    assert.ok(created);
    assert.equal(created?.name, "Reactions");

    const list = await db.listCategories();
    assert.equal(list.length, 1);
    assert.equal(list[0].gifCount, 0);
  });

  it("rejects duplicate category names", async () => {
    await db.addCategory("Dupe");
    await assert.rejects(() => db.addCategory("Dupe"), /already exists/);
  });

  it("requires a non-empty category name", async () => {
    await assert.rejects(() => db.addCategory("   "), /required/);
  });

  it("stores gifs and assigns them to categories", async () => {
    await db.addGif({
      slug: "abc123",
      filename: "a.gif",
      originalName: "a.gif",
      mimeType: "image/gif",
      sizeBytes: 100,
    });
    const cat = await db.addCategory("Memes");
    assert.ok(cat);

    const assigned = await db.setGifCategories("abc123", [cat.id]);
    assert.equal(assigned?.length, 1);
    assert.equal(assigned?.[0].name, "Memes");

    const gifs = await db.listGifs();
    const target = gifs.find((g) => g.slug === "abc123");
    assert.ok(target);
    assert.equal(target?.categories[0]?.name, "Memes");

    const byCategory = await db.getGifsByCategory("Memes");
    assert.equal(byCategory.length, 1);
    assert.equal(byCategory[0].slug, "abc123");
  });

  it("looks up and deletes gifs by slug", async () => {
    await db.addGif({
      slug: "todelete",
      filename: "d.gif",
      originalName: "d.gif",
      mimeType: "image/gif",
      sizeBytes: 10,
    });
    assert.ok(await db.findGifBySlug("todelete"));
    assert.equal(await db.deleteGifBySlug("todelete"), true);
    assert.equal(await db.findGifBySlug("todelete"), null);
    assert.equal(await db.deleteGifBySlug("todelete"), false);
  });

  it("refuses to assign categories that do not exist", async () => {
    await db.addGif({
      slug: "gif2",
      filename: "g.gif",
      originalName: "g.gif",
      mimeType: "image/gif",
      sizeBytes: 5,
    });
    await assert.rejects(() => db.setGifCategories("gif2", [99999]), /do not exist/);
  });
});

async function seed(slug: string): Promise<void> {
  await db.addGif({
    slug,
    filename: `${slug}.gif`,
    originalName: `${slug}.gif`,
    mimeType: "image/gif",
    sizeBytes: 1,
  });
}

describe("database categories", () => {
  it("finds gifs by numeric category id as well as by name", async () => {
    await seed("by-id");
    const cat = await db.addCategory("Numeric");
    assert.ok(cat);
    await db.setGifCategories("by-id", [cat.id]);

    const byId = await db.getGifsByCategory(String(cat.id));
    assert.deepEqual(
      byId.map((gif) => gif.slug),
      ["by-id"],
    );
    assert.deepEqual(byId[0].categories, [{ id: cat.id, name: "Numeric" }]);

    const byName = await db.getGifsByCategory("Numeric");
    assert.deepEqual(
      byName.map((gif) => gif.slug),
      ["by-id"],
    );
  });

  it("matches a category named with digits by its name", async () => {
    await seed("digits-name");
    const cat = await db.addCategory("2024");
    assert.ok(cat);
    await db.setGifCategories("digits-name", [cat.id]);

    const found = await db.getGifsByCategory("2024");
    assert.deepEqual(
      found.map((gif) => gif.slug),
      ["digits-name"],
    );
  });

  it("drops the assignment and the count when a gif is deleted", async () => {
    await seed("cascade-gif");
    const cat = await db.addCategory("CascadeGif");
    assert.ok(cat);
    await db.setGifCategories("cascade-gif", [cat.id]);
    const counted = (await db.listCategories()).find((row) => row.id === cat.id);
    assert.equal(counted?.gifCount, 1);

    assert.equal(await db.deleteGifBySlug("cascade-gif"), true);

    const after = (await db.listCategories()).find((row) => row.id === cat.id);
    assert.equal(after?.gifCount, 0);
    assert.deepEqual(await db.getGifsByCategory("CascadeGif"), []);
  });

  it("detaches gifs when their category is deleted", async () => {
    await seed("cascade-cat");
    const keep = await db.addCategory("Kept");
    const drop = await db.addCategory("Dropped");
    assert.ok(keep && drop);
    await db.setGifCategories("cascade-cat", [keep.id, drop.id]);

    assert.equal(await db.deleteCategoryById(drop.id), true);

    const gif = (await db.listGifs()).find((row) => row.slug === "cascade-cat");
    assert.deepEqual(gif?.categories, [{ id: keep.id, name: "Kept" }]);
    assert.equal(await db.deleteCategoryById(drop.id), false);
  });

  it("reports a missing category as not deleted", async () => {
    assert.equal(await db.deleteCategoryById(424242), false);
  });

  it("rejects a category name over the length cap", async () => {
    await assert.rejects(
      () => db.addCategory("z".repeat(101)),
      (error: Error & { code?: string }) => error.code === "CATEGORY_NAME_TOO_LONG",
    );
  });
});

describe("setGifCategories", () => {
  it("returns null for an unknown slug", async () => {
    assert.equal(await db.setGifCategories("no-such-gif", []), null);
  });

  it("deduplicates ids and ignores values that are not positive integers", async () => {
    await seed("dedupe");
    const cat = await db.addCategory("Deduped");
    assert.ok(cat);

    const assigned = await db.setGifCategories("dedupe", [
      cat.id,
      String(cat.id),
      cat.id,
      -1,
      0,
      1.5,
      "abc",
      null,
    ]);
    assert.deepEqual(assigned, [{ id: cat.id, name: "Deduped" }]);

    const gif = (await db.listGifs()).find((row) => row.slug === "dedupe");
    assert.deepEqual(gif?.categories, [{ id: cat.id, name: "Deduped" }]);
  });

  it("replaces the previous assignment instead of adding to it", async () => {
    await seed("replace");
    const first = await db.addCategory("First");
    const second = await db.addCategory("Second");
    assert.ok(first && second);

    await db.setGifCategories("replace", [first.id]);
    await db.setGifCategories("replace", [second.id]);

    const gif = (await db.listGifs()).find((row) => row.slug === "replace");
    assert.deepEqual(gif?.categories, [{ id: second.id, name: "Second" }]);
  });

  it("clears every assignment for an empty list or a non-array", async () => {
    await seed("clear");
    const cat = await db.addCategory("Cleared");
    assert.ok(cat);

    await db.setGifCategories("clear", [cat.id]);
    assert.deepEqual(await db.setGifCategories("clear", []), []);
    let gif = (await db.listGifs()).find((row) => row.slug === "clear");
    assert.deepEqual(gif?.categories, []);

    await db.setGifCategories("clear", [cat.id]);
    assert.deepEqual(await db.setGifCategories("clear", "not-a-list"), []);
    gif = (await db.listGifs()).find((row) => row.slug === "clear");
    assert.deepEqual(gif?.categories, []);
  });

  it("keeps the old assignment when one of the new ids does not exist", async () => {
    await seed("atomic");
    const cat = await db.addCategory("Atomic");
    assert.ok(cat);
    await db.setGifCategories("atomic", [cat.id]);

    await assert.rejects(() => db.setGifCategories("atomic", [cat.id, 777777]), /do not exist/);

    const gif = (await db.listGifs()).find((row) => row.slug === "atomic");
    assert.deepEqual(gif?.categories, [{ id: cat.id, name: "Atomic" }]);
  });
});

describe("database persistence", () => {
  it("reloads gifs, categories and assignments from the file on disk", async () => {
    await seed("persisted");
    const cat = await db.addCategory("Persisted");
    assert.ok(cat);
    await db.setGifCategories("persisted", [cat.id]);

    const specifier = "../../src/server/database.ts?reload";
    const reloaded = (await import(specifier)) as typeof db;

    const gif = await reloaded.findGifBySlug("persisted");
    assert.equal(gif?.filename, "persisted.gif");
    const listed = (await reloaded.listGifs()).find((row) => row.slug === "persisted");
    assert.deepEqual(listed?.categories, [{ id: cat.id, name: "Persisted" }]);
    const names = (await reloaded.listCategories()).map((row) => row.name);
    assert.ok(names.includes("Persisted"));
  });

  it("keeps foreign keys enforced after a reload", async () => {
    await seed("reload-cascade");
    const cat = await db.addCategory("ReloadCascade");
    assert.ok(cat);
    await db.setGifCategories("reload-cascade", [cat.id]);

    const specifier = "../../src/server/database.ts?reload-cascade";
    const reloaded = (await import(specifier)) as typeof db;
    assert.equal(await reloaded.deleteGifBySlug("reload-cascade"), true);
    const counted = (await reloaded.listCategories()).find((row) => row.id === cat.id);
    assert.equal(counted?.gifCount, 0);
  });
});
