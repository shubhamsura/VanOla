# VanOla - Real-Time College Van Tracking System

VanOla is a real-time coordinates broadcasting system designed for college van coordination. It allows drivers to dynamically declare stops and share their location in real-time, and students to track the van on Google Maps road tiles centered on VIT Bhopal.

## 🛠️ Tech Stack
*   **Frontend**: React, TypeScript, Leaflet.js, Google Maps road tiles
*   **Backend**: Node.js, Express, Socket.io, TypeScript
*   **Monorepo**: npm workspaces

---

## 💻 Local Development

1.  Clone the repository and install dependencies at the root:
    ```bash
    npm install
    ```
2.  Start the backend development server (Terminal 1):
    ```bash
    npm run dev:backend
    ```
3.  Start the frontend development server (Terminal 2):
    ```bash
    npm run dev:frontend
    ```

---

## 🌐 Production Cloud Deployment (Vercel + Render)

Follow these steps to host your application on the web for free.

### Step 1: Create a GitHub Repository
1.  Go to [github.com](https://github.com) and create a new **public** or **private** repository named `vanola`.
2.  Follow the commands in your terminal at the root folder to push this codebase:
    ```bash
    git init
    git add .
    git commit -m "Initial commit of VanOla tracking system"
    git branch -M main
    git remote add origin YOUR_GITHUB_REPO_URL
    git push -u origin main
    ```

---

### Step 2: Deploy the Backend to Render (render.com)
Render hosts Node.js Express servers with WebSocket support for free.

1.  Log in to [Render Dashboard](https://dashboard.render.com).
2.  Click **New +** and select **Web Service**.
3.  Connect your `vanola` GitHub repository.
4.  Configure the service with these settings:
    *   **Name**: `vanola-backend`
    *   **Language**: `Node`
    *   **Region**: Select the closest region (e.g. Singapore for India/VIT Bhopal).
    *   **Branch**: `main`
    *   **Build Command**: `npm install && npm run build --workspace=backend`
    *   **Start Command**: `node backend/dist/server.js`
5.  Click **Deploy Web Service**.
6.  Once deployed, copy your web service URL (e.g., `https://vanola-backend.onrender.com`).

---

### Step 3: Deploy the Frontend to Vercel (vercel.com)
Vercel is the easiest place to host static React/Vite websites.

1.  Log in to [Vercel Dashboard](https://vercel.com/dashboard).
2.  Click **Add New...** and select **Project**.
3.  Import your `vanola` GitHub repository.
4.  Configure the build settings:
    *   **Framework Preset**: `Vite`
    *   **Root Directory**: Set to `frontend` (Click **Edit** next to Root Directory and select the `frontend` folder).
    *   *Leave Build and Output settings to defaults (Vercel automatically detects Vite settings).*
5.  Open the **Environment Variables** section and add:
    *   **Key**: `VITE_BACKEND_URL`
    *   **Value**: Paste your Render URL (e.g., `https://vanola-backend.onrender.com`).
6.  Click **Deploy**.
7.  Vercel will build the frontend and provide a public URL. Share this URL with your driver and students to start tracking!
