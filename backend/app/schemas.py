from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field

class HotspotOut(BaseModel):
    id: str; city: str; state: str; sector: str; requests: int; priority: int
    critical_requests: int; high_requests: int; moderate_requests: int; low_requests: int
    lat: float | None; lng: float | None; latest_request_at: datetime

class CitizenRequestCreate(BaseModel):
    message: str = Field(min_length=5, max_length=4000)
    language: str; location: str; sector: str; severity: str; source: str

class CitizenRequestOut(CitizenRequestCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str; ai_status: str; created_at: datetime
    has_recording: bool = False
    has_coordinates: bool = False

class CivicPulseQuery(BaseModel): query: str = Field(min_length=3, max_length=1000)
class CivicPulseResponse(BaseModel): answer: str; hotspot: HotspotOut; disclaimer: str
