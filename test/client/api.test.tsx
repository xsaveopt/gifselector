import { describe, expect, it, vi } from "vitest";
import * as api from "../../src/client/api";

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

describe("api client endpoints", () => {
  it.each([
    ["logout", () => api.logout(), "/api/logout", "POST", "include"],
    ["fetchGifs", () => api.fetchGifs(), "/api/gifs", undefined, "include"],
    ["fetchPublicGifs", () => api.fetchPublicGifs(), "/api/public/gifs", undefined, undefined],
    ["fetchCategories", () => api.fetchCategories(), "/api/categories", undefined, "include"],
    ["deleteCategory", () => api.deleteCategory(12), "/api/categories/12", "DELETE", "include"],
  ])("%s calls %s", async (_name, call, path, method, credentials) => {
    const fetchMock = mockFetch({ json: {} });
    await call();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(path);
    expect(options?.method).toBe(method);
    expect(options?.credentials).toBe(credentials);
  });

  it("importGifs posts the url list as json", async () => {
    const fetchMock = mockFetch({ json: { results: [] } });
    await api.importGifs(["https://tenor.com/a", "https://giphy.com/b"]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/import");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(options?.body as string)).toEqual({
      urls: ["https://tenor.com/a", "https://giphy.com/b"],
    });
  });

  it("builds a share link from the page origin", () => {
    expect(api.buildShareLink("abc")).toBe(`${window.location.origin}/share/abc`);
  });
});

describe("api client errors", () => {
  it("falls back to the status text when the error body has no message", async () => {
    mockFetch({ ok: false, status: 500, statusText: "Internal Server Error", json: {} });
    await expect(api.fetchGifs()).rejects.toThrow("Internal Server Error");
  });

  it("falls back to the status text when the error body is not json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 502,
            statusText: "Bad Gateway",
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response,
      ),
    );
    await expect(api.fetchGifs()).rejects.toThrow("Bad Gateway");
  });
});

describe("api client base path", () => {
  it("prefixes every call with window.__BASE__ minus its trailing slash", async () => {
    vi.resetModules();
    window.__BASE__ = "/gifs/";
    try {
      const scoped = await import("../../src/client/api");
      const fetchMock = mockFetch({ json: {} });
      await scoped.getSession();
      expect(String(fetchMock.mock.calls[0][0])).toBe("/gifs/api/session");
      expect(scoped.buildShareLink("abc")).toBe(`${window.location.origin}/gifs/share/abc`);
    } finally {
      delete window.__BASE__;
    }
  });
});
