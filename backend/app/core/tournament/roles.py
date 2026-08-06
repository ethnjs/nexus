"""
Sparse-rank assignment logic for TournamentRole drag-to-reorder.

Ranks are plain Integer columns (lower = higher authority). Reordering never
renumbers everything on every move — new roles slot into the gap between
their neighbors' ranks, and only fall back to a full rebalance when there's
no integer room left between two adjacent ranks.
"""
from __future__ import annotations
from typing import Literal

from sqlalchemy.orm import Session

RANK_GAP = 10

DropType = Literal["join_group", "new_rank_between", "new_rank_at_top", "new_rank_at_bottom"]


def compute_new_rank(drop_type: DropType, **kwargs) -> int | None:
    """
    Returns the new rank value, or None if a rebalance is needed first
    (no integer room left between the two neighboring ranks).
    """
    if drop_type == "join_group":
        return kwargs["target_group_rank"]

    if drop_type == "new_rank_between":
        above, below = kwargs["rank_above"], kwargs["rank_below"]
        midpoint = (above + below) // 2
        if midpoint == above or midpoint == below:
            return None
        return midpoint

    if drop_type == "new_rank_at_top":
        return kwargs["rank_below"] - RANK_GAP  # may be <= 0, caller checks

    if drop_type == "new_rank_at_bottom":
        return kwargs["rank_above"] + RANK_GAP

    raise ValueError(f"Unknown drop_type: {drop_type}")


def rebalance_tournament_ranks(db: Session, tournament_id: int) -> dict[int, int]:
    """
    Reassigns every distinct rank in the tournament to 10, 20, 30... in order,
    preserving relative order and existing ties. Does not commit — caller is
    expected to be mid-transaction with the reorder itself.

    Returns the old-rank -> new-rank remap so the caller can translate any
    rank values it captured before calling this (e.g. neighbor ranks from a
    reorder request that's about to retry against the rebalanced ranks).
    """
    from app.models.models import TournamentRole

    roles = (
        db.query(TournamentRole)
        .filter(TournamentRole.tournament_id == tournament_id)
        .order_by(TournamentRole.rank)
        .all()
    )
    distinct_old_ranks = sorted({r.rank for r in roles})
    remap = {old: (i + 1) * RANK_GAP for i, old in enumerate(distinct_old_ranks)}
    for r in roles:
        r.rank = remap[r.rank]
    return remap
