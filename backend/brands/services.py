"""Read each brand transaction API and store one row per transaction id."""
from __future__ import annotations

import json
import re
import threading
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import requests
from django.db import close_old_connections, transaction
from django.utils import timezone

from brands.models import Brand, BrandSync, Transaction

LIVE_STATUSES = ("PENDING", "COMPLETED", "REJECTED")
_TAG_RE = re.compile(r"<span[^>]*>(.*?)</span>", re.I)
_HTML_RE = re.compile(r"<[^>]+>")
_lock = threading.Lock()
_cache: dict[tuple[str, str, str], dict] = {}


def sync_day(day: date) -> None:
    with _lock:
        _sync_day(day)


def _sync_day(day: date) -> None:
    close_old_connections()
    try:
        brands = list(Brand.objects.filter(is_active=True))
        for brand in brands:
            rows, errors = _collect_brand(brand, day)
            if rows:
                _store_rows(brand, day, rows)
            BrandSync.objects.update_or_create(
                brand=brand,
                day=day,
                defaults={
                    "message": " ".join(errors),
                    "row_count": len(rows),
                },
            )
    finally:
        close_old_connections()


def _collect_brand(brand: Brand, day: date) -> tuple[list[dict], list[str]]:
    if not brand.token:
        return [], [f"{brand.name} has no token"]
    if not brand.merchant_id:
        return [], [f"{brand.name} merchant id is not set"]
    collected: list[dict] = []
    errors: list[str] = []
    day_text = day.isoformat()
    pending_key = (brand.name, "PENDING", day_text)
    previous_ids = _ids(_cache.get(pending_key, {}).get("raw", []))
    pending_raw, pending_error = _read_status(brand, day_text, "PENDING", force_full=True)
    if pending_error:
        errors.append(f"{brand.name} PENDING: {pending_error}")
    collected.extend(pending_raw)
    pending_changed = previous_ids != _ids(pending_raw)
    for status in ("COMPLETED", "REJECTED"):
        raw, error = _read_status(brand, day_text, status, force_full=pending_changed)
        if error:
            errors.append(f"{brand.name} {status}: {error}")
        collected.extend(raw)
    return collected, errors


def _read_status(brand: Brand, day: str, status: str, force_full: bool = False) -> tuple[list[dict], str]:
    key = (brand.name, status, day)
    try:
        if status == "PENDING":
            raw, error, total = fetch_brand(brand, day, status, max_pages=10)
            if not error:
                _cache[key] = {"sig": (total, ""), "raw": raw}
        else:
            raw, error, total = fetch_brand(brand, day, status, max_pages=1)
            head = str(raw[0].get("id") or "") if raw else ""
            cached = _cache.get(key)
            unchanged = cached and cached["sig"] == (total, head) and total <= len(cached["raw"])
            if not error and not force_full and unchanged:
                raw = cached["raw"]
            elif not error and (force_full or total > len(raw)):
                raw, error, total = fetch_brand(brand, day, status, max_pages=40)
                head = str(raw[0].get("id") or "") if raw else ""
            if not error:
                _cache[key] = {"sig": (total, head), "raw": raw}
    except requests.RequestException as exc:
        error = exc.__class__.__name__
        raw = []
    except ValueError:
        error = "The brand API did not return JSON"
        raw = []
    if error and key in _cache:
        raw = _cache[key]["raw"]
    return raw, error


def fetch_brand(brand: Brand, day: str, status: str, max_pages: int) -> tuple[list[dict], str, int]:
    url = brand.domain.rstrip("/") + "/api/v1/index.php"
    rows: list[dict] = []
    total = 0
    page = 0
    while page < max_pages:
        response = requests.post(
            url,
            data={
                "module": "/transactions/getAllTransactions",
                "accessId": brand.access_id,
                "accessToken": brand.token,
                "merchantId": brand.merchant_id,
                "pageIndex": str(page),
                "status": status,
                "sDate": f"{day} 00:00:00",
                "eDate": f"{day} 23:59:59",
            },
            timeout=20,
        )
        body = response.json()
        if str(body.get("status") or "") != "SUCCESS":
            data = body.get("data") if isinstance(body.get("data"), dict) else {}
            message = str(data.get("message") or "") or "The brand API refused the request"
            return rows, message, total
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        total = int(data.get("totalCount") or 0)
        batch = data.get("transactions") if isinstance(data.get("transactions"), list) else []
        rows.extend(item for item in batch if isinstance(item, dict))
        total_page = int(data.get("totalPage") or 1)
        if not batch or page + 1 >= total_page:
            break
        page += 1
    return rows, "", total


def _store_rows(brand: Brand, day: date, raw_rows: list[dict]) -> None:
    prepared = []
    for raw in raw_rows:
        external_id = str(raw.get("id") or "").strip()
        if not external_id:
            continue
        user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
        bank = _bank(user.get("bank"))
        tags = _TAG_RE.findall(str(user.get("name") or ""))
        extra = ", ".join(tags)
        detail = " · ".join(part for part in (extra, _detail(raw)) if part)
        created = _parse_dt(raw.get("createdDateTime"))
        processed = _parse_dt(raw.get("processedDateTime"))
        prepared.append(
            Transaction(
                brand=brand,
                external_id=external_id,
                txn_date=day,
                status=str(raw.get("status") or ""),
                type=str(raw.get("type") or ""),
                amount=_money(raw.get("cash")),
                username=str(user.get("username") or "")[:128],
                player_name=str(user.get("originalName") or _HTML_RE.sub("", str(user.get("name") or "")))[:255],
                mobile=str(user.get("mobile") or "")[:64],
                bank=str(bank.get("bank") or "")[:128],
                acc_name=str(bank.get("bankAccountName") or "")[:255],
                acc_no=str(bank.get("bankAccountNumber") or "")[:64],
                bsb=str(bank.get("bankBSB") or "")[:32],
                pay_id=str(bank.get("payID") or "")[:128],
                method=_method(raw)[:128],
                detail=detail,
                created_at=created,
                processed_at=processed,
            )
        )
    if not prepared:
        return
    prepared = list({item.external_id: item for item in prepared}.values())
    with transaction.atomic():
        Transaction.objects.bulk_create(
            prepared,
            update_conflicts=True,
            unique_fields=["brand", "external_id"],
            update_fields=[
                "txn_date",
                "status",
                "type",
                "amount",
                "username",
                "player_name",
                "mobile",
                "bank",
                "acc_name",
                "acc_no",
                "bsb",
                "pay_id",
                "method",
                "detail",
                "created_at",
                "processed_at",
            ],
        )


def _bank(value: object) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_dt(value: object):
    text = str(value or "").strip().replace("T", " ")
    if not text:
        return None
    parsed = None
    for fmt, size in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16)):
        try:
            parsed = datetime.strptime(text[:size], fmt)
            break
        except ValueError:
            continue
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _money(value: object) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _method(raw: dict) -> str:
    details = raw.get("details")
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except json.JSONDecodeError:
            return ""
    if isinstance(details, dict):
        return str(details.get("method") or "")
    return ""


def _detail(raw: dict) -> str:
    promotion = raw.get("promotion")
    if isinstance(promotion, dict) and promotion.get("name"):
        return str(promotion["name"])
    return _method(raw)


def _ids(raw: object) -> set[str]:
    if not isinstance(raw, list):
        return set()
    return {str(item.get("id") or "") for item in raw if isinstance(item, dict) and item.get("id")}
