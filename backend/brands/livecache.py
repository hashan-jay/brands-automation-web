"""Redis snapshot of a day's transactions.

The live screen reads this instead of scanning Postgres on every refresh.
A revision counter lets the browser skip the payload when nothing changed.
"""
from __future__ import annotations

import hashlib
import json
import time
from datetime import date

import redis
from django.conf import settings

_client: redis.Redis | None = None
_down_until = 0.0


def _mark_down() -> None:
    global _client, _down_until
    _down_until = time.monotonic() + 2
    client = _client
    _client = None
    if client is not None:
        try:
            client.close()
        except redis.RedisError:
            pass


def _redis() -> redis.Redis:
    global _client
    if time.monotonic() < _down_until:
        raise redis.ConnectionError("Redis is cooling down after a connection error")
    if _client is None:
        _client = redis.Redis.from_url(
            getattr(settings, "REDIS_URL", "redis://127.0.0.1:6379/0"),
            decode_responses=True,
            # This host runs Redis 5, which does not accept the RESP3 HELLO command.
            protocol=2,
            socket_connect_timeout=0.3,
            socket_timeout=3,
            health_check_interval=30,
            max_connections=16,
        )
    return _client


def ping() -> bool:
    if time.monotonic() < _down_until:
        return False
    try:
        return bool(_redis().ping())
    except redis.RedisError:
        _mark_down()
        return False


def _keys(day: date) -> tuple[str, str, str, str]:
    iso = day.isoformat()
    return (
        f"brands:snap:syd:{iso}",
        f"brands:hash:syd:{iso}",
        f"brands:rev:syd:{iso}",
        f"brands:mark:syd:{iso}",
    )


def revision(day: date) -> str | None:
    if time.monotonic() < _down_until:
        return None
    try:
        value = _redis().get(_keys(day)[2])
    except redis.RedisError:
        _mark_down()
        return None
    if value is None:
        return None
    return str(value)


def snapshot(day: date) -> dict | None:
    if time.monotonic() < _down_until:
        return None
    snap_key, _, rev_key, _ = _keys(day)
    try:
        raw, rev = _redis().mget(snap_key, rev_key)
    except redis.RedisError:
        _mark_down()
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    data["revision"] = int(rev or 0)
    return data


def has_snapshot(day: date) -> bool:
    if time.monotonic() < _down_until:
        return False
    try:
        return bool(_redis().exists(_keys(day)[0]))
    except redis.RedisError:
        _mark_down()
        return False


def same(key: str, digest: str) -> bool:
    """True when Redis already stored this exact value."""
    if time.monotonic() < _down_until:
        return False
    try:
        return _redis().get(key) == digest
    except redis.RedisError:
        _mark_down()
        return False


def store(key: str, digest: str) -> None:
    if time.monotonic() < _down_until:
        return
    try:
        _redis().set(key, digest, ex=172800)
    except redis.RedisError:
        _mark_down()


def publish(day: date, rows: list, brands: list, marker: str) -> int | None:
    """Store the day snapshot. A newer marker always wins, so a slow read cannot overwrite fresh rows."""
    if time.monotonic() < _down_until:
        return None
    snap_key, hash_key, rev_key, mark_key = _keys(day)
    body = json.dumps({"rows": rows, "brands": brands}, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256(body.encode()).hexdigest()
    try:
        client = _redis()
        current_mark = client.get(mark_key)
        if current_mark is not None and current_mark >= marker:
            current_rev = client.get(rev_key)
            return int(current_rev or 0)
        if client.get(hash_key) == digest:
            client.set(mark_key, marker, ex=172800)
            current_rev = client.get(rev_key)
            return int(current_rev or 0)
        pipe = client.pipeline(transaction=True)
        pipe.set(snap_key, body, ex=172800)
        pipe.set(hash_key, digest, ex=172800)
        pipe.set(mark_key, marker, ex=172800)
        pipe.incr(rev_key)
        pipe.expire(rev_key, 172800)
        _stored, _hash_set, _mark_set, new_rev, _expired = pipe.execute()
        return int(new_rev or 0)
    except redis.RedisError:
        _mark_down()
        return None
