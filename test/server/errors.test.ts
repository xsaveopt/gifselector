import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toError } from "../../src/server/errors.ts";

describe("toError", () => {
  it("returns the same error instance it was given", () => {
    const original = new Error("boom");
    assert.equal(toError(original), original);
  });

  it("keeps a subclass and its code intact", () => {
    const original = new TypeError("bad type") as TypeError & { code?: string };
    original.code = "CATEGORY_NOT_FOUND";
    const converted = toError(original);
    assert.equal(converted.code, "CATEGORY_NOT_FOUND");
    assert.ok(converted instanceof TypeError);
  });

  it("wraps a thrown string", () => {
    const converted = toError("plain failure");
    assert.ok(converted instanceof Error);
    assert.equal(converted.message, "plain failure");
    assert.equal(converted.code, undefined);
  });

  it("wraps values that are not errors at all", () => {
    assert.equal(toError(undefined).message, "undefined");
    assert.equal(toError(null).message, "null");
    assert.equal(toError(404).message, "404");
    assert.equal(toError({ toString: () => "weird" }).message, "weird");
  });
});
