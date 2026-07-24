import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GifModal from "../../src/client/components/GifModal";
import type { Category, GifItem } from "../../src/client/types";

const gif: GifItem = {
  id: 1,
  slug: "abc",
  originalName: "cat.gif",
  shareUrl: "http://x/share/abc.gif",
  createdAt: "2024-01-01T00:00:00Z",
  sizeBytes: 2048,
  mimeType: "image/gif",
  categories: [],
};

const categories: Category[] = [{ id: 1, name: "Memes", createdAt: "2024", gifCount: 0 }];

function renderModal(overrides: Partial<Parameters<typeof GifModal>[0]> = {}) {
  return render(
    <GifModal
      gif={gif}
      categories={categories}
      readOnly={false}
      isUpdatingCategories={false}
      onClose={vi.fn()}
      onCopy={vi.fn()}
      onDelete={vi.fn()}
      onToggleCategory={vi.fn()}
      {...overrides}
    />,
  );
}

describe("GifModal", () => {
  it("shows the share link and metadata", () => {
    renderModal();
    const input = screen.getByLabelText("Share link") as HTMLInputElement;
    expect(input.value).toBe("http://x/share/abc.gif");
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it("toggles a category on", async () => {
    const onToggleCategory = vi.fn();
    renderModal({ onToggleCategory });
    await userEvent.click(screen.getByRole("button", { name: "Memes" }));
    expect(onToggleCategory).toHaveBeenCalledWith(gif, 1, true);
  });

  it("deletes from the footer", async () => {
    const onDelete = vi.fn();
    renderModal({ onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("abc", "cat.gif");
  });

  it("hides editing controls in read-only mode", () => {
    renderModal({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Memes" })).toBeNull();
  });
});
