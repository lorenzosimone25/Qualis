<div align="center">

# Qualis · Web

**An AI-powered intelligence for precision quality metrics**

*⚛️ React · 📘 TypeScript · ⚡ Vite · 🎨 Tailwind — hospital quality, made legible.*

<br/>

</div>

---

## 🏥 Overview

**Qualis** is the interactive front end for CMS hospital quality analytics. It pairs a **data-rich dashboard** with a **Research** workspace so you can scan the country, drill into states and hospitals, and ask questions in plain language—while charts, tables, and summaries stay visually calm and consistent in light or dark mode.

---

## ✨ Highlights

| | |
| :---: | :--- |
| 📊 **Dashboard** | State **honeycomb** map, measure-aware summaries, **Recharts** trend and comparison cards, and **TanStack Table** hospital grids tuned for scanning. |
| 🔬 **Research** | Prompt-driven flow with progress and **grounded** narrative output; the browser talks only to your **FastAPI** layer—LLM keys and models stay on the server. |
| 🗺️ **Geography** | State browser and ranking affordances; optional **`/rankings/hospitals`** enriches top/bottom strips when the API exposes it. |
| ✨ **Polish** | **Framer Motion** motion, CSS-variable theming (violet → blue accents), and a shell layout built for long research sessions. |

---

## 🧱 Stack at a glance

```
React 19          TypeScript        Vite 8
Tailwind CSS 4    TanStack Query    TanStack Table
Recharts          Framer Motion     React Router 7
react-markdown    remark-gfm        cmdk
```

---

## 🚀 Quick start

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173**. In development, **`/api` is proxied** to `http://127.0.0.1:8765` so the FastAPI app can run without CORS configuration.

| Command | |
| :--- | :--- |
| `npm run build` | Typecheck and emit production assets |
| `npm run preview` | Serve the built `dist` |
| `npm run lint` | ESLint over the app |

---

## 🔌 Configuration

| Variable | Role |
| :--- | :--- |
| `VITE_USE_MOCK=true` | Run against bundled **fixtures**—ideal for UI work without a backend. |
| `VITE_API_BASE_URL` | Override API origin; in dev, omit to keep the default **`/api`** proxy. |

The UI calls **`GET /research/health`** to surface whether the research backend is configured. For Ollama Cloud and model selection, set variables on the **Python** process (see the repository root **`.env.example`**); never commit real secrets.

---

## 🗂️ Source map

| Area | Path |
| :--- | :--- |
| Routes | `src/pages` — `/` (Dashboard), `/research` (Research) |
| Research experience | `src/features/research` |
| Dashboard & charts | `src/components/dashboard`, `src/components/charts` |
| API clients | `src/services` |
| App chrome | `src/components/layout`, `src/context` |

---

<div align="center">

**Qualis Web** — *📈 clarity for hospital quality data.*

</div>
