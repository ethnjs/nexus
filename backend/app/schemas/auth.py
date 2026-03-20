from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # role is intentionally excluded — all registered users are "user".
    # Admin accounts are created directly in the DB or via a future
    # admin-promotion endpoint.


class UserResponse(BaseModel):
    id: int
    email: str
    first_name: Optional[str]
    last_name: Optional[str]
    role: str          # "admin" | "user"
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}