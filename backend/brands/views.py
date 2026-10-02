import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from brands import livecache
from brands.models import Brand
from brands.poller import note_watch, start_poller
from brands.services import load_dashboard, sync_day


class BrandListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        brands = Brand.objects.filter(is_active=True).order_by("sort_order", "name")
        return Response([{"id": brand.id, "name": brand.name} for brand in brands])


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        day = _parse_day(request.query_params.get("date"))
        note_watch(day)
        start_poller()
        brand_name = str(request.query_params.get("brand") or "All")
        wanted_type = str(request.query_params.get("type") or "All types")
        wanted_status = str(request.query_params.get("status") or "All statuses")
        client_rev = str(request.query_params.get("rev") or "")
        if client_rev:
            current = livecache.revision(day)
            if current is not None and current == client_rev:
                return _live_response({"unchanged": True, "revision": int(current)})
        return _live_response(_dashboard_body(day, brand_name, wanted_type, wanted_status, load_dashboard(day)))


class SyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        day = _parse_day(request.data.get("date") or request.query_params.get("date"))
        note_watch(day)
        sync_day(day)
        return Response({"ok": True, "date": day.isoformat()})


def _refused_ip(errors: list[str]) -> str:
    for message in errors:
        match = re.search(r"Invalid Access IP \[([0-9.]+)\]", message)
        if match:
            return match.group(1)
    return ""


def _parse_day(value: object):
    text = str(value or "").strip()
    if text:
        try:
            return datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError:
            pass
    return timezone.localdate()


def _live_response(body: dict) -> Response:
    response = Response(body)
    response["Cache-Control"] = "no-store"
    return response


def _dashboard_body(day, brand_name: str, wanted_type: str, wanted_status: str, packed: dict) -> dict:
    rows = packed.get("rows") or []
    brands_meta = packed.get("brands") or []
    if brand_name != "All":
        scoped = [row for row in rows if row.get("brand") == brand_name]
        meta = [item for item in brands_meta if item.get("name") == brand_name]
    else:
        scoped = list(rows)
        meta = list(brands_meta)
    visible = scoped
    if wanted_type != "All types":
        visible = [row for row in visible if row.get("type") == wanted_type]
    if wanted_status != "All statuses":
        visible = [row for row in visible if row.get("status") == wanted_status]

    total_rows = len(scoped)
    errors = [str(item.get("message") or "") for item in meta if item.get("message")]
    synced_at = _latest_sync(meta)
    stamp = timezone.localtime(synced_at).strftime("%H:%M:%S") if synced_at else ""
    refused_ip = _refused_ip(errors)
    if refused_ip:
        status_line = (
            f"{stamp}  {total_rows} saved rows. "
            f"The brand APIs refused this computer's address {refused_ip}."
        ).strip()
    elif errors and total_rows == 0:
        status_line = (stamp + "  " + " ".join(errors[:3])).strip()
    elif errors:
        status_line = f"{stamp}  {total_rows} API rows. " + " ".join(errors[:2])
    elif synced_at:
        status_line = f"Live {stamp}  ·  {total_rows} API rows."
    else:
        status_line = "Connecting to the brand APIs."

    if brand_name == "All":
        order = {item.get("name"): item.get("sort_order") or 0 for item in brands_meta}
        names = sorted({row.get("brand") for row in scoped if row.get("brand")}, key=lambda name: (order.get(name, 0), name))
    else:
        names = [brand_name]
    totals: dict[str, int] = {}
    pending: dict[str, int] = {}
    for row in scoped:
        name = row.get("brand") or ""
        totals[name] = totals.get(name, 0) + 1
        if row.get("status") == "PENDING":
            pending[name] = pending.get(name, 0) + 1
    if total_rows == 0:
        brand_line = f"{brand_name}: the API returned no rows for this date."
        brand_summary = [{"name": brand_name, "rows": 0, "pending": 0}] if brand_name != "All" else []
    else:
        brand_summary = [
            {"name": name, "rows": totals.get(name, 0), "pending": pending.get(name, 0)} for name in names
        ]
        brand_line = "   ".join(
            f"{item['name']}: {item['rows']} rows, {item['pending']} pending" for item in brand_summary
        )

    body = {
        "date": day.isoformat(),
        "brand": brand_name,
        "rows": visible,
        "stats": _stats_rows(scoped),
        "brand_summary": brand_summary,
        "brand_line": brand_line,
        "status_line": status_line,
        "errors": errors,
        "synced_at": synced_at.isoformat() if synced_at else None,
    }
    revision = packed.get("revision")
    if revision:
        body["revision"] = int(revision)
    return body


def _latest_sync(meta: list[dict]):
    latest = None
    for item in meta:
        text = str(item.get("updated_at") or "")
        if not text:
            continue
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            continue
        if latest is None or parsed > latest:
            latest = parsed
    return latest


def _stats_rows(rows: list[dict]) -> dict:
    keys = (
        "pending_deposit",
        "pending_withdraw",
        "completed_deposit",
        "completed_withdraw",
        "bonus",
        "forfeited",
        "processing",
        "rejected",
        "other",
    )
    totals = {key: [0, Decimal("0")] for key in keys}

    def add(key: str, amount_text: object) -> None:
        totals[key][0] += 1
        try:
            totals[key][1] += Decimal(str(amount_text or "0"))
        except (InvalidOperation, ValueError):
            return

    for row in rows:
        status = row.get("status")
        kind = row.get("type")
        amount = row.get("amount")
        if status == "PENDING" and kind == "DEPOSIT":
            add("pending_deposit", amount)
        elif status == "PENDING" and kind == "WITHDRAW":
            add("pending_withdraw", amount)
        elif status == "PROCESSING":
            add("processing", amount)
        elif status == "REJECTED":
            add("rejected", amount)
        elif status == "COMPLETED" and kind == "DEPOSIT":
            add("completed_deposit", amount)
        elif status == "COMPLETED" and kind == "WITHDRAW":
            add("completed_withdraw", amount)
        elif kind == "BONUS":
            add("bonus", amount)
        elif kind == "FORFEITED":
            add("forfeited", amount)
        else:
            add("other", amount)

    stats = {key: {"count": count, "amount": f"{amount:.2f}"} for key, (count, amount) in totals.items()}
    net_amount = totals["completed_deposit"][1] + totals["completed_withdraw"][1]
    net_count = totals["completed_deposit"][0] + totals["completed_withdraw"][0]
    stats["net_completed"] = {"count": net_count, "amount": f"{net_amount:.2f}"}
    stats["row_count"] = {"count": len(rows), "amount": "0.00"}
    return stats
