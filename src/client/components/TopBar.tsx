import type { SessionState } from "../types";
import { LogoIcon, LogoutIcon, PlusIcon, SearchIcon, TagIcon, UploadIcon } from "./Icons";

type TopBarProps = {
  session: SessionState;
  readOnly: boolean;
  search: string;
  onSearch: (value: string) => void;
  onUpload: () => void;
  onImport: () => void;
  onManageCategories: () => void;
  onLogout: () => void;
};

export default function TopBar({
  session,
  readOnly,
  search,
  onSearch,
  onUpload,
  onImport,
  onManageCategories,
  onLogout,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <LogoIcon width={20} height={20} />
        </span>
        <span className="brand-name">gifselector</span>
        {readOnly ? <span className="brand-tag">public</span> : null}
      </div>

      {!readOnly ? (
        <div className="search">
          <SearchIcon width={17} height={17} />
          <input
            type="search"
            placeholder="Search by name"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            aria-label="Search gifs"
          />
        </div>
      ) : null}

      <div className="topbar-actions">
        {!readOnly ? (
          <>
            <button type="button" className="btn btn-subtle" onClick={onManageCategories}>
              <TagIcon width={16} height={16} />
              <span className="btn-label">Categories</span>
            </button>
            <button type="button" className="btn btn-subtle" onClick={onImport}>
              <PlusIcon width={16} height={16} />
              <span className="btn-label">Import</span>
            </button>
            <button type="button" className="btn btn-primary" onClick={onUpload}>
              <UploadIcon width={16} height={16} />
              <span className="btn-label">Upload</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onLogout}
              title={session.username ? `Log out ${session.username}` : "Log out"}
              aria-label="Log out"
            >
              <LogoutIcon width={18} height={18} />
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
