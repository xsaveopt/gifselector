import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import GifCard from "../../src/client/components/GifCard";
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

function renderCard(overrides: Partial<Parameters<typeof GifCard>[0]> = {}) {
  return render(
    <GifCard
      gif={gif}
      viewMode="grid"
      readOnly={false}
      onOpen={vi.fn()}
      onCopy={vi.fn()}
      onDelete={vi.fn()}
      isDeleting={false}
      {...overrides}
    />,
  );
}

describe("GifCard", () => {
  it("renders the share image and the file name", () => {
    renderCard();
    const img = screen.getByAltText("cat.gif") as HTMLImageElement;
    expect(img.src).toBe("http://x/share/abc.gif");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(screen.getByText("cat.gif")).toBeInTheDocument();
  });

  it("labels the media kind from the mime type", () => {
    const { unmount } = renderCard();
    expect(screen.getByText("GIF")).toBeInTheDocument();
    unmount();

    const webp = render(
      <GifCard
        gif={{ ...gif, mimeType: "image/webp" }}
        viewMode="grid"
        readOnly={false}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        isDeleting={false}
      />,
    );
    expect(screen.getByText("WebP")).toBeInTheDocument();
    webp.unmount();

    render(
      <GifCard
        gif={{ ...gif, mimeType: undefined }}
        viewMode="grid"
        readOnly={false}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        isDeleting={false}
      />,
    );
    expect(screen.getByText("Image")).toBeInTheDocument();
  });

  it("formats the size in bytes, kilobytes, and megabytes", () => {
    const { unmount } = renderCard({ gif: { ...gif, sizeBytes: 512, categories: [] } });
    expect(screen.getByText("512 B")).toBeInTheDocument();
    unmount();

    const kb = render(
      <GifCard
        gif={{ ...gif, sizeBytes: 2048, categories: [] }}
        viewMode="grid"
        readOnly={false}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        isDeleting={false}
      />,
    );
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    kb.unmount();

    render(
      <GifCard
        gif={{ ...gif, sizeBytes: 3 * 1024 * 1024, categories: [] }}
        viewMode="grid"
        readOnly={false}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        isDeleting={false}
      />,
    );
    expect(screen.getByText("3.00 MB")).toBeInTheDocument();
  });

  it("appends the category names to the size line", () => {
    renderCard({
      gif: {
        ...gif,
        categories: [
          { id: 1, name: "Memes" },
          { id: 2, name: "Cats" },
        ],
      },
    });
    expect(screen.getByText("2.0 KB · Memes, Cats")).toBeInTheDocument();
  });

  it("carries the view mode into the card class", () => {
    const { container } = renderCard({ viewMode: "list" });
    expect(container.querySelector(".card")).toHaveClass("card--list");
  });

  it("opens, copies, and deletes", async () => {
    const onOpen = vi.fn();
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    renderCard({ onOpen, onCopy, onDelete });

    await userEvent.click(screen.getByRole("button", { name: "Open cat.gif" }));
    expect(onOpen).toHaveBeenCalledWith(gif);

    await userEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    expect(onCopy).toHaveBeenCalledWith(gif);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("abc", "cat.gif");
  });

  it("disables delete while a deletion is running", () => {
    renderCard({ isDeleting: true });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("hides delete in read-only mode and when no handler is given", () => {
    const { unmount } = renderCard({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    unmount();

    render(
      <GifCard
        gif={gif}
        viewMode="grid"
        readOnly={false}
        onOpen={vi.fn()}
        onCopy={vi.fn()}
        isDeleting={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy share link" })).toBeInTheDocument();
  });
});
