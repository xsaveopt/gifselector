import type { Category, ViewMode } from "../types";
import { GridIcon, ListIcon } from "./Icons";

const ALL_ID = null;
export const UNCATEGORIZED_ID = -1;

type FilterBarProps = {
  categories: Category[];
  selectedCategory: number | null;
  onSelectCategory: (value: number | null) => void;
  viewMode: ViewMode;
  onViewMode: (value: ViewMode) => void;
  shownCount: number;
  totalCount: number;
  readOnly: boolean;
  uncategorizedCount: number;
};

export default function FilterBar({
  categories,
  selectedCategory,
  onSelectCategory,
  viewMode,
  onViewMode,
  shownCount,
  totalCount,
  readOnly,
  uncategorizedCount,
}: FilterBarProps) {
  return (
    <div className="filterbar">
      {!readOnly ? (
        <div className="chips" role="tablist" aria-label="Filter by category">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === ALL_ID}
            className={`chip${selectedCategory === ALL_ID ? " chip--on" : ""}`}
            onClick={() => onSelectCategory(ALL_ID)}
          >
            All
            <span className="chip-count">{totalCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === UNCATEGORIZED_ID}
            className={`chip${selectedCategory === UNCATEGORIZED_ID ? " chip--on" : ""}`}
            onClick={() => onSelectCategory(UNCATEGORIZED_ID)}
          >
            Uncategorized
            <span className="chip-count">{uncategorizedCount}</span>
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={selectedCategory === category.id}
              className={`chip${selectedCategory === category.id ? " chip--on" : ""}`}
              onClick={() => onSelectCategory(category.id)}
            >
              {category.name}
              <span className="chip-count">{category.gifCount}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="dim filter-count">
          {shownCount} item{shownCount === 1 ? "" : "s"}
        </p>
      )}

      <div className="filter-right">
        {!readOnly ? (
          <span className="dim filter-count">
            {shownCount} of {totalCount}
          </span>
        ) : null}
        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-btn${viewMode === "grid" ? " view-btn--on" : ""}`}
            onClick={() => onViewMode("grid")}
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
          >
            <GridIcon width={17} height={17} />
          </button>
          <button
            type="button"
            className={`view-btn${viewMode === "list" ? " view-btn--on" : ""}`}
            onClick={() => onViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
          >
            <ListIcon width={17} height={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
