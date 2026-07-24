import { useEffect } from "react";
import type { Category, GifItem } from "../types";
import { CheckIcon, CloseIcon, DownloadIcon, LinkIcon, TrashIcon } from "./Icons";

type GifModalProps = {
  gif: GifItem;
  categories: Category[];
  readOnly: boolean;
  isUpdatingCategories: boolean;
  onClose: () => void;
  onCopy: (gif: GifItem) => void;
  onDelete?: (slug: string, originalName: string) => void;
  onToggleCategory?: (gif: GifItem, categoryId: number, next: boolean) => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function GifModal({
  gif,
  categories,
  readOnly,
  isUpdatingCategories,
  onClose,
  onCopy,
  onDelete,
  onToggleCategory,
}: GifModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  const assigned = new Set(gif.categories.map((c) => c.id));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={gif.originalName}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="lightbox-stage">
          <img src={gif.shareUrl} alt={gif.originalName} />
        </div>
        <aside className="lightbox-panel">
          <header className="lightbox-head">
            <h2 title={gif.originalName}>{gif.originalName}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </header>

          <dl className="detail-list">
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(gif.sizeBytes)}</dd>
            </div>
            <div>
              <dt>Added</dt>
              <dd>{formatDate(gif.createdAt)}</dd>
            </div>
          </dl>

          <div className="share-row">
            <input type="text" readOnly value={gif.shareUrl} aria-label="Share link" />
            <button
              type="button"
              className="btn btn-subtle"
              onClick={() => onCopy(gif)}
              title="Copy share link"
            >
              <LinkIcon width={16} height={16} />
              Copy
            </button>
          </div>

          {!readOnly ? (
            <div className="detail-block">
              <p className="detail-label">Categories</p>
              {categories.length === 0 ? (
                <p className="dim">Create a category to start tagging.</p>
              ) : (
                <div className="chip-picker">
                  {categories.map((category) => {
                    const active = assigned.has(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={`pick-chip${active ? " pick-chip--on" : ""}`}
                        disabled={isUpdatingCategories}
                        aria-pressed={active}
                        onClick={() => onToggleCategory?.(gif, category.id, !active)}
                      >
                        {active ? <CheckIcon width={14} height={14} /> : null}
                        {category.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : gif.categories.length > 0 ? (
            <div className="detail-block">
              <p className="detail-label">Categories</p>
              <div className="chip-picker">
                {gif.categories.map((category) => (
                  <span key={category.id} className="pick-chip pick-chip--static">
                    {category.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="lightbox-footer">
            <a className="btn btn-subtle" href={gif.shareUrl} target="_blank" rel="noreferrer">
              <DownloadIcon width={16} height={16} />
              Open file
            </a>
            {!readOnly && onDelete ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onDelete(gif.slug, gif.originalName)}
              >
                <TrashIcon width={16} height={16} />
                Delete
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
