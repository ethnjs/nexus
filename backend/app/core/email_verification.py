from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt

from app.core.config import get_settings

ALGORITHM = "HS256"
VERIFICATION_TOKEN_EXPIRE_DAYS = 1

def generate_verification_token(user_id: int) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(days=VERIFICATION_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "exp": expire, "aud": "email_verification"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)

def verify_verification_token(token: str) -> Optional[int]:
    """Returns user_id if valid token, or None if invalid/expired/wrong purpose"""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM], audience="email_verification")
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return int(user_id)
    except JWTError:
        return None