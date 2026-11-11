"""The few texts the API makes itself, in each interface language.

Everything else the user reads is translated in the apps (``packages/core/src/text.ts``).
"""

from typing import Literal

Locale = Literal["nl", "fr", "en"]
LOCALES: tuple[Locale, ...] = ("nl", "fr", "en")
DEFAULT_LOCALE: Locale = "nl"

Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
WEEKDAYS: tuple[Weekday, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

_WEEKDAY_NAMES: dict[Locale, tuple[str, ...]] = {
    "nl": ("maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"),
    "fr": ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"),
    "en": ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"),
}
_YEAR: dict[Locale, str] = {"nl": "Jaar", "fr": "Année", "en": "Year"}


_BY_CODE: dict[str, Locale] = {loc: loc for loc in LOCALES}


def locale_or_default(value: str | None) -> Locale:
    return _BY_CODE.get(value or "", DEFAULT_LOCALE)


def weekday_name(weekday: str, locale: str | None) -> str:
    loc = locale_or_default(locale)
    return _WEEKDAY_NAMES[loc][WEEKDAYS.index(weekday)] if weekday in WEEKDAYS else weekday


def group_label(year: int, weekday: str, locale: str | None) -> str:
    """The default name of a group, e.g. 'Jaar 1 · dinsdag' or 'Année 1 · mardi'."""
    return f"{_YEAR[locale_or_default(locale)]} {year} · {weekday_name(weekday, locale)}"
