import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CategoryDialog from "../../src/client/components/CategoryDialog";
import type { Category } from "../../src/client/types";

const categories: Category[] = [{ id: 1, name: "Memes", createdAt: "2024", gifCount: 3 }];

function renderDialog(overrides: Partial<Parameters<typeof CategoryDialog>[0]> = {}) {
  return render(
    <CategoryDialog
      categories={categories}
      isCreating={false}
      deletingCategoryId={null}
      error={null}
      onClose={vi.fn()}
      onCreate={vi.fn(async () => true)}
      onDelete={vi.fn(async () => true)}
      {...overrides}
    />,
  );
}

describe("CategoryDialog", () => {
  it("lists categories with their gif counts", () => {
    renderDialog();
    expect(screen.getByText("Memes")).toBeInTheDocument();
    expect(screen.getByText("3 gif(s)")).toBeInTheDocument();
  });

  it("creates a category from the form", async () => {
    const onCreate = vi.fn(async () => true);
    renderDialog({ onCreate, categories: [] });
    await userEvent.type(screen.getByLabelText("Category name"), "Reactions");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreate).toHaveBeenCalledWith("Reactions");
  });

  it("blocks an empty name and shows a local error", async () => {
    const onCreate = vi.fn(async () => true);
    renderDialog({ onCreate, categories: [] });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a category name.")).toBeInTheDocument();
  });

  it("deletes a category", async () => {
    const onDelete = vi.fn(async () => true);
    renderDialog({ onDelete });
    await userEvent.click(screen.getByRole("button", { name: "Delete Memes" }));
    expect(onDelete).toHaveBeenCalledWith(1, "Memes");
  });
});
