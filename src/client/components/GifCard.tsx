import type { GifItem, ViewMode } from "../types";
import { LinkIcon, TrashIcon } from "./Icons";

type GifCardProps = {
  gif: GifItem;
  viewMode: ViewMode;
  readOnly: boolean;
  onOpen: (gif: GifItem) => void;
  onCopy: (gif: GifItem) => void;
  onDelete?: (slug: string, originalName: string) => void;
  isDeleting: boolean;
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

function kindLabel(mimeType?: string) {
  if (mimeType === "image/webp") {
    return "WebP";
  }
  if (mimeType === "image/gif") {
    return "GIF";
  }
  return "Image";
}

export default function GifCard({
  gif,
  viewMode,
  readOnly,
  onOpen,
  onCopy,
  onDelete,
  isDeleting,
}: GifCardProps) {
  return (
    <article className={`card card--${viewMode}`}>
      <button
        type="button"
        className="card-media"
        onClick={() => onOpen(gif)}
        aria-label={`Open ${gif.originalName}`}
      >
        <img src={gif.shareUrl} alt={gif.originalName} loading="lazy" />
        <span className="card-kind">{kindLabel(gif.mimeType)}</span>
      </button>
      <div className="card-info">
        <div className="card-text">
          <p className="card-name" title={gif.originalName}>
            {gif.originalName}
          </p>
          <p className="dim card-sub">
            {formatBytes(gif.sizeBytes)}
            {gif.categories.length > 0 ? ` · ${gif.categories.map((c) => c.name).join(", ")}` : ""}
          </p>
        </div>
        <div className="card-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onCopy(gif)}
            aria-label="Copy share link"
            title="Copy share link"
          >
            <LinkIcon width={17} height={17} />
          </button>
          {!readOnly && onDelete ? (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              onClick={() => onDelete(gif.slug, gif.originalName)}
              disabled={isDeleting}
              aria-label="Delete"
              title="Delete"
            >
              <TrashIcon width={17} height={17} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
