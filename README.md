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

Create a `.env` file in the root directory (copy from `.env.example`):

```bash
cp .env.example .env
```

Configure the following variables:

```properties
PORT=3000
HOST=0.0.0.0
ADMIN_USERNAME=your_admin_user
ADMIN_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret_key
```

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
