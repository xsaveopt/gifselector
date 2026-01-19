import { FormEvent, useState } from 'react';

type Category = {
  id: number;
  name: string;
  createdAt: string;
  gifCount: number;
};

type CategoryManagerProps = {
  categories: Category[];
  onCreateCategory: (name: string) => Promise<boolean>;
  onDeleteCategory: (categoryId: number, categoryName: string) => Promise<boolean>;
  isCreating: boolean;
  deletingCategoryId: number | null;
};

export default function CategoryManager({
  categories,
  onCreateCategory,
  onDeleteCategory,
  isCreating,
  deletingCategoryId
}: CategoryManagerProps) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Enter a category name.');
      return;
    }
    setLocalError(null);
    const created = await onCreateCategory(trimmed);
    if (created) {
      setName('');
    }
  };

  return (
    <section className="category-manager">
      <div className="category-manager__header">
        <div>
          <h2>Categories</h2>
          <p className="muted">Organise GIFs by assigning them to categories.</p>
        </div>
      </div>
      <form className="category-form" onSubmit={handleSubmit}>
        <div className="category-form__controls">
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (localError) {
                setLocalError(null);
              }
            }}
            placeholder="Add a new category"
            aria-label="Category name"
            disabled={isCreating}
          />
          <button type="submit" disabled={isCreating}>
            {isCreating ? 'Creating…' : 'Add category'}
          </button>
        </div>
        {localError ? <p className="error category-form__error">{localError}</p> : null}
      </form>
      <div className="category-list">
        {categories.length === 0 ? (
          <p className="muted">No categories yet. Create one to get started.</p>
        ) : (
          categories.map((category) => (
            <div key={category.id} className="category-list__item">
              <div className="category-list__info">
                <span className="category-list__name">{category.name}</span>
                <span className="muted category-list__meta">{category.gifCount} gif(s)</span>
              </div>
              <button
                type="button"
                className="button-danger"
                onClick={() => onDeleteCategory(category.id, category.name)}
                disabled={deletingCategoryId === category.id}
              >
                {deletingCategoryId === category.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
