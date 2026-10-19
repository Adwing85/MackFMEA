from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..database import get_db
from ..models import Role, User
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password, require_admin

router = APIRouter(prefix="/api/users", tags=["Benutzer"])


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.scalars(select(User).order_by(User.username)).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status_code=409, detail="Benutzername bereits vergeben")
    user = User(
        username=body.username,
        full_name=body.full_name,
        email=body.email,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    audit.log(db, admin, "CREATE", "user", user.id, f"Benutzer {user.username} ({user.role}) angelegt")
    db.commit()
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    before = {"full_name": user.full_name, "email": user.email, "role": user.role, "is_active": user.is_active}
    changes = body.model_dump(exclude_unset=True, exclude={"password"})
    if user.id == admin.id and (changes.get("role", Role.ADMIN.value) != Role.ADMIN.value or changes.get("is_active") is False):
        raise HTTPException(status_code=400, detail="Eigene Admin-Rechte können nicht entzogen werden")
    for field, value in changes.items():
        setattr(user, field, value)
    if body.password:
        user.password_hash = hash_password(body.password)
    after = {"full_name": user.full_name, "email": user.email, "role": user.role, "is_active": user.is_active}
    details = audit.diff(before, after)
    if body.password:
        details["password"] = {"alt": "***", "neu": "***"}
    audit.log(db, admin, "UPDATE", "user", user.id, f"Benutzer {user.username} geändert", details)
    db.commit()
    return user
