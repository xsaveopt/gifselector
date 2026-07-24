import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Gallery from "../../src/client/components/Gallery";
import type { GifItem } from "../../src/client/types";

const gif: GifItem = {
  id: 1,
  slug: "abc",
  originalName: "cat.gif",
  shareUrl: "http://x/share/abc.gif",
  createdAt: "2024-01-01T00:00:00Z",
  sizeBytes: 2048,
  mimeType: "image/gif",
  categories: [{ id: 1, name: "Memes" }],
};

const noop = () => {};

describe("Gallery", () => {
  it("renders an empty state with a custom message", () => {
    render(
      <Gallery gifs={[]} viewMode="grid" onOpen={noop} onCopy={noop} emptyMessage="Nothing" />,
    );
    expect(screen.getByText("Nothing")).toBeInTheDocument();
  });

  it("renders a card with its share image and metadata", () => {
    render(<Gallery gifs={[gif]} viewMode="grid" onOpen={noop} onCopy={noop} />);
    const img = screen.getByAltText("cat.gif") as HTMLImageElement;
    expect(img.src).toBe("http://x/share/abc.gif");
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/Memes/)).toBeInTheDocument();
  });

  it("opens a gif when its media is clicked", async () => {
    const onOpen = vi.fn();
    render(<Gallery gifs={[gif]} viewMode="grid" onOpen={onOpen} onCopy={noop} />);
    await userEvent.click(screen.getByRole("button", { name: "Open cat.gif" }));
    expect(onOpen).toHaveBeenCalledWith(gif);
  });

  it("copies a share link", async () => {
    const onCopy = vi.fn();
    render(<Gallery gifs={[gif]} viewMode="grid" onOpen={noop} onCopy={onCopy} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    expect(onCopy).toHaveBeenCalledWith(gif);
  });

  it("deletes a gif", async () => {
    const onDelete = vi.fn();
    render(
      <Gallery gifs={[gif]} viewMode="grid" onOpen={noop} onCopy={noop} onDelete={onDelete} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("abc", "cat.gif");
  });

  it("hides delete and category actions in read-only mode", () => {
    render(<Gallery gifs={[gif]} viewMode="grid" readOnly onOpen={noop} onCopy={noop} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
