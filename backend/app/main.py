import asyncio
import os
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime
from time import monotonic
from uuid import NAMESPACE_URL, uuid4, uuid5
import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from .database import Base, engine, get_db
from .models import CitizenRequest, Hotspot
from .schemas import CitizenRequestCreate, CitizenRequestOut, CivicPulseQuery, CivicPulseResponse, HotspotOut

MAX_RECORDING_BYTES = 10 * 1024 * 1024
_geocode_cache: dict[str, tuple[float, float] | None] = {}
_geocode_lock = asyncio.Lock()
_last_geocode_at = 0.0

async def geocode_location(location: str) -> tuple[float, float] | None:
    global _last_geocode_at
    key = " ".join(location.casefold().split())
    if key in _geocode_cache:
        return _geocode_cache[key]
    async with _geocode_lock:
        if key in _geocode_cache:
            return _geocode_cache[key]
        delay = 1.0 - (monotonic() - _last_geocode_at)
        if delay > 0:
            await asyncio.sleep(delay)
        _last_geocode_at = monotonic()
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                response = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": location, "format": "jsonv2", "limit": 1, "countrycodes": "in"},
                    headers={"User-Agent": "CivicOS/0.1 local prototype"},
                )
                response.raise_for_status()
                results = response.json()
                coordinates = (float(results[0]["lat"]), float(results[0]["lon"])) if results else None
        except (httpx.HTTPError, KeyError, ValueError, IndexError):
            coordinates = None
        _geocode_cache[key] = coordinates
        return coordinates

def hotspot_out(rows: list[CitizenRequest]) -> list[dict]:
    groups: dict[tuple[str, str], list[CitizenRequest]] = defaultdict(list)
    for row in rows:
        groups[(" ".join(row.location.casefold().split()), row.sector)].append(row)
    results = []
    weights = {"low": 1, "moderate": 2, "high": 3, "critical": 4}
    for (location_key, sector), records in groups.items():
        location = records[0].location.strip()
        parts = [part.strip() for part in location.split(",")]
        severities = {severity: sum(record.severity.casefold() == severity for record in records) for severity in weights}
        score = round(sum(severities[level] * weight for level, weight in weights.items()) / (len(records) * 4) * 100)
        coordinates = next(((row.latitude, row.longitude) for row in records if row.latitude is not None and row.longitude is not None), (None, None))
        latest = max(row.created_at for row in records)
        results.append({
            "id": str(uuid5(NAMESPACE_URL, f"{location_key}|{sector}")),
            "city": parts[0], "state": ", ".join(parts[1:]), "sector": sector,
            "requests": len(records), "priority": score,
            "critical_requests": severities["critical"], "high_requests": severities["high"],
            "moderate_requests": severities["moderate"], "low_requests": severities["low"],
            "lat": coordinates[0], "lng": coordinates[1], "latest_request_at": latest,
        })
    return sorted(results, key=lambda item: (item["priority"], item["requests"]), reverse=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE citizen_requests ADD COLUMN IF NOT EXISTS recording_data BYTEA"))
        connection.execute(text("ALTER TABLE citizen_requests ADD COLUMN IF NOT EXISTS recording_mime_type VARCHAR(100)"))
        connection.execute(text("ALTER TABLE citizen_requests ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"))
        connection.execute(text("ALTER TABLE citizen_requests ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"))
    yield

app=FastAPI(title="CivicOS API",version="0.1.0",description="Prototype decision-support API. All dataset values are illustrative.",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=os.getenv("CORS_ORIGINS","http://localhost:5173").split(","),allow_credentials=True,allow_methods=["*"],allow_headers=["*"])

@app.get("/health")
def health(): return {"status":"operational","mode":"prototype","database":"PostgreSQL/PostGIS"}

@app.get("/api/hotspots",response_model=list[HotspotOut])
def list_hotspots(sector:str|None=None,state:str|None=None,db:Session=Depends(get_db)):
    rows = list(db.scalars(select(CitizenRequest).order_by(CitizenRequest.created_at.asc())))
    hotspots = hotspot_out(rows)
    return [row for row in hotspots if (not sector or row["sector"] == sector) and (not state or row["state"] == state)]

@app.get("/api/hotspots/{hotspot_id}",response_model=HotspotOut)
def get_hotspot(hotspot_id:str,db:Session=Depends(get_db)):
    rows = list(db.scalars(select(CitizenRequest).order_by(CitizenRequest.created_at.asc())))
    row = next((item for item in hotspot_out(rows) if item["id"] == hotspot_id), None)
    if not row: raise HTTPException(404,"Hotspot not found")
    return row

@app.get("/api/requests",response_model=list[CitizenRequestOut])
def list_requests(sector:str|None=None,db:Session=Depends(get_db)):
    q=select(CitizenRequest).order_by(CitizenRequest.created_at.desc())
    if sector: q=q.where(CitizenRequest.sector==sector)
    return list(db.scalars(q))

@app.delete("/api/requests",status_code=204)
def delete_all_requests(db:Session=Depends(get_db)):
    db.query(CitizenRequest).delete()
    db.commit()

@app.post("/api/requests",response_model=CitizenRequestOut,status_code=201)
async def create_request(
    message: str = Form(..., min_length=5, max_length=4000),
    language: str = Form(...),
    location: str = Form(...),
    sector: str = Form(...),
    severity: str = Form(...),
    source: str = Form(...),
    recording: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    # Stub extraction: preserve user input; future NLP service supplies classification and geocoding.
    payload = CitizenRequestCreate(message=message, language=language, location=location, sector=sector, severity=severity, source=source)
    record=CitizenRequest(id=f"CIV-{str(uuid4().int)[:5]}",**payload.model_dump())
    coordinates = await geocode_location(location)
    if coordinates:
        record.latitude, record.longitude = coordinates
    if recording is not None:
        if not recording.content_type or not recording.content_type.startswith("audio/"):
            raise HTTPException(415, "Recording must be an audio file")
        content = await recording.read(MAX_RECORDING_BYTES + 1)
        if not content:
            raise HTTPException(400, "Recording is empty")
        if len(content) > MAX_RECORDING_BYTES:
            raise HTTPException(413, "Recording must be 10 MB or smaller")
        record.recording_data = content
        record.recording_mime_type = recording.content_type
    db.add(record); db.commit(); db.refresh(record); return record

@app.get("/api/requests/{request_id}/recording")
def get_request_recording(request_id: str, db: Session = Depends(get_db)):
    record = db.get(CitizenRequest, request_id)
    if not record or not record.has_recording:
        raise HTTPException(404, "Recording not found")
    return Response(content=record.recording_data, media_type=record.recording_mime_type, headers={"Content-Disposition": "inline"})

@app.get("/api/analytics")
def analytics(db:Session=Depends(get_db)):
    rows = list(db.scalars(select(CitizenRequest)))
    sectors: dict[str, int] = defaultdict(int)
    sources: dict[str, int] = defaultdict(int)
    severities: dict[str, int] = defaultdict(int)
    months: dict[str, int] = defaultdict(int)
    for row in rows:
        sectors[row.sector] += 1
        sources[row.source] += 1
        severities[row.severity] += 1
        months[row.created_at.strftime("%Y-%m")] += 1
    return {"totalRequests":len(rows),"demandBySector":[{"name":name,"value":value} for name,value in sectors.items()],"requestsBySource":[{"name":name,"value":value} for name,value in sources.items()],"requestsByMonth":[{"name":name,"value":value} for name,value in sorted(months.items())],"severityDistribution":dict(severities)}

@app.post("/api/civicpulse",response_model=CivicPulseResponse)
def civicpulse(payload:CivicPulseQuery,db:Session=Depends(get_db)):
    rows = list(db.scalars(select(CitizenRequest).order_by(CitizenRequest.created_at.asc())))
    hotspots = hotspot_out(rows)
    if not hotspots: raise HTTPException(404,"No citizen-request data available")
    query = payload.query.casefold()
    match = next((item for item in hotspots if item["city"].casefold() in query or item["sector"].casefold() in query), hotspots[0])
    answer = f"{match['city']} has {match['requests']} citizen request(s) in {match['sector']}: {match['critical_requests']} critical, {match['high_requests']} high, {match['moderate_requests']} moderate, and {match['low_requests']} low. Its severity-based priority index is {match['priority']}/100."
    return {"answer":answer,"hotspot":match,"disclaimer":"Summary calculated from submitted requests. Priority is a transparent severity-weighted index, not an AI or policy decision."}
