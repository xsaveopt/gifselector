import { type FormEvent, useState } from "react";
import type { Category } from "../types";
import { PlusIcon, TrashIcon } from "./Icons";
import Modal from "./Modal";

type CategoryDialogProps = {
  categories: Category[];
  isCreating: boolean;
  deletingCategoryId: number | null;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<boolean>;
  onDelete: (categoryId: number, name: string) => Promise<boolean>;
};

export default function CategoryDialog({
  categories,
  isCreating,
  deletingCategoryId,
  error,
  onClose,
  onCreate,
  onDelete,
}: CategoryDialogProps) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("Enter a category name.");
      return;
    }
    setLocalError(null);
    const created = await onCreate(trimmed);
    if (created) {
      setName("");
    }
  };

  return (
    <Modal title="Manage categories" onClose={onClose}>
      <form className="category-create" onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (localError) {
              setLocalError(null);
            }
          }}
          placeholder="New category name"
          aria-label="Category name"
          disabled={isCreating}
        />
        <button type="submit" className="btn btn-primary" disabled={isCreating}>
          <PlusIcon width={16} height={16} />
          {isCreating ? "Adding…" : "Add"}
        </button>
      </form>
      {localError ? <p className="form-error">{localError}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      <div className="category-rows">
        {categories.length === 0 ? (
          <p className="dim">No categories yet.</p>
        ) : (
          categories.map((category) => (
            <div key={category.id} className="category-row">
              <div className="category-row-info">
                <span className="category-row-name">{category.name}</span>
                <span className="dim">{category.gifCount} gif(s)</span>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => onDelete(category.id, category.name)}
                disabled={deletingCategoryId === category.id}
                aria-label={`Delete ${category.name}`}
              >
                <TrashIcon width={17} height={17} />
              </button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
