from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..database import get_db
from ..models import User
from ..schemas import LoginRequest, PasswordChange, TokenOut, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["Anmeldung"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        audit.log(db, None, "LOGIN_FAILED", "user", user.id if user else "", f"Fehlgeschlagene Anmeldung: {body.username[:64]}")
        db.commit()
        raise HTTPException(status_code=401, detail="Benutzername oder Passwort falsch")
    audit.log(db, user, "LOGIN", "user", user.id, f"Anmeldung {user.username}")
    db.commit()
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=204)
def change_password(body: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Aktuelles Passwort ist falsch")
    user.password_hash = hash_password(body.new_password)
    audit.log(db, user, "UPDATE", "user", user.id, "Passwort geändert")
    db.commit()
