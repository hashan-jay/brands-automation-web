"""Read each brand transaction API and store one row per transaction id."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation

import requests
from django.db import close_old_connections, transaction
from django.utils import timezone

from brands import livecache
from brands.models import SYDNEY, Brand, BrandSync, CompanyBank, Transaction

UTC = ZoneInfo("UTC")

LIVE_STATUSES = ("PENDING", "COMPLETED", "REJECTED")
_TAG_RE = re.compile(r"<span[^>]*>(.*?)</span>", re.I)
_HTML_RE = re.compile(r"<[^>]+>")
_lock = threading.Lock()
_cache_lock = threading.Lock()
_cache: dict[tuple[str, str, str], dict] = {}
_http_local = threading.local()
_TRANSIENT = {"ConnectionError", "Timeout", "ConnectTimeout", "ReadTimeout"}


def sync_day(day: date, *, wait: bool = True) -> None:
    acquired = _lock.acquire(blocking=wait)
    if not acquired:
        return
    try:
        _sync_day(day)
    finally:
        _lock.release()


def _sync_day(day: date) -> None:
    close_old_connections()
    try:
        brands = list(Brand.objects.filter(is_active=True))
        close_old_connections()
        fetched = _fetch_brands(brands, day)
        harvested: dict[str, tuple[str, str]] = {}
        for _brand, rows, _errors in fetched:
            harvested.update(_harvest_banks(rows))
        if harvested:
            _save_company_banks(harvested)
        catalog = {item.external_id: item.account_name for item in CompanyBank.objects.all()}
        changed = False
        for brand, rows, errors in fetched:
            if rows and _store_rows(brand, day, rows, catalog):
                changed = True
            if _save_sync(brand, day, " ".join(errors), len(rows)):
                changed = True
        if changed or not livecache.has_snapshot(day):
            publish_snapshot(day)
    finally:
        close_old_connections()


def _fetch_brands(brands: list[Brand], day: date) -> list[tuple[Brand, list[dict], list[str]]]:
    if not brands:
        return []

    def collect(brand: Brand) -> tuple[Brand, list[dict], list[str]]:
        try:
            rows, errors = _collect_brand(brand, day)
            return brand, rows, errors
        except Exception as exc:
            return brand, [], [f"{brand.name}: {exc.__class__.__name__}"]
        finally:
            close_old_connections()

    workers = min(8, len(brands))
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="brand-fetch") as pool:
        return list(pool.map(collect, brands))


def _collect_brand(brand: Brand, day: date) -> tuple[list[dict], list[str]]:
    if not brand.token:
        return [], [f"{brand.name} has no token"]
    if not brand.merchant_id:
        return [], [f"{brand.name} merchant id is not set"]
    collected: list[dict] = []
    errors: list[str] = []
    day_text = day.isoformat()
    pending_key = (brand.name, "PENDING", day_text)
    previous = _cache_get(pending_key)
    previous_ids = _ids(previous.get("raw", []) if previous else [])
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
    for kind in ("DEPOSIT", "WITHDRAW"):
        raw, error = _read_typed(brand, day_text, "COMPLETED", kind, force_full=pending_changed)
        if error:
            errors.append(f"{brand.name} COMPLETED {kind}: {error}")
        collected.extend(raw)
    for status in ("COMPLETED", "PENDING", "REJECTED"):
        raw, error = _read_typed(
            brand,
            day_text,
            status,
            "FORFEITED",
            force_full=pending_changed,
            max_pages=250,
        )
        if error:
            errors.append(f"{brand.name} {status} FORFEITED: {error}")
        collected.extend(raw)
    return collected, errors


def _read_status(brand: Brand, day: str, status: str, force_full: bool = False) -> tuple[list[dict], str]:
    key = (brand.name, status, day)
    try:
        if status == "PENDING":
            raw, error, total = fetch_brand(brand, day, status, max_pages=10)
            if not error:
                _cache_put(key, {"sig": (total, ""), "raw": raw})
        else:
            raw, error, total = fetch_brand(brand, day, status, max_pages=1)
            head = str(raw[0].get("id") or "") if raw else ""
            cached = _cache_get(key)
            unchanged = cached and cached["sig"] == (total, head) and total <= len(cached["raw"])
            if not error and not force_full and unchanged:
                raw = cached["raw"]
            elif not error and (force_full or total > len(raw)):
                raw, error, total = fetch_brand(brand, day, status, max_pages=40)
                head = str(raw[0].get("id") or "") if raw else ""
            if not error:
                _cache_put(key, {"sig": (total, head), "raw": raw})
    except requests.RequestException as exc:
        error = exc.__class__.__name__
        raw = []
    except ValueError:
        error = "The brand API did not return JSON"
        raw = []
    if error in _TRANSIENT:
        cached = _cache_get(key)
        if cached and cached.get("raw"):
            return list(cached["raw"]), ""
    if error:
        cached = _cache_get(key)
        if cached:
            raw = cached["raw"]
    return raw, error


def _read_typed(
    brand: Brand,
    day: str,
    status: str,
    txn_type: str,
    force_full: bool = False,
    max_pages: int = 40,
) -> tuple[list[dict], str]:
    """Completed deposits and withdrawals are paged separately so bank names are not cut off."""
    key = (brand.name, f"{status}:{txn_type}", day)
    try:
        raw, error, total = fetch_brand(brand, day, status, max_pages=1, txn_type=txn_type)
        head = str(raw[0].get("id") or "") if raw else ""
        cached = _cache_get(key)
        unchanged = (
            not force_full
            and cached is not None
            and cached["sig"] == (total, head)
            and total <= len(cached["raw"])
        )
        if not error and unchanged:
            raw = cached["raw"]
        elif not error and (force_full or total > len(raw)):
            raw, error, total = fetch_brand(brand, day, status, max_pages=max_pages, txn_type=txn_type)
            head = str(raw[0].get("id") or "") if raw else ""
        if not error:
            _cache_put(key, {"sig": (total, head), "raw": raw})
    except requests.RequestException as exc:
        error = exc.__class__.__name__
        raw = []
    except ValueError:
        error = "The brand API did not return JSON"
        raw = []
    if error in _TRANSIENT:
        cached = _cache_get(key)
        if cached and cached.get("raw"):
            return list(cached["raw"]), ""
    return raw, error


def _http() -> requests.Session:
    session = getattr(_http_local, "session", None)
    if session is None:
        session = requests.Session()
        _http_local.session = session
    return session


def _reset_http() -> None:
    session = getattr(_http_local, "session", None)
    _http_local.session = None
    if session is not None:
        try:
            session.close()
        except requests.RequestException:
            pass


def _post(url: str, form: dict) -> requests.Response:
    """Retry a dropped connection. Brand hosts close idle sockets without warning."""
    last: requests.RequestException | None = None
    for attempt in range(3):
        try:
            return _http().post(url, data=form, timeout=(5, 25))
        except (requests.ConnectionError, requests.Timeout) as exc:
            last = exc
            _reset_http()
            time.sleep(0.35 * (attempt + 1))
    assert last is not None
    raise last


def fetch_brand(brand: Brand, day: str, status: str, max_pages: int, txn_type: str = "") -> tuple[list[dict], str, int]:
    url = brand.domain.rstrip("/") + "/api/v1/index.php"
    rows: list[dict] = []
    total = 0
    page = 0
    while page < max_pages:
        form = {
            "module": "/transactions/getAllTransactions",
            "accessId": brand.access_id,
            "accessToken": brand.token,
            "merchantId": brand.merchant_id,
            "pageIndex": str(page),
            "status": status,
            "sDate": f"{day} 00:00:00",
            "eDate": f"{day} 23:59:59",
        }
        if txn_type:
            form["type"] = txn_type
            form["pageSize"] = "100"
        response = _post(url, form)
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


def _store_rows(brand: Brand, day: date, raw_rows: list[dict], catalog: dict[str, str] | None = None) -> bool:
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
                bank_name=_selected_bank_name(raw),
                bank_account_name=_bank_account_name(raw, catalog or {}),
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
        return False
    prepared = list({item.external_id: item for item in prepared}.values())
    signature = _signature(prepared)
    signature_key = f"brands:sig:{brand.pk}:{day.isoformat()}"
    if livecache.same(signature_key, signature):
        return False
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
                "bank_name",
                "bank_account_name",
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
    livecache.store(signature_key, signature)
    return True


def _selected_bank_name(raw: dict) -> str:
    """Bank chosen in the brand backend when a deposit or withdrawal is completed."""
    if str(raw.get("status") or "") != "COMPLETED":
        return ""
    if str(raw.get("type") or "") not in {"DEPOSIT", "WITHDRAW"}:
        return ""
    details = raw.get("details")
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except json.JSONDecodeError:
            return ""
    if not isinstance(details, dict):
        return ""
    return str(details.get("bank") or "")[:128]


def _clean_label(value: object) -> str:
    return " ".join(str(value or "").replace("\xa0", " ").split())


def _org_bank(raw: dict) -> dict:
    bank = raw.get("bank")
    if isinstance(bank, str):
        bank = _bank(bank)
    return bank if isinstance(bank, dict) else {}


def _harvest_banks(raw_rows: list[dict]) -> dict[str, tuple[str, str]]:
    """Bank id -> (bank code, organization account name) from rows that include the account."""
    found: dict[str, tuple[str, str]] = {}
    for raw in raw_rows:
        if str(raw.get("status") or "") != "COMPLETED":
            continue
        if str(raw.get("type") or "") not in {"DEPOSIT", "WITHDRAW"}:
            continue
        bank = _org_bank(raw)
        account_name = _clean_label(bank.get("accountName"))
        bank_id = str(bank.get("id") or raw.get("bankId") or "").strip()
        if not account_name or not bank_id or bank_id in {"0", "None"}:
            continue
        found[bank_id] = (str(bank.get("bankName") or "")[:128], account_name[:255])
    return found


def _save_company_banks(found: dict[str, tuple[str, str]]) -> None:
    CompanyBank.objects.bulk_create(
        [
            CompanyBank(external_id=bank_id, bank_name=bank_name, account_name=account_name)
            for bank_id, (bank_name, account_name) in found.items()
        ],
        update_conflicts=True,
        unique_fields=["external_id"],
        update_fields=["bank_name", "account_name"],
    )


def _bank_account_name(raw: dict, catalog: dict[str, str]) -> str:
    """Organization account that received a deposit or paid a withdrawal."""
    if str(raw.get("status") or "") != "COMPLETED":
        return ""
    if str(raw.get("type") or "") not in {"DEPOSIT", "WITHDRAW"}:
        return ""
    account_name = _clean_label(_org_bank(raw).get("accountName"))
    if account_name:
        return account_name[:255]
    bank_id = str(raw.get("bankId") or "").strip()
    if not bank_id or bank_id in {"0", "None"}:
        return ""
    return str(catalog.get(bank_id) or "")[:255]


def _bank(value: object) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_dt(value: object):
    """Keep the brand API instant. createdDateTime arrives as UTC, for example 2026-10-03T05:26:41+00:00."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        parsed = None
    if parsed is None:
        compact = text.replace("T", " ")
        for fmt, size in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M", 16)):
            try:
                parsed = datetime.strptime(compact[:size], fmt)
                break
            except ValueError:
                continue
        if parsed is None:
            return None
    if timezone.is_naive(parsed):
        return parsed.replace(tzinfo=UTC)
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


def _cache_get(key: tuple[str, str, str]) -> dict | None:
    with _cache_lock:
        return _cache.get(key)


def _cache_put(key: tuple[str, str, str], value: dict) -> None:
    with _cache_lock:
        _cache[key] = value


def _signature(prepared: list[Transaction]) -> str:
    lines = []
    for item in sorted(prepared, key=lambda txn: txn.external_id):
        created = item.created_at.isoformat() if item.created_at else ""
        processed = item.processed_at.isoformat() if item.processed_at else ""
        lines.append(
            "|".join(
                (
                    item.external_id,
                    item.status,
                    item.type,
                    format(item.amount, "f"),
                    item.username,
                    item.player_name,
                    item.mobile,
                    item.bank,
                    item.bank_name,
                    item.bank_account_name,
                    item.acc_name,
                    item.acc_no,
                    item.bsb,
                    item.pay_id,
                    item.method,
                    item.detail,
                    created,
                    processed,
                )
            )
        )
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def _save_sync(brand: Brand, day: date, message: str, row_count: int) -> bool:
    state = f"{row_count}\n{message}"
    key = f"brands:sync:{brand.pk}:{day.isoformat()}"
    if livecache.same(key, state):
        return False
    BrandSync.objects.update_or_create(
        brand=brand,
        day=day,
        defaults={"message": message, "row_count": row_count},
    )
    livecache.store(key, state)
    return True


def load_dashboard(day: date) -> dict:
    packed = livecache.snapshot(day)
    if packed is not None:
        return packed
    return publish_snapshot(day)


def publish_snapshot(day: date) -> dict:
    marker = timezone.now().isoformat()
    rows, brands = _read_day(day)
    livecache.publish(day, rows, brands, marker)
    fresh = livecache.snapshot(day)
    if fresh is not None:
        return fresh
    return {"rows": rows, "brands": brands, "revision": None}


def _read_day(day: date) -> tuple[list[dict], list[dict]]:
    """Rows whose created time falls on this Sydney calendar day. Stored rows are not rewritten."""
    start = datetime.combine(day, datetime.min.time(), tzinfo=SYDNEY)
    end = start + timedelta(days=1)
    queryset = (
        Transaction.objects.select_related("brand")
        .filter(created_at__gte=start, created_at__lt=end)
        .order_by("-created_at", "-external_id")
    )
    rows = [item.display() for item in queryset]
    rows.sort(key=lambda row: row["status"] != "PENDING")
    syncs = {item.brand_id: item for item in BrandSync.objects.select_related("brand").filter(day=day)}
    brands = []
    for brand in Brand.objects.filter(is_active=True).order_by("sort_order", "name"):
        sync = syncs.get(brand.id)
        updated = sync.updated_at if sync else None
        brands.append(
            {
                "name": brand.name,
                "sort_order": brand.sort_order,
                "message": sync.message if sync else "",
                "row_count": sync.row_count if sync else 0,
                "updated_at": updated.isoformat() if updated else None,
            }
        )
    return rows, brands
