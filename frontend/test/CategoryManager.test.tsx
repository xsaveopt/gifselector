import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CategoryManager from "../src/components/CategoryManager";

const categories = [{ id: 1, name: "Memes", createdAt: "2024", gifCount: 3 }];

describe("CategoryManager", () => {
  it("lists existing categories with their gif counts", () => {
    render(
      <CategoryManager
        categories={categories}
        onCreateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        isCreating={false}
        deletingCategoryId={null}
      />,
    );
    expect(screen.getByText("Memes")).toBeInTheDocument();
    expect(screen.getByText("3 gif(s)")).toBeInTheDocument();
  });

  it("creates a category from the form", async () => {
    const onCreate = vi.fn(async () => true);
    render(
      <CategoryManager
        categories={[]}
        onCreateCategory={onCreate}
        onDeleteCategory={vi.fn()}
        isCreating={false}
        deletingCategoryId={null}
      />,
    );
    await userEvent.type(screen.getByLabelText("Category name"), "Reactions");
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(onCreate).toHaveBeenCalledWith("Reactions");
  });

  it("blocks submitting an empty name and shows a local error", async () => {
    const onCreate = vi.fn(async () => true);
    render(
      <CategoryManager
        categories={[]}
        onCreateCategory={onCreate}
        onDeleteCategory={vi.fn()}
        isCreating={false}
        deletingCategoryId={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add category" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a category name.")).toBeInTheDocument();
  });

  it("deletes a category", async () => {
    const onDelete = vi.fn(async () => true);
    render(
      <CategoryManager
        categories={categories}
        onCreateCategory={vi.fn()}
        onDeleteCategory={onDelete}
        isCreating={false}
        deletingCategoryId={null}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(1, "Memes");
  });
});
