export type GifCategory = {
  id: number;
  name: string;
};

export type Category = GifCategory & {
  createdAt: string;
  gifCount: number;
};

export type GifItem = {
  id: number;
  slug: string;
  originalName: string;
  shareUrl: string;
  createdAt: string;
  sizeBytes: number;
  mimeType?: string;
  categories: GifCategory[];
};

export type SessionState = {
  authenticated: boolean;
  username?: string;
};

export type ViewMode = "grid" | "list";

export type Toast = {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
};
