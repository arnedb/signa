"""The sign languages an organisation can teach. More can be added with `vgt add-language`."""

from sqlalchemy.orm import Session

from vgt.models import Language

# Also inserted by migration 0002; keep both in step.
DEFAULT_LANGUAGES = {
    "vgt": "Vlaamse Gebarentaal",
    "lsfb": "Langue des signes de Belgique francophone",
    "ngt": "Nederlandse Gebarentaal",
}


def ensure_languages(db: Session) -> None:
    for code, name in DEFAULT_LANGUAGES.items():
        if db.get(Language, code) is None:
            db.add(Language(code=code, name=name))
    db.flush()
