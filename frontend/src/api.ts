const basePath = (() => {
  const base = import.meta.env.BASE_URL || "/gifselector/";
  return base.endsWith("/") ? base.slice(0, -1) : base;
})();

async function handleResponse(response: Response) {
  if (!response.ok) {
    const message = await response
      .json()
      .then((data) => data.error || response.statusText)
      .catch(() => response.statusText);
    throw new Error(message);
  }
  return response.json();
}

export async function getSession() {
  const response = await fetch(`${basePath}/api/session`, {
    credentials: "include",
  });
  return handleResponse(response);
}

export async function login(username: string, password: string) {
  const response = await fetch(`${basePath}/api/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse(response);
}

export async function logout() {
  const response = await fetch(`${basePath}/api/logout`, {
    method: "POST",
    credentials: "include",
  });
  return handleResponse(response);
}

export async function fetchGifs() {
  const response = await fetch(`${basePath}/api/gifs`, {
    credentials: "include",
  });
  return handleResponse(response);
}

export async function fetchPublicGifs() {
  const response = await fetch(`${basePath}/api/public/gifs`);
  return handleResponse(response);
}

export async function uploadGif(file: File) {
  const formData = new FormData();
  formData.append("gif", file);
  const response = await fetch(`${basePath}/api/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  return handleResponse(response);
}

export function buildShareLink(slug: string) {
  return `${window.location.origin}${basePath}/share/${slug}`;
}

export async function deleteGif(slug: string) {
  const response = await fetch(
    `${basePath}/api/gifs/${encodeURIComponent(slug)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  return handleResponse(response);
}

export async function fetchCategories() {
  const response = await fetch(`${basePath}/api/categories`, {
    credentials: "include",
  });
  return handleResponse(response);
}

export async function createCategory(name: string) {
  const response = await fetch(`${basePath}/api/categories`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  return handleResponse(response);
}

export async function deleteCategory(categoryId: number) {
  const response = await fetch(
    `${basePath}/api/categories/${encodeURIComponent(String(categoryId))}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  return handleResponse(response);
}

export async function updateGifCategories(slug: string, categoryIds: number[]) {
  const response = await fetch(
    `${basePath}/api/gifs/${encodeURIComponent(slug)}/categories`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ categoryIds }),
    },
  );
  return handleResponse(response);
}

export async function importGifs(urls: string[]) {
  const response = await fetch(`${basePath}/api/import`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls }),
  });
  return handleResponse(response);
}
