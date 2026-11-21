import logging
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.models import EmailSuppression, User

logger = logging.getLogger(__name__)


def find_suppression(db: Session, email: str) -> EmailSuppression | None:
    return db.query(EmailSuppression).filter(EmailSuppression.email == email.lower()).first()


def blocks_email(db: Session, email: str, *, unsolicited: bool = False) -> bool:
    """Whether to skip an email to `email`. A complaint blocks only email the recipient didn't
    ask for, since codes and resets are requested moments before they're sent."""
    suppression = find_suppression(db, email)
    if suppression is None:
        return False
    return suppression.reason == "bounce" or unsolicited


def _recipients(entries: list[dict[str, Any]]) -> list[str]:
    return [entry["emailAddress"].lower() for entry in entries if entry.get("emailAddress")]


def record_ses_event(db: Session, event: dict[str, Any]) -> None:
    """Records the permanent bounces and complaints in an SES event, and commits.

    Accepts both configuration set events (eventType) and identity notifications
    (notificationType). Transient bounces are ignored, since SES retries those itself.
    """
    event_type = event.get("eventType") or event.get("notificationType")
    message_id = event.get("mail", {}).get("messageId")

    if event_type == "Bounce":
        bounce = event.get("bounce", {})
        if bounce.get("bounceType") != "Permanent":
            return
        emails = _recipients(bounce.get("bouncedRecipients", []))
        for email in emails:
            row = {
                "email": email,
                "reason": "bounce",
                "detail": bounce.get("bounceSubType"),
                "ses_message_id": message_id,
            }
            # A bounce outranks an earlier complaint: the address can't receive anything.
            db.execute(
                insert(EmailSuppression)
                .values(**row)
                .on_conflict_do_update(index_elements=["email"], set_=row)
            )
        if emails:
            db.query(User).filter(User.email.in_(emails)).update(
                {"email_verified": False}, synchronize_session=False
            )
        logger.warning("SES permanent bounce, suppressing %s", ", ".join(emails))
    elif event_type == "Complaint":
        complaint = event.get("complaint", {})
        emails = _recipients(complaint.get("complainedRecipients", []))
        for email in emails:
            db.execute(
                insert(EmailSuppression)
                .values(
                    email=email,
                    reason="complaint",
                    detail=complaint.get("complaintFeedbackType"),
                    ses_message_id=message_id,
                )
                .on_conflict_do_nothing(index_elements=["email"])
            )
        logger.warning("SES complaint, suppressing unrequested email to %s", ", ".join(emails))
    else:
        return

    db.commit()
