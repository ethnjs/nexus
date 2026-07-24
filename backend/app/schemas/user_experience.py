from pydantic import BaseModel, model_validator
from typing import Optional

from app.schemas.event import EventResponse


class CompetitionExperienceCreate(BaseModel):
    event_id: int
    school: str
    notes: Optional[str] = None

class CompetitionExperienceUpdate(BaseModel):
    event_id: Optional[int] = None
    school: Optional[str] = None
    notes: Optional[str] = None

class CompetitionExperienceResponse(BaseModel):
    id: int
    event: EventResponse
    school: str
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class VolunteerExperienceNotes(BaseModel):
    event: Optional[str] = None
    other: Optional[str] = None

class VolunteerExperienceCreate(BaseModel):
    tournament_name: str
    year: int
    event_id: Optional[int] = None
    role: str
    notes: Optional[VolunteerExperienceNotes] = None

    @model_validator(mode="after")
    def check_event_exclusivity(self):
        if self.event_id is not None and self.notes and self.notes.event:
            raise ValueError("event_id and notes.event are mutually exclusive")
        return self

class VolunteerExperienceUpdate(BaseModel):
    tournament_name: Optional[str] = None
    year: Optional[int] = None
    event_id: Optional[int] = None
    role: Optional[str] = None
    notes: Optional[VolunteerExperienceNotes] = None

class VolunteerExperienceResponse(BaseModel):
    id: int
    
    tournament_name: str
    year: int
    event: Optional[EventResponse] = None
    role: str

    notes: Optional[VolunteerExperienceNotes] = None

    model_config = {"from_attributes": True}
