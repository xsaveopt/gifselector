import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, GifItem } from "../../src/client/types";

vi.mock("../../src/client/api", () => ({
  getSession: vi.fn(),
  fetchGifs: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPublicGifs: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  uploadGif: vi.fn(),
  deleteGif: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  updateGifCategories: vi.fn(),
  importGifs: vi.fn(),
  buildShareLink: (slug: string) => `/share/${slug}`,
}));

const api = vi.mocked(await import("../../src/client/api"));
const { default: App } = await import("../../src/client/App");

const memes: Category = { id: 3, name: "Memes", createdAt: "2024", gifCount: 1 };
const reactions: Category = { id: 4, name: "Reactions", createdAt: "2024", gifCount: 0 };

function gif(slug: string, originalName: string, categories: GifItem["categories"] = []): GifItem {
  return {
    id: slug.length,
    slug,
    originalName,
    shareUrl: `http://x/share/${slug}.gif`,
    createdAt: "2024-01-01T00:00:00Z",
    sizeBytes: 2048,
    mimeType: "image/gif",
    categories,
  };
}

const catGif = gif("cat", "Cat.gif", [{ id: 3, name: "Memes" }]);
const dogGif = gif("dog", "dog.webp");

function signedInWith(gifs: GifItem[], categories: Category[] = [memes, reactions]) {
  api.getSession.mockResolvedValue({ authenticated: true, username: "admin" });
  api.fetchGifs.mockResolvedValue({ gifs, total: gifs.length });
  api.fetchCategories.mockResolvedValue({ categories });
}

async function renderSignedIn(gifs: GifItem[] = [catGif, dogGif]) {
  signedInWith(gifs);
  const view = render(<App />);
  await screen.findByRole("button", { name: /Upload/ });
  return view;
}

function cardNames(): string[] {
  return Array.from(document.querySelectorAll(".card-name")).map((el) => el.textContent ?? "");
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function toastMessages(): string[] {
  return screen.queryAllByRole("status").map((el) => el.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
  delete window.__BASE__;
  delete window.__DEFAULT_CATEGORY__;
  api.getSession.mockResolvedValue({ authenticated: false });
  api.fetchGifs.mockResolvedValue({ gifs: [], total: 0 });
  api.fetchCategories.mockResolvedValue({ categories: [] });
  api.fetchPublicGifs.mockResolvedValue({ gifs: [] });
  api.login.mockResolvedValue({ success: true });
  api.logout.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App session", () => {
  it("shows the login form when the session is unauthenticated", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  it("shows the login form when the session request fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.getSession.mockRejectedValue(new Error("offline"));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
  });

  it("signs in and loads the gallery", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });
    signedInWith([catGif]);

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Cat.gif")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith("admin", "pw");
    expect(api.getSession).toHaveBeenCalledTimes(2);
  });

  it("shows the login error and stays on the form", async () => {
    api.login.mockRejectedValue(new Error("Invalid credentials."));
    render(<App />);
    await screen.findByRole("button", { name: "Sign in" });

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Password"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid credentials.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("returns to the login form on logout even when the request fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    api.logout.mockRejectedValue(new Error("offline"));
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});

describe("App gallery filters", () => {
  it("lists every gif with the totals", async () => {
    await renderSignedIn();
    expect(cardNames()).toEqual(["Cat.gif", "dog.webp"]);
    expect(screen.getByText("2 of 2")).toBeInTheDocument();
  });

  it("says there are no gifs yet on an empty collection", async () => {
    await renderSignedIn([]);
    expect(screen.getByText("No GIFs yet.")).toBeInTheDocument();
  });

  it("filters by name ignoring case and surrounding spaces", async () => {
    await renderSignedIn();
    await userEvent.type(screen.getByLabelText("Search gifs"), "  CAT ");
    expect(cardNames()).toEqual(["Cat.gif"]);

    await userEvent.clear(screen.getByLabelText("Search gifs"));
    await userEvent.type(screen.getByLabelText("Search gifs"), "zebra");
    expect(cardNames()).toEqual([]);
    expect(screen.getByText("No matching items.")).toBeInTheDocument();
  });

  it("filters by category and mirrors the choice in the url", async () => {
    await renderSignedIn();

    await userEvent.click(screen.getByRole("tab", { name: /Memes/ }));
    expect(cardNames()).toEqual(["Cat.gif"]);
    expect(window.location.search).toBe("?category=3");

    await userEvent.click(screen.getByRole("tab", { name: /Uncategorized/ }));
    expect(cardNames()).toEqual(["dog.webp"]);
    expect(window.location.search).toBe("?category=-1");

    await userEvent.click(screen.getByRole("tab", { name: /All/ }));
    expect(cardNames()).toEqual(["Cat.gif", "dog.webp"]);
    expect(window.location.search).toBe("");
  });

  it("starts on the category named in the url", async () => {
    window.history.replaceState(null, "", "/?category=3");
    await renderSignedIn();
    expect(screen.getByRole("tab", { name: /Memes/ })).toHaveAttribute("aria-selected", "true");
    expect(cardNames()).toEqual(["Cat.gif"]);
  });

  it("falls back to the server default category", async () => {
    window.__DEFAULT_CATEGORY__ = 4;
    await renderSignedIn();
    expect(screen.getByRole("tab", { name: /Reactions/ })).toHaveAttribute("aria-selected", "true");
    expect(window.location.search).toBe("?category=4");
    expect(screen.getByText("No matching items.")).toBeInTheDocument();
  });
});

describe("App uploads", () => {
  it("uploads supported files, skips the rest and reloads", async () => {
    await renderSignedIn();
    api.uploadGif.mockResolvedValue({ slug: "new" });
    const good = new File(["a"], "a.gif", { type: "image/gif" });
    const webp = new File(["b"], "b.webp", { type: "image/webp" });
    const bad = new File(["c"], "c.png", { type: "image/png" });

    fireEvent.change(fileInput(), { target: { files: [good, webp, bad] } });

    await waitFor(() => {
      expect(toastMessages()).toEqual(["Uploaded 2 files.", "Skipped 1 unsupported file."]);
    });
    expect(api.uploadGif.mock.calls.map(([file]) => file)).toEqual([good, webp]);
    expect(api.fetchGifs).toHaveBeenCalledTimes(2);
    expect(fileInput().value).toBe("");
  });

  it("reports a failed upload", async () => {
    await renderSignedIn();
    api.uploadGif.mockRejectedValue(new Error("File too large"));

    fireEvent.change(fileInput(), {
      target: { files: [new File(["a"], "a.gif", { type: "image/gif" })] },
    });

    await waitFor(() => expect(toastMessages()).toEqual(["File too large"]));
    expect(screen.queryByText("Uploading…")).toBeNull();
  });

  it("shows the drop overlay while files are dragged over and uploads on drop", async () => {
    const { container } = await renderSignedIn();
    api.uploadGif.mockResolvedValue({ slug: "new" });
    const app = container.querySelector(".app") as HTMLElement;
    const file = new File(["a"], "a.gif", { type: "image/gif" });

    fireEvent.dragEnter(app, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragEnter(app, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Drop GIF or WebP files to upload")).toBeInTheDocument();

    fireEvent.dragLeave(app, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("Drop GIF or WebP files to upload")).toBeInTheDocument();
    fireEvent.dragLeave(app, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Drop GIF or WebP files to upload")).toBeNull();

    fireEvent.dragEnter(app, { dataTransfer: { types: ["Files"] } });
    fireEvent.drop(app, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.queryByText("Drop GIF or WebP files to upload")).toBeNull();
    await waitFor(() => expect(toastMessages()).toEqual(["Uploaded 1 file."]));
    expect(api.uploadGif).toHaveBeenCalledWith(file);
  });

  it("ignores drags that carry no files", async () => {
    const { container } = await renderSignedIn();
    const app = container.querySelector(".app") as HTMLElement;
    fireEvent.dragEnter(app, { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByText("Drop GIF or WebP files to upload")).toBeNull();
  });
});

describe("App gif actions", () => {
  it("does nothing when the delete is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderSignedIn();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(window.confirm).toHaveBeenCalledWith('Delete "Cat.gif"? This cannot be undone.');
    expect(api.deleteGif).not.toHaveBeenCalled();
  });

  it("deletes a confirmed gif from the open modal and closes it", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteGif.mockResolvedValue({ success: true });
    await renderSignedIn();

    await userEvent.click(screen.getByRole("button", { name: "Open Cat.gif" }));
    const dialog = screen.getByRole("dialog", { name: "Cat.gif" });
    api.fetchGifs.mockResolvedValue({ gifs: [dogGif], total: 1 });
    await userEvent.click(within(dialog).getByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(toastMessages()).toEqual(["Deleted."]));
    expect(api.deleteGif).toHaveBeenCalledWith("cat");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cardNames()).toEqual(["dog.webp"]);
  });

  it("reports a failed delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteGif.mockRejectedValue(new Error("GIF not found."));
    await renderSignedIn();
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[1]);
    await waitFor(() => expect(toastMessages()).toEqual(["GIF not found."]));
  });

  it("copies the share link to the clipboard", async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    await user.click(screen.getAllByRole("button", { name: "Copy share link" })[0]);
    await waitFor(() => expect(toastMessages()).toEqual(["Share link copied."]));
    expect(await navigator.clipboard.readText()).toBe("http://x/share/cat.gif");
  });

  it("reports when the clipboard refuses the link", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await renderSignedIn();
    await user.click(screen.getAllByRole("button", { name: "Copy share link" })[0]);
    await waitFor(() => expect(toastMessages()).toEqual(["Could not copy the link."]));
  });

  it("toggles a category from the modal and applies the server result", async () => {
    await renderSignedIn();
    api.updateGifCategories.mockResolvedValue({
      categories: [
        { id: 3, name: "Memes" },
        { id: 4, name: "Reactions" },
      ],
    });

    await userEvent.click(screen.getByRole("button", { name: "Open Cat.gif" }));
    const dialog = screen.getByRole("dialog", { name: "Cat.gif" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Reactions" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Reactions" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(api.updateGifCategories).toHaveBeenCalledWith("cat", [3, 4]);
    expect(api.fetchCategories).toHaveBeenCalledTimes(2);

    api.updateGifCategories.mockResolvedValue({ categories: [{ id: 4, name: "Reactions" }] });
    await userEvent.click(within(dialog).getByRole("button", { name: "Memes" }));
    expect(api.updateGifCategories).toHaveBeenLastCalledWith("cat", [4]);
  });

  it("reports a failed category update", async () => {
    await renderSignedIn();
    api.updateGifCategories.mockRejectedValue(new Error("Category not found."));
    await userEvent.click(screen.getByRole("button", { name: "Open Cat.gif" }));
    await userEvent.click(screen.getByRole("button", { name: "Reactions" }));
    await waitFor(() => expect(toastMessages()).toEqual(["Category not found."]));
  });

  it("closes the modal from its close button", async () => {
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: "Open Cat.gif" }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("App import", () => {
  it("summarises an import with both successes and failures", async () => {
    await renderSignedIn();
    api.importGifs.mockResolvedValue({
      results: [{ success: true }, { success: true }, { success: false }],
    });

    await userEvent.click(screen.getByRole("button", { name: /Import/ }));
    const dialog = screen.getByRole("dialog", { name: "Import from URLs" });
    await userEvent.type(
      within(dialog).getByLabelText("Import URLs"),
      "https://tenor.com/a{enter}https://tenor.com/b{enter}https://x.test/c",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(toastMessages()).toEqual(["Imported 2 items.", "1 import failed."]));
    expect(api.importGifs).toHaveBeenCalledWith([
      "https://tenor.com/a",
      "https://tenor.com/b",
      "https://x.test/c",
    ]);
    expect(api.fetchGifs).toHaveBeenCalledTimes(2);
  });

  it("does not reload when nothing was imported", async () => {
    await renderSignedIn();
    api.importGifs.mockResolvedValue({ results: "unexpected" });

    await userEvent.click(screen.getByRole("button", { name: /Import/ }));
    const dialog = screen.getByRole("dialog", { name: "Import from URLs" });
    await userEvent.type(within(dialog).getByLabelText("Import URLs"), "https://tenor.com/a");
    await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));

    expect(await within(dialog).findByText("Imported 0 items.")).toBeInTheDocument();
    expect(toastMessages()).toEqual([]);
    expect(api.fetchGifs).toHaveBeenCalledTimes(1);
  });
});

describe("App categories dialog", () => {
  it("creates a category and refreshes the list", async () => {
    await renderSignedIn();
    api.createCategory.mockResolvedValue({ category: { id: 5 } });

    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    const dialog = screen.getByRole("dialog", { name: "Manage categories" });
    await userEvent.type(within(dialog).getByLabelText("Category name"), "Wholesome");
    await userEvent.click(within(dialog).getByRole("button", { name: /Add/ }));

    await waitFor(() => expect(within(dialog).getByLabelText("Category name")).toHaveValue(""));
    expect(api.createCategory).toHaveBeenCalledWith("Wholesome");
    expect(api.fetchCategories).toHaveBeenCalledTimes(2);
  });

  it("keeps the name and shows the error when creation fails", async () => {
    await renderSignedIn();
    api.createCategory.mockRejectedValue(new Error("Category already exists."));

    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    const dialog = screen.getByRole("dialog", { name: "Manage categories" });
    await userEvent.type(within(dialog).getByLabelText("Category name"), "Memes");
    await userEvent.click(within(dialog).getByRole("button", { name: /Add/ }));

    expect(await within(dialog).findByText("Category already exists.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Category name")).toHaveValue("Memes");
  });

  it("deletes the selected category and falls back to all gifs", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteCategory.mockResolvedValue({ success: true });
    window.history.replaceState(null, "", "/?category=3");
    await renderSignedIn();
    expect(cardNames()).toEqual(["Cat.gif"]);

    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    const dialog = screen.getByRole("dialog", { name: "Manage categories" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete Memes" }));

    await waitFor(() => expect(cardNames()).toEqual(["Cat.gif", "dog.webp"]));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete category "Memes"? Assignments will be removed.',
    );
    expect(api.deleteCategory).toHaveBeenCalledWith(3);
    expect(window.location.search).toBe("");
  });

  it("leaves the category alone when the delete is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Memes" }));
    expect(api.deleteCategory).not.toHaveBeenCalled();
  });

  it("shows the error when a category delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.deleteCategory.mockRejectedValue(new Error("Category not found."));
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: /Categories/ }));
    const dialog = screen.getByRole("dialog", { name: "Manage categories" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete Reactions" }));
    expect(await within(dialog).findByText("Category not found.")).toBeInTheDocument();
  });
});

describe("App toasts", () => {
  it("dismisses a toast on request", async () => {
    await renderSignedIn();
    api.uploadGif.mockRejectedValue(new Error("nope"));
    fireEvent.change(fileInput(), {
      target: { files: [new File(["a"], "a.gif", { type: "image/gif" })] },
    });
    await waitFor(() => expect(toastMessages()).toEqual(["nope"]));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(toastMessages()).toEqual([]);
  });

  it("clears a toast on its own after a few seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    await renderSignedIn();
    api.uploadGif.mockRejectedValue(new Error("nope"));
    fireEvent.change(fileInput(), {
      target: { files: [new File(["a"], "a.gif", { type: "image/gif" })] },
    });
    await waitFor(() => expect(toastMessages()).toEqual(["nope"]));

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(toastMessages()).toEqual(["nope"]);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(toastMessages()).toEqual([]);
  });
});

describe("App public view", () => {
  it("shows the public gallery read-only without asking for a session", async () => {
    window.__BASE__ = "/gifs/";
    window.history.replaceState(null, "", "/gifs/public?category=3");
    api.fetchPublicGifs.mockResolvedValue({ gifs: [{ ...catGif, categories: undefined }] });

    render(<App />);

    expect(await screen.findByText("Cat.gif")).toBeInTheDocument();
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Upload/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(api.getSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("ignores dropped files", async () => {
    window.history.replaceState(null, "", "/public");
    const { container } = render(<App />);
    await screen.findByText("This gallery is empty.");
    const app = container.querySelector(".app") as HTMLElement;
    fireEvent.dragEnter(app, { dataTransfer: { types: ["Files"] } });
    expect(screen.queryByText("Drop GIF or WebP files to upload")).toBeNull();
    fireEvent.drop(app, {
      dataTransfer: { types: ["Files"], files: [new File(["a"], "a.gif", { type: "image/gif" })] },
    });
    expect(api.uploadGif).not.toHaveBeenCalled();
  });

  it("shows an empty gallery when the public list cannot be loaded", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    window.history.replaceState(null, "", "/public");
    api.fetchPublicGifs.mockRejectedValue(new Error("No public category configured."));
    render(<App />);
    expect(await screen.findByText("This gallery is empty.")).toBeInTheDocument();
    expect(error).toHaveBeenCalledWith("Failed to load public gifs", expect.any(Error));
  });
});
