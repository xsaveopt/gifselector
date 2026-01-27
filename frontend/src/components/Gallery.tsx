import { useState } from "react";

type GifCategory = {
  id: number;
  name: string;
};

type GifItem = {
  id: number;
  slug: string;
  originalName: string;
  shareUrl: string;
  createdAt: string;
  sizeBytes: number;
  mimeType?: string;
  categories: GifCategory[];
};

type CategoryOption = GifCategory;

type GalleryProps = {
  gifs: GifItem[];
  categories: CategoryOption[];
  onDelete: (slug: string, originalName: string) => Promise<void>;
  deletingSlug: string | null;
  onUpdateCategories: (slug: string, categoryIds: number[]) => Promise<boolean>;
  updatingCategoriesSlug: string | null;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function Gallery({
  gifs,
  categories,
  onDelete,
  deletingSlug,
  onUpdateCategories,
  updatingCategoriesSlug,
}: GalleryProps) {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const handleCopy = async (slug: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(slug);
      window.setTimeout(() => {
        setCopiedSlug((current) => (current === slug ? null : current));
      }, 2000);
    } catch (error) {
      console.error("Failed to copy share link", error);
    }
  };

  const handleCategoryToggle = (
    gif: GifItem,
    categoryId: number,
    isChecked: boolean,
  ) => {
    const currentIds = new Set(gif.categories.map((category) => category.id));
    if (isChecked) {
      currentIds.add(categoryId);
    } else {
      currentIds.delete(categoryId);
    }
    void onUpdateCategories(gif.slug, Array.from(currentIds));
  };

  if (gifs.length === 0) {
    return (
      <p className="muted">
        No GIF or WebP files uploaded yet. Drag one onto the screen to add it.
      </p>
    );
  }

  return (
    <div className="gallery">
      {gifs.map((gif) => {
        const isUpdating = updatingCategoriesSlug === gif.slug;
        return (
          <article key={gif.id} className="gif-card">
            <img src={gif.shareUrl} alt={gif.originalName} loading="lazy" />
            <div className="gif-meta">
              <div>
                <h2>{gif.originalName}</h2>
                <p className="muted">
                  {formatBytes(gif.sizeBytes)} · Uploaded{" "}
                  {formatDate(gif.createdAt)}
                </p>
                {copiedSlug === gif.slug ? (
                  <span className="copy-feedback">Copied to clipboard</span>
                ) : null}
              </div>
              <div className="actions">
                <button
                  type="button"
                  onClick={() => handleCopy(gif.slug, gif.shareUrl)}
                >
                  {copiedSlug === gif.slug ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  className="button-danger"
                  onClick={() => onDelete(gif.slug, gif.originalName)}
                  disabled={deletingSlug === gif.slug}
                >
                  {deletingSlug === gif.slug ? "Deleting…" : "Delete"}
                </button>
              </div>
              <div className="gif-categories">
                <p className="muted gif-categories__label">Categories</p>
                {categories.length > 0 ? (
                  <>
                    <div className="category-selector">
                      {categories.map((category) => {
                        const inputId = `gif-${gif.slug}-category-${category.id}`;
                        const isChecked = gif.categories.some(
                          (assigned) => assigned.id === category.id,
                        );
                        return (
                          <label
                            key={category.id}
                            htmlFor={inputId}
                            className="category-selector__option"
                          >
                            <input
                              id={inputId}
                              type="checkbox"
                              checked={isChecked}
                              disabled={isUpdating}
                              onChange={(event) =>
                                handleCategoryToggle(
                                  gif,
                                  category.id,
                                  event.target.checked,
                                )
                              }
                            />
                            <span>{category.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="category-tags">
                      {gif.categories.length > 0 ? (
                        gif.categories.map((category) => (
                          <span key={category.id} className="category-tag">
                            {category.name}
                          </span>
                        ))
                      ) : (
                        <span className="muted category-tags__empty">
                          No categories assigned.
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="muted gif-categories__empty">
                    Create a category above to start tagging.
                  </p>
                )}
                {isUpdating ? (
                  <p className="muted gif-categories__status">Updating…</p>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
