import type { GifItem, ViewMode } from "../types";
import GifCard from "./GifCard";

type GalleryProps = {
  gifs: GifItem[];
  viewMode: ViewMode;
  readOnly?: boolean;
  onOpen: (gif: GifItem) => void;
  onCopy: (gif: GifItem) => void;
  onDelete?: (slug: string, originalName: string) => void;
  deletingSlug?: string | null;
  emptyMessage?: string;
};

export default function Gallery({
  gifs,
  viewMode,
  readOnly = false,
  onOpen,
  onCopy,
  onDelete,
  deletingSlug,
  emptyMessage,
}: GalleryProps) {
  if (gifs.length === 0) {
    return (
      <div className="empty-state">
        <p>{emptyMessage ?? "Nothing here yet."}</p>
        {!readOnly ? <p className="dim">Drag a GIF or WebP anywhere to add it.</p> : null}
      </div>
    );
  }

  return (
    <div className={`gallery gallery--${viewMode}`}>
      {gifs.map((gif) => (
        <GifCard
          key={gif.slug}
          gif={gif}
          viewMode={viewMode}
          readOnly={readOnly}
          onOpen={onOpen}
          onCopy={onCopy}
          onDelete={onDelete}
          isDeleting={deletingSlug === gif.slug}
        />
      ))}
    </div>
  );
}
