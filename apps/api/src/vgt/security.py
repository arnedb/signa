import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

# No 0/O, 1/I/L: the recovery code is read off a screen or a sheet of paper.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_secret(value: str) -> str:
    return _hasher.hash(value)


def verify_secret(stored: str | None, value: str) -> bool:
    if not stored:
        return False
    try:
        return _hasher.verify(stored, value)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(stored: str) -> bool:
    return _hasher.check_needs_rehash(stored)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _code(groups: int, size: int) -> str:
    return "-".join("".join(secrets.choice(_ALPHABET) for _ in range(size)) for _ in range(groups))


def new_recovery_code() -> str:
    return _code(4, 4)


def normalize_recovery_code(code: str) -> str:
    raw = "".join(ch for ch in code.upper() if ch.isalnum())
    return "-".join(raw[i : i + 4] for i in range(0, len(raw), 4))


def new_invite_code() -> str:
    return secrets.token_urlsafe(9)


def new_temp_password() -> str:
    return _code(3, 4).lower()
