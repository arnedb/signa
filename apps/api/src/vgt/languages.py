"""The sign languages an organisation can teach. More can be added with `vgt add-language`."""

from sqlalchemy.orm import Session

from vgt.models import Language

# Also inserted by migrations 0002 and 0003; keep them in step.
# code: (name, locale). The locale is the spoken language of the glosses.
DEFAULT_LANGUAGES = {
    "vgt": ("Vlaamse Gebarentaal", "nl"),
    "lsfb": ("Langue des signes de Belgique francophone", "fr"),
    "ngt": ("Nederlandse Gebarentaal", "nl"),
}


def ensure_languages(db: Session) -> None:
    for code, (name, locale) in DEFAULT_LANGUAGES.items():
        if db.get(Language, code) is None:
            db.add(Language(code=code, name=name, locale=locale))
    db.flush()
