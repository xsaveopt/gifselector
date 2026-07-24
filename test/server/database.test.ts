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
