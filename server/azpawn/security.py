"""Passwords, sessions and request throttling."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from .auctions import iso, utcnow

SESSION_LIFETIME = {"staff": timedelta(hours=12), "bidder": timedelta(days=30)}
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, dklen=32, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), dklen=32, **_SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(conn: sqlite3.Connection, kind: str, user_id: int) -> str:
    """A random token for the cookie; only its hash is stored."""
    token = secrets.token_urlsafe(32)
    expires = iso(utcnow() + SESSION_LIFETIME[kind])
    conn.execute(
        "INSERT INTO sessions (token_hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)",
        (_token_hash(token), kind, user_id, expires),
    )
    return token


def session_user(conn: sqlite3.Connection, kind: str, token: str | None) -> int | None:
    if not token:
        return None
    row = conn.execute(
        "SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND kind = ?", (_token_hash(token), kind)
    ).fetchone()
    if row is None or row["expires_at"] <= iso(utcnow()):
        return None
    return row["user_id"]


def end_session(conn: sqlite3.Connection, token: str | None) -> None:
    if token:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


class Throttle:
    """At most `limit` events per `window` seconds per key (an IP and an action)."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        with self._lock:
            events = self._events[key]
            while events and now - events[0] > window:
                events.popleft()
            if len(events) >= limit:
                return False
            events.append(now)
            return True
