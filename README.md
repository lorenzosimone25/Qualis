<div align="center">

# Qualis · Web

**An AI-powered intelligence for precision quality metrics**

*⚛️ React · 📘 TypeScript · ⚡ Vite · 🎨 Tailwind — hospital quality, made legible.*

<br/>

![Qualis system architecture: relational CMS data, grounded FastAPI tool layer, and research outputs](qualis.png)

*🧩 Reasoning across relational tables: longitudinal CMS-style measures are harmonized into queryable structure, exposed through a controlled API for grounded agents, and synthesized into title, abstract, and findings with evidence traceability.*

<br/>

</div>

---

## 🏥 Overview

**Qualis** is the interactive front end for CMS hospital quality analytics. It pairs a **data-rich dashboard** with a **Research** workspace so you can scan the country, drill into states and hospitals, and ask questions in plain language—while charts, tables, and summaries stay visually calm and consistent in light or dark mode.

The architecture diagram above summarizes the full stack: **1️⃣** harmonized hospital, measure, geography, and time dimensions backing a clinical performance view of the data; **2️⃣** a **FastAPI** surface that exposes bounded, tool-like operations so agents never bypass the real dataset; **3️⃣** research-style outputs (title, abstract, key findings) grounded in retrieved series and metadata, not free-form guesswork. The browser only talks to FastAPI; **🔐 API keys and model configuration stay on the server.**

---

## ✨ Highlights

| | |
| :---: | :--- |
| 📊 **Dashboard** | State **honeycomb** map, measure-aware summaries, **Recharts** trend and comparison cards, and **TanStack Table** hospital grids tuned for scanning. |
| 🔬 **Research** | Prompt-driven flow with progress and **grounded** narrative output; LLM calls are mediated by the Python service. |
| 🗺️ **Geography** | State browser and ranking affordances; optional **`/rankings/hospitals`** enriches top and bottom strips when the API exposes it. |
| ✨ **Polish** | **Framer Motion**, CSS-variable theming (violet → blue accents), and a shell layout built for long research sessions. |

---

## 🧱 Stack (frontend)

```
React 19          TypeScript        Vite 8
Tailwind CSS 4    TanStack Query    TanStack Table
Recharts          Framer Motion     React Router 7
react-markdown    remark-gfm        cmdk
```

---

## 📦 Prerequisites

- 📗 **Node.js** (current LTS recommended) and **npm**
- 🐍 **Python 3.10+** with dependencies from the repository **`requirements.txt`** (sibling of the `dashboard/` package, not inside `web/`)
- 📊 **Processed CMS data** at the repository root in a **`processed/`** directory (same layout the `dashboard` package expects when you run the API)

---

## 🚀 Quick start (full stack)

Run the **API** and the **Vite dev server** in two terminals. Commands below use **repository root** = the folder that contains `web/`, `dashboard/`, and `processed/`.

### 1️⃣ Backend — FastAPI

```bash
# From repository root (parent of this web/ folder)
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate

pip install -r requirements.txt

uvicorn dashboard.api_app:app --reload --host 127.0.0.1 --port 8765
```

- 📖 Interactive docs: **http://127.0.0.1:8765/docs**
- ✅ Quick health-style checks: use the docs UI or call routes listed there (for example **`GET /research/health`** for research configuration status).

`dashboard.api_app` loads an optional **`.env`** file from the **repository root** (next to `dashboard/`) so you can set Ollama-related variables without exporting them in the shell.

### 2️⃣ Frontend — Vite

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

In development, requests to **`/api`** are **proxied** to **`http://127.0.0.1:8765`**, and the path prefix is rewritten so the FastAPI app receives routes at `/` (not `/api`). That avoids CORS setup for local work.

| Command | |
| :--- | :--- |
| `npm run build` | Typecheck and emit production assets |
| `npm run preview` | Serve the built `dist` |
| `npm run lint` | ESLint over the app |

---

## 🔌 Configuration

### ⚡ Frontend (`web/` — Vite)

Set these in **`web/.env`**, **`web/.env.local`**, or your shell when invoking `npm run dev` / `npm run build`.

| Variable | Role |
| :--- | :--- |
| `VITE_USE_MOCK=true` | Use bundled **fixtures** only—no live API. Useful for UI work without Python. |
| `VITE_API_BASE_URL` | Override the API origin. **In dev, omit** to keep the default **`/api`** proxy to port `8765`. For a non-proxy setup, set a full origin (for example `https://your-api.example.com`). |
| `VITE_RESEARCH_DEBUG=true` | Optional extra research debugging in the UI (in addition to dev mode). |

### 🐍 Backend (repository root — Python / Ollama)

Create **`.env`** at the **repository root** (where `load_dotenv` runs in `dashboard/api_app.py`). 🔑 Do **not** commit real secrets.

| Variable | Role |
| :--- | :--- |
| `OLLAMA_API_KEY` or `CMS_QUALITY_OLLAMA_API_KEY` | API key for **Ollama Cloud**–style HTTP chat. If unset, research features that need a model will stay in stub or degraded mode; **`GET /research/health`** reports whether the backend considers Ollama configured. |
| `CMS_QUALITY_OLLAMA_BASE_URL` | Optional. Defaults to Ollama’s cloud API base URL if unset. |
| `CMS_QUALITY_OLLAMA_MODEL` | Optional model slug for server-side calls (see `dashboard/research/llm_provider.py` for defaults). |
| `CMS_QUALITY_USE_PARQUET` | Set to `1` / `true` / `yes` to prefer **`master_long.parquet`** beside the CSV under `processed/merged/` when present (faster load, lower peak RAM). |
| `CMS_QUALITY_METRIC_LLM_PICKER` | Optional; set to `1` / `true` / `yes` to enable certain metric-selection LLM paths in research (see `dashboard/research/service.py`). |

---

## 🗂️ Source map

| Area | Path |
| :--- | :--- |
| Routes | `src/pages` — `/` (Dashboard), `/research` (Research) |
| Research experience | `src/features/research` |
| Dashboard and charts | `src/components/dashboard`, `src/components/charts` |
| API clients | `src/services` |
| App chrome | `src/components/layout`, `src/context` |

---

<div align="center">

**Qualis Web** — *📈 clarity for hospital quality data.*

</div>
