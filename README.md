# GIF Selector

A simple web application for managing, categorizing, and viewing your personal collection of GIFs. Built with a React frontend and a Node.js/Express backend.

## Features

- **Gallery View**: Browse your collection of GIFs.
- **Category Management**: Organize GIFs into custom categories.
- **Upload**: Drag-and-drop interface for adding new GIFs.
- **Authentication**: Admin login to protect your collection and uploads.
- **Responsive Design**: Built with Vite and React for a modern, fast experience.

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Backend**: Node.js, Express
- **Database**: SQLite (via `sql.js`)
- **Authentication**: JWT

## Prerequisites

- Node.js 24+ (if running locally)
- Docker (optional, for containerized deployment)

## Environment Configuration

This project is split into a **backend** and a **frontend**, each requiring its own configuration.

### Backend

Create a `.env` file in the `backend/` directory:

```bash
cd backend
cp .env.example .env
```

Common variables:

| Variable            | Description                           | Default          |
| :------------------ | :------------------------------------ | :--------------- |
| `PORT`              | Port for the backend server           | `3000`           |
| `BACKEND_BASE_PATH` | Base URL path for the API             | `/gifselector`   |
| `ADMIN_USERNAME`    | Username for login                    | `admin`          |
| `ADMIN_PASSWORD`    | Password for login                    | `change-me`      |
| `JWT_SECRET`        | Secret key for signing session tokens | `dev-secret-...` |

### Frontend

Create a `.env` file in the `frontend/` directory:

```bash
cd frontend
cp .env.example .env
```

Available options:

| Variable                   | Description                               | Example |
| :------------------------- | :---------------------------------------- | :------ |
| `VITE_DEFAULT_CATEGORY_ID` | (Optional) Category ID to load by default | `5`     |

### Docker Runtime Variables

When running with Docker, you can pass these environment variables to the container to configure the instance at runtime.

Example:

```bash
docker run -e PORT=8080 -e ADMIN_PASSWORD=supersecure ... gifselector
```

**Key Docker Variables:**

- `PORT`: Listen port inside container.
- `ADMIN_USERNAME`: Admin User.
- `ADMIN_PASSWORD`: Admin Password.
- `JWT_SECRET`: Security key.
- `UPLOAD_DIR`: Path to store uploads (default: `/app/backend/uploads`).
- `BASE_PATH`: Subdirectory where app gets served.

## Running the Project

### Using Docker (Recommended)

1.  **Build the image:**

    ```bash
    docker build -t gifselector .
    ```

2.  **Run the container:**

    Be sure to mount the `data` directory if you want to persist your database and uploads.

    ```bash
    docker run -p 3000:3000 \
      -v $(pwd)/backend/data:/app/backend/data \
      -v $(pwd)/backend/uploads:/app/backend/uploads \
      --env-file .env \
      gifselector
    ```

### Local Development

1.  **Install dependencies:**

    ```bash
    # Install backend dependencies
    npm install --prefix backend

    # Install frontend dependencies
    npm install --prefix frontend
    ```

2.  **Start the Backend:**

    ```bash
    cd backend
    npm run dev
    ```

    The backend runs on `http://localhost:3000`.

3.  **Start the Frontend:**

    Open a new terminal:

    ```bash
    cd frontend
    npm run dev
    ```

    The frontend runs on `http://localhost:5173`.

### Production Build (Manual)

To run the full stack locally as it would in production:

1.  Build the frontend:
    ```bash
    cd frontend
    npm run build
    ```
2.  Start the backend (it serves the static frontend files from `dist`):
    ```bash
    cd backend
    npm start
    ```

## Storage

The application stores data in `backend/data` (SQLite database) and uploaded files in `backend/uploads`. Ensure these directories are writable.
