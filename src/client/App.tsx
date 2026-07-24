import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCategory,
  deleteCategory,
  deleteGif,
  fetchCategories,
  fetchGifs,
  fetchPublicGifs,
  getSession,
  importGifs,
  login,
  logout,
  updateGifCategories,
  uploadGif,
} from "./api";
import CategoryDialog from "./components/CategoryDialog";
import FilterBar, { UNCATEGORIZED_ID } from "./components/FilterBar";
import Gallery from "./components/Gallery";
import GifModal from "./components/GifModal";
import ImportDialog from "./components/ImportDialog";
import LoginForm from "./components/LoginForm";
import Toaster from "./components/Toaster";
import TopBar from "./components/TopBar";
import type { Category, GifItem, SessionState, Toast, ViewMode } from "./types";

const ACCEPTED_TYPES = ["image/gif", "image/webp"];

export default function App() {
  const base = (window.__BASE__ ?? "").replace(/\/$/, "");
  const isPublicView = window.location.pathname.startsWith(`${base}/public`);

  const [session, setSession] = useState<SessionState>({ authenticated: false });
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedCategory, setSelectedCategory] = useState<number | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const categoryId = params.get("category");
    if (categoryId) {
      return Number(categoryId);
    }
    const defaultId = window.__DEFAULT_CATEGORY__;
    return defaultId ? Number(defaultId) : null;
  });

  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);
  const [updatingCategorySlug, setUpdatingCategorySlug] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [openGifSlug, setOpenGifSlug] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedCategory !== null) {
      params.set("category", String(selectedCategory));
    } else {
      params.delete("category");
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [selectedCategory]);

  const loadGifs = useCallback(async () => {
    const data = await fetchGifs();
    setGifs(data.gifs ?? []);
    setTotalCount(typeof data.total === "number" ? data.total : (data.gifs?.length ?? 0));
  }, []);

  const loadCategories = useCallback(async () => {
    const data = await fetchCategories();
    setCategories(data.categories ?? []);
  }, []);

  const loadAdminData = useCallback(async () => {
    await Promise.all([loadGifs(), loadCategories()]);
  }, [loadCategories, loadGifs]);

  const loadSession = useCallback(async () => {
    if (isPublicView) {
      try {
        const data = await fetchPublicGifs();
        const items = (data.gifs ?? []).map((gif: GifItem) => ({
          ...gif,
          categories: gif.categories ?? [],
        }));
        setGifs(items);
        setTotalCount(items.length);
      } catch (error) {
        console.error("Failed to load public gifs", error);
      } finally {
        setIsSessionLoading(false);
      }
      return;
    }
    try {
      const result = await getSession();
      setSession(result);
      if (result.authenticated) {
        await loadAdminData();
      } else {
        setGifs([]);
        setCategories([]);
        setTotalCount(0);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSessionLoading(false);
    }
  }, [isPublicView, loadAdminData]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const filteredGifs = useMemo(() => {
    let result = gifs;
    if (selectedCategory === UNCATEGORIZED_ID) {
      result = result.filter((gif) => gif.categories.length === 0);
    } else if (selectedCategory !== null) {
      result = result.filter((gif) => gif.categories.some((c) => c.id === selectedCategory));
    }
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter((gif) => gif.originalName.toLowerCase().includes(term));
    }
    return result;
  }, [gifs, selectedCategory, search]);

  const uncategorizedCount = useMemo(
    () => gifs.filter((gif) => gif.categories.length === 0).length,
    [gifs],
  );

  const openGif = useMemo(
    () => filteredGifs.find((gif) => gif.slug === openGifSlug) ?? null,
    [filteredGifs, openGifSlug],
  );

  const handleCopy = useCallback(
    async (gif: GifItem) => {
      try {
        await navigator.clipboard.writeText(gif.shareUrl);
        notify("success", "Share link copied.");
      } catch (error) {
        console.error("Failed to copy share link", error);
        notify("error", "Could not copy the link.");
      }
    },
    [notify],
  );

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
    }
  };

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      setIsUploading(true);
      let uploaded = 0;
      let rejected = 0;
      try {
        for (const file of Array.from(files)) {
          if (!ACCEPTED_TYPES.includes(file.type)) {
            rejected += 1;
            continue;
          }
          await uploadGif(file);
          uploaded += 1;
        }
        if (uploaded > 0) {
          await loadAdminData();
          notify("success", `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}.`);
        }
        if (rejected > 0) {
          notify("error", `Skipped ${rejected} unsupported file${rejected === 1 ? "" : "s"}.`);
        }
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "Upload failed.");
      } finally {
        setIsUploading(false);
      }
    },
    [loadAdminData, notify],
  );

  const onFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await handleFiles(event.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setIsDragging(false);
      if (isPublicView) {
        return;
      }
      await handleFiles(event.dataTransfer.files);
    },
    [handleFiles, isPublicView],
  );

  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (isPublicView || !event.dataTransfer.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    },
    [isPublicView],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDelete = useCallback(
    async (slug: string, name: string) => {
      if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) {
        return;
      }
      setDeletingSlug(slug);
      try {
        await deleteGif(slug);
        setOpenGifSlug((current) => (current === slug ? null : current));
        await loadAdminData();
        notify("success", "Deleted.");
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "Delete failed.");
      } finally {
        setDeletingSlug(null);
      }
    },
    [loadAdminData, notify],
  );

  const handleCreateCategory = useCallback(
    async (name: string) => {
      setCategoryError(null);
      setIsCreatingCategory(true);
      try {
        await createCategory(name);
        await loadCategories();
        return true;
      } catch (error) {
        setCategoryError(error instanceof Error ? error.message : "Failed to create category.");
        return false;
      } finally {
        setIsCreatingCategory(false);
      }
    },
    [loadCategories],
  );

  const handleDeleteCategory = useCallback(
    async (categoryId: number, categoryName: string) => {
      if (!window.confirm(`Delete category "${categoryName}"? Assignments will be removed.`)) {
        return false;
      }
      setCategoryError(null);
      setDeletingCategoryId(categoryId);
      try {
        await deleteCategory(categoryId);
        if (selectedCategory === categoryId) {
          setSelectedCategory(null);
        }
        await loadAdminData();
        return true;
      } catch (error) {
        setCategoryError(error instanceof Error ? error.message : "Failed to delete category.");
        return false;
      } finally {
        setDeletingCategoryId(null);
      }
    },
    [loadAdminData, selectedCategory],
  );

  const handleToggleCategory = useCallback(
    async (gif: GifItem, categoryId: number, next: boolean) => {
      const ids = new Set(gif.categories.map((c) => c.id));
      if (next) {
        ids.add(categoryId);
      } else {
        ids.delete(categoryId);
      }
      setUpdatingCategorySlug(gif.slug);
      try {
        const result = await updateGifCategories(gif.slug, Array.from(ids));
        const nextCategories = Array.isArray(result.categories) ? result.categories : [];
        setGifs((current) =>
          current.map((item) =>
            item.slug === gif.slug ? { ...item, categories: nextCategories } : item,
          ),
        );
        await loadCategories();
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "Failed to update categories.");
      } finally {
        setUpdatingCategorySlug(null);
      }
    },
    [loadCategories, notify],
  );

  const handleImport = useCallback(
    async (urls: string[]) => {
      const response = await importGifs(urls);
      const results = Array.isArray(response.results) ? response.results : [];
      const successes = results.filter((entry: { success?: boolean }) => entry.success).length;
      const failures = results.length - successes;
      if (successes > 0) {
        await loadAdminData();
        notify("success", `Imported ${successes} item${successes === 1 ? "" : "s"}.`);
      }
      if (failures > 0) {
        notify("error", `${failures} import${failures === 1 ? "" : "s"} failed.`);
      }
      return { successes, failures };
    },
    [loadAdminData, notify],
  );

  if (isSessionLoading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    );
  }

  if (!isPublicView && !session.authenticated) {
    return (
      <>
        <LoginForm
          onSubmit={handleLogin}
          isSubmitting={isAuthenticating}
          errorMessage={loginError}
        />
        <Toaster toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const readOnly = isPublicView;

  return (
    <div
      className={`app${isDragging ? " app--dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <TopBar
        session={session}
        readOnly={readOnly}
        search={search}
        onSearch={setSearch}
        onUpload={() => fileInputRef.current?.click()}
        onImport={() => setShowImport(true)}
        onManageCategories={() => setShowCategories(true)}
        onLogout={handleLogout}
      />

      <main className="workspace">
        <FilterBar
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          viewMode={viewMode}
          onViewMode={setViewMode}
          shownCount={filteredGifs.length}
          totalCount={totalCount}
          readOnly={readOnly}
          uncategorizedCount={uncategorizedCount}
        />

        <Gallery
          gifs={filteredGifs}
          viewMode={viewMode}
          readOnly={readOnly}
          onOpen={(gif) => setOpenGifSlug(gif.slug)}
          onCopy={handleCopy}
          onDelete={handleDelete}
          deletingSlug={deletingSlug}
          emptyMessage={
            search.trim() || selectedCategory !== null
              ? "No matching items."
              : readOnly
                ? "This gallery is empty."
                : "No GIFs yet."
          }
        />
      </main>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/gif,image/webp"
        multiple
        onChange={onFileInputChange}
        hidden
      />

      {isDragging ? (
        <div className="drop-overlay">
          <div className="drop-card">Drop GIF or WebP files to upload</div>
        </div>
      ) : null}

      {isUploading ? <div className="upload-strip">Uploading…</div> : null}

      {openGif ? (
        <GifModal
          gif={openGif}
          categories={categories}
          readOnly={readOnly}
          isUpdatingCategories={updatingCategorySlug === openGif.slug}
          onClose={() => setOpenGifSlug(null)}
          onCopy={handleCopy}
          onDelete={handleDelete}
          onToggleCategory={handleToggleCategory}
        />
      ) : null}

      {showImport ? (
        <ImportDialog onClose={() => setShowImport(false)} onImport={handleImport} />
      ) : null}

      {showCategories ? (
        <CategoryDialog
          categories={categories}
          isCreating={isCreatingCategory}
          deletingCategoryId={deletingCategoryId}
          error={categoryError}
          onClose={() => setShowCategories(false)}
          onCreate={handleCreateCategory}
          onDelete={handleDeleteCategory}
        />
      ) : null}

      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
