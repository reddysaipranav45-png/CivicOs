from datetime import datetime
from sqlalchemy import DateTime, Float, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

class Hotspot(Base):
    __tablename__ = "hotspots"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    sector: Mapped[str] = mapped_column(String(100))
    requests: Mapped[int] = mapped_column(Integer)
    priority: Mapped[int] = mapped_column(Integer)
    population: Mapped[str] = mapped_column(String(30))
    funding: Mapped[str] = mapped_column(String(40))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    gap: Mapped[str] = mapped_column(String(30))
    trend: Mapped[str] = mapped_column(String(30))

class CitizenRequest(Base):
    __tablename__ = "citizen_requests"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    message: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(50))
    location: Mapped[str] = mapped_column(String(180))
    sector: Mapped[str] = mapped_column(String(100))
    severity: Mapped[str] = mapped_column(String(30))
    source: Mapped[str] = mapped_column(String(50))
    ai_status: Mapped[str] = mapped_column(String(50), default="Processed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    recording_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, deferred=True)
    recording_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    @property
    def has_recording(self) -> bool:
        return self.recording_mime_type is not None

    @property
    def has_coordinates(self) -> bool:
        return self.latitude is not None and self.longitude is not None
