import { describe, expect, it, vi } from "vitest";
import * as api from "../src/api";

interface FakeResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
}

function mockFetch(response: FakeResponse) {
  const fn = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        json: async () => response.json,
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  it("getSession calls the session endpoint with credentials", async () => {
    const fetchMock = mockFetch({ json: { authenticated: false } });
    const result = await api.getSession();
    expect(result).toEqual({ authenticated: false });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/session$/);
    expect(options).toMatchObject({ credentials: "include" });
  });

  it("login posts JSON credentials", async () => {
    const fetchMock = mockFetch({ json: { success: true } });
    await api.login("admin", "pw");
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/login$/);
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual({ username: "admin", password: "pw" });
  });

  it("throws the server-provided error message on non-ok responses", async () => {
    mockFetch({ ok: false, status: 401, json: { error: "Invalid credentials." } });
    await expect(api.login("admin", "bad")).rejects.toThrow("Invalid credentials.");
  });

  it("createCategory posts the category name", async () => {
    const fetchMock = mockFetch({ json: { category: { id: 1 } } });
    await api.createCategory("Memes");
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/categories$/);
    expect(JSON.parse(options?.body as string)).toEqual({ name: "Memes" });
  });

  it("deleteGif issues a DELETE to the url-encoded slug endpoint", async () => {
    const fetchMock = mockFetch({ json: { success: true } });
    await api.deleteGif("abc/def");
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/gifs\/abc%2Fdef$/);
    expect(options?.method).toBe("DELETE");
  });

  it("updateGifCategories PUTs the category ids", async () => {
    const fetchMock = mockFetch({ json: { categories: [] } });
    await api.updateGifCategories("slug1", [1, 2]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/gifs\/slug1\/categories$/);
    expect(options?.method).toBe("PUT");
    expect(JSON.parse(options?.body as string)).toEqual({ categoryIds: [1, 2] });
  });

  it("uploadGif sends multipart form data", async () => {
    const fetchMock = mockFetch({ json: { slug: "x" } });
    const file = new File(["gif-bytes"], "cat.gif", { type: "image/gif" });
    await api.uploadGif(file);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/upload$/);
    expect(options?.body).toBeInstanceOf(FormData);
  });
});
