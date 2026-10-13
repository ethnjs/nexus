from pydantic import BaseModel, model_validator

from app.schemas.event import EventResponse


class CompetitionExperienceCreate(BaseModel):
    event_id: int
    school: str
    notes: str | None = None


class CompetitionExperienceUpdate(BaseModel):
    event_id: int | None = None
    school: str | None = None
    notes: str | None = None


class CompetitionExperienceResponse(BaseModel):
    id: int
    event: EventResponse
    school: str
    notes: str | None = None

    model_config = {"from_attributes": True}


class VolunteerExperienceNotes(BaseModel):
    event: str | None = None
    other: str | None = None


class VolunteerExperienceCreate(BaseModel):
    tournament_name: str
    year: int
    event_id: int | None = None
    role: str
    notes: VolunteerExperienceNotes | None = None

    @model_validator(mode="after")
    def check_event_exclusivity(self):
        if self.event_id is not None and self.notes and self.notes.event:
            raise ValueError("event_id and notes.event are mutually exclusive")
        return self


class VolunteerExperienceUpdate(BaseModel):
    tournament_name: str | None = None
    year: int | None = None
    event_id: int | None = None
    role: str | None = None
    notes: VolunteerExperienceNotes | None = None


class VolunteerExperienceResponse(BaseModel):
    id: int

    tournament_name: str
    year: int
    event: EventResponse | None = None
    role: str

    notes: VolunteerExperienceNotes | None = None

    model_config = {"from_attributes": True}
