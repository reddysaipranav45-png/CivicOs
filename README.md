# CivicOS

Run locally with Node 20+:

```bash
npm install
npm run dev
```

The React frontend reads citizen requests and derived location/sector hotspot groups from the FastAPI backend. Open the Vite URL (usually `http://localhost:5173`).

## Run the optional backend

The included FastAPI backend exposes request, analytics, and derived-hotspot endpoints at `http://localhost:8000/docs`.

```bash
docker compose up --build
```

Copy `.env.example` to `.env` before starting the frontend to enable API calls in the service layer:

```bash
cp .env.example .env
npm run dev
```

Citizen requests are stored in PostgreSQL/Supabase. Hotspots are calculated from requests grouped by normalized location text and sector; priority is a severity-weighted index, not an AI prediction. On submission, the location text is sent to OpenStreetMap Nominatim for geocoding. This is rate-limited; the request still saves and contributes to analytics if geocoding does not find a location.

### Use Supabase PostgreSQL

1. Create a Supabase project and open **Connect**. Copy a PostgreSQL connection string; use the session pooler if the direct connection is unavailable from your network.
2. Copy `.env.example` to `.env` in the project root. Set `DATABASE_URL` to the Supabase URL, using the `postgresql+psycopg://` scheme required by this backend. Keep the database password out of source control.
3. Start the API with `docker compose up --build`. It uses Supabase when `DATABASE_URL` is set; otherwise, it uses the local PostGIS container. The API creates empty tables on startup; submitted requests drive the hotspot groups and analytics.
4. In a second terminal, run `npm run dev` to start the frontend.
5. Check `http://localhost:8000/docs` and the Vite URL, usually `http://localhost:5173`.

### Connect to locally installed PostgreSQL (without Docker)

1. Create a `civicos` database and enable PostGIS in your PostgreSQL client:

```sql
CREATE DATABASE civicos;
\c civicos
CREATE EXTENSION IF NOT EXISTS postgis;
```

2. Copy `backend/.env.example` to `backend/.env`, then replace the username and password in `DATABASE_URL` with your local PostgreSQL role.

3. Start the API from the `backend` directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

FastAPI creates empty tables automatically on first successful database connection. Use `POST /api/requests` to add citizen requests; hotspots are derived automatically from those requests. Check `http://localhost:8000/docs`.
