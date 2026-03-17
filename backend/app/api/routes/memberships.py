from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.models import Membership, User, Tournament, Event
from app.schemas.membership import MembershipCreate, MembershipRead, MembershipUpdate

router = APIRouter(prefix="/memberships", tags=["memberships"])


def _serialize(m: Membership) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "tournament_id": m.tournament_id,
        "assigned_event_id": m.assigned_event_id,
        "status": m.status,
        "roles": m.roles,
        "role_preference": m.role_preference,
        "event_preference": m.event_preference,
        "general_volunteer_interest": m.general_volunteer_interest,
        "availability": m.availability,
        "lunch_order": m.lunch_order,
        "notes": m.notes,
        "extra_data": m.extra_data,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
    }


@router.get("/tournament/{tournament_id}/", response_model=list[MembershipRead])
def list_memberships(
    tournament_id: int,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    tournament = db.query(Tournament).filter(Tournament.id == tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")
    query = db.query(Membership).filter(Membership.tournament_id == tournament_id)
    if status:
        query = query.filter(Membership.status == status)
    return [_serialize(m) for m in query.order_by(Membership.id).all()]


@router.post("/", response_model=MembershipRead, status_code=status.HTTP_201_CREATED)
def create_membership(payload: MembershipCreate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    tournament = db.query(Tournament).filter(Tournament.id == payload.tournament_id).first()
    if not tournament:
        raise HTTPException(status_code=404, detail="Tournament not found")

    if payload.assigned_event_id:
        event = db.query(Event).filter(
            Event.id == payload.assigned_event_id,
            Event.tournament_id == payload.tournament_id,
        ).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found in this tournament")

    existing = db.query(Membership).filter(
        Membership.user_id == payload.user_id,
        Membership.tournament_id == payload.tournament_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Membership already exists for this user and tournament")

    data = payload.model_dump()
    if data.get("availability"):
        data["availability"] = [s.model_dump() for s in payload.availability]

    membership = Membership(**data)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return _serialize(membership)


@router.get("/{membership_id}/", response_model=MembershipRead)
def get_membership(membership_id: int, db: Session = Depends(get_db)):
    m = db.query(Membership).filter(Membership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    return _serialize(m)


@router.patch("/{membership_id}/", response_model=MembershipRead)
def update_membership(membership_id: int, payload: MembershipUpdate, db: Session = Depends(get_db)):
    m = db.query(Membership).filter(Membership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")

    if payload.assigned_event_id is not None:
        event = db.query(Event).filter(
            Event.id == payload.assigned_event_id,
            Event.tournament_id == m.tournament_id,
        ).first()
        if not event:
            raise HTTPException(status_code=404, detail="Event not found in this tournament")

    update_data = payload.model_dump(exclude_none=True)

    if "availability" in update_data and payload.availability:
        update_data["availability"] = [s.model_dump() for s in payload.availability]

    if "roles" in update_data and payload.roles:
        merged_roles = dict(m.roles or {})
        merged_roles.update(payload.roles)
        update_data["roles"] = merged_roles

    if "extra_data" in update_data and payload.extra_data:
        merged_extra = dict(m.extra_data or {})
        merged_extra.update(payload.extra_data)
        update_data["extra_data"] = merged_extra

    for field, value in update_data.items():
        setattr(m, field, value)

    db.commit()
    db.refresh(m)
    return _serialize(m)


@router.delete("/{membership_id}/", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(membership_id: int, db: Session = Depends(get_db)):
    m = db.query(Membership).filter(Membership.id == membership_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    db.delete(m)
    db.commit()