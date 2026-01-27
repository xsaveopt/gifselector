import type { DragEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCategory,
  deleteCategory,
  deleteGif,
  fetchCategories,
  fetchGifs,
  getSession,
  login,
  logout,
  updateGifCategories,
  uploadGif,
} from "./api";
import CategoryManager from "./components/CategoryManager";
import Gallery from "./components/Gallery";
import LoginForm from "./components/LoginForm";

type GifCategory = {
  id: number;
  name: string;
};

type Category = GifCategory & {
  createdAt: string;
  gifCount: number;
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

type SessionState = {
  authenticated: boolean;
  username?: string;
};

const UNCATEGORIZED_ID = -1;

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function App() {
  const [session, setSession] = useState<SessionState>({
    authenticated: false,
  });
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(
    null,
  );
  const [updatingCategorySlug, setUpdatingCategorySlug] = useState<
    string | null
  >(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(
    () => {
      const params = new URLSearchParams(window.location.search);
      const categoryId = params.get("category");
      if (categoryId) {
        return Number(categoryId);
      }
      const defaultId = import.meta.env.VITE_DEFAULT_CATEGORY_ID;
      return defaultId ? Number(defaultId) : null;
    },
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedCategory !== null) {
      params.set("category", String(selectedCategory));
    } else {
      params.delete("category");
    }
    const newRelativePathQuery =
      window.location.pathname + "?" + params.toString();
    window.history.replaceState(null, "", newRelativePathQuery);
  }, [selectedCategory]);

  const filteredGifs = useMemo(() => {
    if (selectedCategory === null) {
      return gifs;
    }
    if (selectedCategory === UNCATEGORIZED_ID) {
      return gifs.filter((gif) => gif.categories.length === 0);
    }
    return gifs.filter((gif) =>
      gif.categories.some((c) => c.id === selectedCategory),
    );
  }, [gifs, selectedCategory]);

  const stats = useMemo(() => {
    const totalSize = gifs.reduce((acc, gif) => acc + gif.sizeBytes, 0);
    const gifCount = gifs.filter((g) => g.mimeType === "image/gif").length;
    const webpCount = gifs.filter((g) => g.mimeType === "image/webp").length;
    const uncategorizedCount = gifs.filter(
      (g) => g.categories.length === 0,
    ).length;
    return { totalSize, gifCount, webpCount, uncategorizedCount };
  }, [gifs]);

  const loadGifs = useCallback(async () => {
    try {
      const data = await fetchGifs();
      setGifs(data.gifs ?? []);
      setTotalCount(
        typeof data.total === "number" ? data.total : (data.gifs?.length ?? 0),
      );
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const data = await fetchCategories();
      setCategories(data.categories ?? []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    await Promise.all([loadGifs(), loadCategories()]);
  }, [loadCategories, loadGifs]);

  const loadSession = useCallback(async () => {
    try {
      const result = await getSession();
      setSession(result);
      if (result.authenticated) {
        await loadAdminData();
      } else {
        setGifs([]);
        setCategories([]);
        setTotalCount(0);
        setCategoryError(null);
        setDeletingCategoryId(null);
        setUpdatingCategorySlug(null);
        setIsCreatingCategory(false);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSessionLoading(false);
    }
  }, [loadAdminData]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const handleLogin = async (username: string, password: string) => {
    setIsAuthenticating(true);
    setLoginError(null);
    try {
      await login(username, password);
      await loadSession();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error(error);
    } finally {
      setSession({ authenticated: false });
      setGifs([]);
      setCategories([]);
      setTotalCount(0);
      setCategoryError(null);
      setDeletingCategoryId(null);
      setUpdatingCategorySlug(null);
      setIsCreatingCategory(false);
    }
  };

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      setUploadError(null);
      setIsUploading(true);
      try {
        for (const file of Array.from(files)) {
          if (!["image/gif", "image/webp"].includes(file.type)) {
            setUploadError("Only GIF or WebP files are supported.");
            continue;
          }
          await uploadGif(file);
        }
        await loadAdminData();
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : "Upload failed.",
        );
      } finally {
        setIsUploading(false);
      }
    },
    [loadAdminData],
  );

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragDepth(0);
      setIsDragging(false);
      await handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((value) => value + 1);
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((value) => {
      const next = Math.max(0, value - 1);
      if (next === 0) {
        setIsDragging(false);
      }
      return next;
    });
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDelete = useCallback(
    async (slug: string, name: string) => {
      const confirmed = window.confirm(
        `Delete "${name}"? This cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
      setDeleteError(null);
      setDeletingSlug(slug);
      try {
        await deleteGif(slug);
        await loadAdminData();
      } catch (error) {
        setDeleteError(
          error instanceof Error ? error.message : "Delete failed.",
        );
      } finally {
        setDeletingSlug(null);
      }
    },
    [loadAdminData],
  );

  const handleCreateCategory = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setCategoryError("Category name is required.");
        return false;
      }
      setCategoryError(null);
      setIsCreatingCategory(true);
      try {
        await createCategory(trimmed);
        await loadCategories();
        return true;
      } catch (error) {
        setCategoryError(
          error instanceof Error ? error.message : "Failed to create category.",
        );
        return false;
      } finally {
        setIsCreatingCategory(false);
      }
    },
    [loadCategories],
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: number, categoryName: string) => {
      const confirmed = window.confirm(
        `Delete category "${categoryName}"? Assignments will be removed.`,
      );
      if (!confirmed) {
        return false;
      }
      setCategoryError(null);
      setDeletingCategoryId(categoryId);
      try {
        await deleteCategory(categoryId);
        await loadAdminData();
        return true;
      } catch (error) {
        setCategoryError(
          error instanceof Error ? error.message : "Failed to delete category.",
        );
        return false;
      } finally {
        setDeletingCategoryId(null);
      }
    },
    [loadAdminData],
  );

  const handleUpdateGifCategories = useCallback(
    async (slug: string, categoryIds: number[]) => {
      setCategoryError(null);
      setUpdatingCategorySlug(slug);
      try {
        const result = await updateGifCategories(slug, categoryIds);
        const nextCategories = Array.isArray(result.categories)
          ? result.categories
          : [];
        setGifs((current) =>
          current.map((gif) =>
            gif.slug === slug ? { ...gif, categories: nextCategories } : gif,
          ),
        );
        await loadCategories();
        return true;
      } catch (error) {
        setCategoryError(
          error instanceof Error
            ? error.message
            : "Failed to update categories.",
        );
        return false;
      } finally {
        setUpdatingCategorySlug(null);
      }
    },
    [loadCategories],
  );

  if (isSessionLoading) {
    return (
      <div className="app-shell">
        <p>Loading…</p>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="app-shell">
        <LoginForm
          onSubmit={handleLogin}
          isSubmitting={isAuthenticating}
          errorMessage={loginError}
        />
      </div>
    );
  }

  return (
    <div
      className={`dashboard${isDragging ? " dashboard-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>gifselector</h1>
        </div>

        <div className="filter-section">
          <label htmlFor="category-filter" className="filter-label">
            Filter
          </label>
          <div className="select-wrapper">
            <select
              id="category-filter"
              value={selectedCategory ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedCategory(val ? Number(val) : null);
              }}
            >
              <option value="">All Categories</option>
              <option value={UNCATEGORIZED_ID}>Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="filter-section">
          <label className="filter-label">View</label>
          <div className="view-selector">
            <button
              type="button"
              className={viewMode === "grid" ? "selected" : ""}
              onClick={() => setViewMode("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "selected" : ""}
              onClick={() => setViewMode("list")}
            >
              List
            </button>
          </div>
        </div>

        <div className="instructions-block">
          <p className="muted instructions">
            {selectedCategory
              ? `Showing ${filteredGifs.length} of ${totalCount} entries`
              : `Total entries: ${totalCount}`}
          </p>
          <p className="muted instructions">
            Drag GIF or WebP files anywhere on the screen to upload them.
          </p>
        </div>

        <CategoryManager
          categories={categories}
          onCreateCategory={handleCreateCategory}
          onDeleteCategory={handleDeleteCategory}
          isCreating={isCreatingCategory}
          deletingCategoryId={deletingCategoryId}
        />

        <div className="stats-block">
          <h2>Stats</h2>
          <dl className="stats-list">
            <div className="stats-item">
              <dt>Total Size</dt>
              <dd>{formatBytes(stats.totalSize)}</dd>
            </div>
            <div className="stats-item">
              <dt>GIFs</dt>
              <dd>{stats.gifCount}</dd>
            </div>
            <div className="stats-item">
              <dt>WebPs</dt>
              <dd>{stats.webpCount}</dd>
            </div>
            <div className="stats-item">
              <dt>Uncategorized</dt>
              <dd>{stats.uncategorizedCount}</dd>
            </div>
          </dl>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="top-bar">
          <p className="muted">
            Welcome back{session.username ? `, ${session.username}` : ""}.
          </p>
          <button type="button" onClick={handleLogout}>
            Log out
          </button>
        </header>

        <div className="gallery-container">
          {uploadError ? <p className="error">{uploadError}</p> : null}
          {deleteError ? <p className="error">{deleteError}</p> : null}
          {categoryError ? <p className="error">{categoryError}</p> : null}
          {isUploading ? <p className="muted">Uploading…</p> : null}

          <Gallery
            gifs={filteredGifs}
            categories={categories}
            onDelete={handleDelete}
            deletingSlug={deletingSlug}
            onUpdateCategories={handleUpdateGifCategories}
            updatingCategoriesSlug={updatingCategorySlug}
            viewMode={viewMode}
          />
        </div>
      </main>

      {isDragging ? (
        <div className="drag-overlay">
          <p>Drop to upload GIF/WebP files</p>
        </div>
      ) : null}
    </div>
  );
}
