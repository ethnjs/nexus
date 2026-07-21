from pydantic import BaseModel
from typing import Optional


class CompetitionExperienceResponse(BaseModel):
    id: int
    event_id: int
    school: str
    notes: Optional[str] = None

    model_config = {"from_attributes": True}


class VolunteerExperienceNotes(BaseModel):
    event: Optional[str] = None
    other: Optional[str] = None

class VolunteerExperienceResponse(BaseModel):
    id: int
    
    tournament_name: str
    year: int
    event_id: Optional[int] = None
    role: str

    notes: Optional[VolunteerExperienceNotes] = None

    model_config = {"from_attributes": True}
