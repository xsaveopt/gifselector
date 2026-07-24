import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Gallery from "../../src/client/components/Gallery";

const gif = {
  id: 1,
  slug: "abc",
  originalName: "cat.gif",
  shareUrl: "http://x/share/abc.gif",
  createdAt: "2024-01-01T00:00:00Z",
  sizeBytes: 2048,
  categories: [{ id: 1, name: "Memes" }],
};

describe("Gallery", () => {
  it("renders an empty state when there are no gifs", () => {
    render(<Gallery gifs={[]} categories={[]} viewMode="grid" />);
    expect(screen.getByText(/No GIF or WebP files uploaded yet/)).toBeInTheDocument();
  });

  it("renders a gif card with its share image and metadata", () => {
    render(<Gallery gifs={[gif]} categories={[{ id: 1, name: "Memes" }]} viewMode="grid" />);
    const img = screen.getByAltText("cat.gif") as HTMLImageElement;
    expect(img.src).toBe("http://x/share/abc.gif");
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
  });

  it("toggles a category assignment", async () => {
    const onUpdate = vi.fn(async () => true);
    render(
      <Gallery
        gifs={[{ ...gif, categories: [] }]}
        categories={[{ id: 1, name: "Memes" }]}
        viewMode="grid"
        onUpdateCategories={onUpdate}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox"));
    expect(onUpdate).toHaveBeenCalledWith("abc", [1]);
  });

  it("deletes a gif", async () => {
    const onDelete = vi.fn(async () => {});
    render(<Gallery gifs={[gif]} categories={[]} viewMode="grid" onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("abc", "cat.gif");
  });
});
