from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, Literal
from datetime import datetime

from app.core.phone import normalize_phone as _normalize_phone


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

PASSWORD_ERROR_MSG: dict[str, str] = {
    "length": "Password must have a length of 8 or more characters.\n",
    "upper": "Password must include at least one uppercase letter.\n",
    "lower": "Password must include at least one lowercase letter.\n",
    "number": "Password must include at least one number.\n",
    "symbol": "Password must include at least one special symbol.\n",
    "valid": "Password contains an invalid character.\n"
}

class RegisterRequest(BaseModel):
    email: EmailStr
    phone: str
    password: str
    first_name: str
    last_name: str
    # role is intentionally excluded — all publicly registered users are "user".

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, phone: str) -> str:
        return _normalize_phone(phone)


    @field_validator("password")
    @classmethod
    def check_password(cls, password: str) -> str:
        # must be all true to pass
        checks: dict[str, bool] = {"length": False, "upper": False, "lower": False, "number": False, "symbol": False, "valid": True}
        if len(password) >= 8:
            checks["length"] = True
        
        for c in password:
            value = ord(c)
            if not checks["number"] and c.isdigit():
                checks["number"] = True
                continue
            if not checks["upper"] and c.isupper():
                checks["upper"] = True
                continue
            if not checks["lower"] and c.islower():
                checks["lower"] = True
                continue
            if not checks["symbol"] and (33 <= value <= 47 or 58 <= value <= 64 or 91 <= value <= 96 or 123 <= value <= 126):
                checks["symbol"] = True
                continue
            if value <= 32 or value >= 127:
                checks["valid"] = False
        
        if any(not value for value in checks.values()):
            msg = ""
            for key, value in checks.items():
                if not value:
                    msg += PASSWORD_ERROR_MSG[key]
            
            raise ValueError(msg)
        
        return password
                    


class AdminRegisterRequest(BaseModel):
    email: EmailStr
    # phone excluded b/c user will set themselves when they make their own account
    # password is excluded because when user logs into their new account they will make one themselves
    first_name: str
    last_name: str
    role: Literal["admin", "user"]