import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/api", () => ({
  getSession: vi.fn(async () => ({ authenticated: false })),
  fetchGifs: vi.fn(async () => ({ gifs: [], total: 0 })),
  fetchCategories: vi.fn(async () => ({ categories: [] })),
  fetchPublicGifs: vi.fn(async () => ({ gifs: [] })),
  login: vi.fn(async () => ({ success: true })),
  logout: vi.fn(async () => ({ success: true })),
  uploadGif: vi.fn(),
  deleteGif: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  updateGifCategories: vi.fn(),
  importGifs: vi.fn(),
  buildShareLink: (slug: string) => `/share/${slug}`,
}));

const { default: App } = await import("../src/App");

describe("App", () => {
  it("shows the login form when the session is unauthenticated", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });
  });
});
