import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import FilterBar, { UNCATEGORIZED_ID } from "../../src/client/components/FilterBar";
import type { Category } from "../../src/client/types";

const categories: Category[] = [
  { id: 1, name: "Memes", createdAt: "2024", gifCount: 3 },
  { id: 2, name: "Reactions", createdAt: "2024", gifCount: 7 },
];

function renderBar(overrides: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  return render(
    <FilterBar
      categories={categories}
      selectedCategory={null}
      onSelectCategory={vi.fn()}
      viewMode="grid"
      onViewMode={vi.fn()}
      shownCount={4}
      totalCount={10}
      readOnly={false}
      uncategorizedCount={2}
      {...overrides}
    />,
  );
}

describe("FilterBar", () => {
  it("shows a chip per category with its count", () => {
    renderBar();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "All10",
      "Uncategorized2",
      "Memes3",
      "Reactions7",
    ]);
  });

  it("marks the selected chip", () => {
    renderBar({ selectedCategory: 2 });
    expect(screen.getByRole("tab", { name: /Reactions/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "false");
  });

  it("selects a category, uncategorized, and all", async () => {
    const onSelectCategory = vi.fn();
    renderBar({ onSelectCategory, selectedCategory: 1 });

    await userEvent.click(screen.getByRole("tab", { name: /Memes/ }));
    expect(onSelectCategory).toHaveBeenCalledWith(1);

    await userEvent.click(screen.getByRole("tab", { name: /Uncategorized/ }));
    expect(onSelectCategory).toHaveBeenCalledWith(UNCATEGORIZED_ID);

    await userEvent.click(screen.getByRole("tab", { name: /All/ }));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it("reports how many of the total are shown", () => {
    renderBar();
    expect(screen.getByText("4 of 10")).toBeInTheDocument();
  });

  it("switches the view mode", async () => {
    const onViewMode = vi.fn();
    renderBar({ onViewMode });

    expect(screen.getByRole("button", { name: "Grid view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(onViewMode).toHaveBeenCalledWith("list");
  });

  it("hides the category chips in read-only mode and counts items instead", () => {
    renderBar({ readOnly: true });
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText("4 items")).toBeInTheDocument();
    expect(screen.queryByText("4 of 10")).toBeNull();
  });

  it("uses the singular for a single item in read-only mode", () => {
    renderBar({ readOnly: true, shownCount: 1 });
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("keeps the view toggle available in read-only mode", () => {
    renderBar({ readOnly: true, viewMode: "list" });
    expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
