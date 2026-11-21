import json
import logging
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email_suppression import record_ses_event
from app.core.sns import InvalidSNSMessage, is_sns_url, verify_sns_message
from app.db.session import get_db

logger = logging.getLogger(__name__)

# Registered without the API key: SNS can't send headers, so the signature check stands in.
router = APIRouter(tags=["webhooks"])


async def _raw_body(request: Request) -> bytes:
    return await request.body()


@router.post("/webhooks/ses/", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
def ses_webhook(body: bytes = Depends(_raw_body), db: Session = Depends(get_db)) -> Response:
    topic_arn = get_settings().ses_sns_topic_arn
    try:
        message = json.loads(body)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body is not JSON") from None
    if not isinstance(message, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Body is not an SNS message")

    if not topic_arn or message.get("TopicArn") != topic_arn:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Unknown topic")
    try:
        verify_sns_message(message)
    except InvalidSNSMessage as e:
        logger.warning("Rejected SNS message: %s", e)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid signature") from None

    if message["Type"] == "SubscriptionConfirmation":
        subscribe_url = message.get("SubscribeURL", "")
        if not is_sns_url(subscribe_url):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "SubscribeURL is not an SNS URL")
        with urllib.request.urlopen(subscribe_url, timeout=10):
            pass
        logger.warning("Confirmed SNS subscription to %s", topic_arn)
    elif message["Type"] == "Notification":
        try:
            event = json.loads(message["Message"])
        except (KeyError, ValueError):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message is not JSON") from None
        record_ses_event(db, event)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
