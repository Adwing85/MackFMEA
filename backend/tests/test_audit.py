from sqlalchemy import select

from app import audit
from app.models import AuditLog


def test_chain_valid_after_actions(client, designer, reviewer):
    client.get("/api/assemblies", headers=designer)
    result = client.get("/api/audit/verify", headers=reviewer).json()
    assert result["valid"] is True
    assert result["checked"] >= 3


def test_tampering_is_detected(db):
    audit.log(db, None, "TEST", "x", 1, "Eintrag A")
    audit.log(db, None, "TEST", "x", 2, "Eintrag B")
    db.commit()
    assert audit.verify_chain(db)["valid"]
    entry = db.scalars(select(AuditLog).where(AuditLog.summary == "Eintrag A")).one()
    entry.summary = "Eintrag A (manipuliert)"
    db.commit()
    result = audit.verify_chain(db)
    assert result["valid"] is False
    assert result["first_invalid_id"] == entry.id


def test_designer_cannot_read_audit_log(client, designer):
    assert client.get("/api/audit", headers=designer).status_code == 403
