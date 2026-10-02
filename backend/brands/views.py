import re
from datetime import datetime
from decimal import Decimal

from django.db.models import Count, Sum
from django.db.models.functions import Left
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from brands.models import Brand, BrandSync, Transaction
from brands.poller import note_watch, start_poller
from brands.services import sync_day


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

        scoped = Transaction.objects.select_related("brand").filter(txn_date=day)
        if brand_name != "All":
            scoped = scoped.filter(brand__name=brand_name)

        stats = _stats(scoped)
        total_rows = scoped.count()
        visible = scoped
        if wanted_type != "All types":
            visible = visible.filter(type=wanted_type)
        if wanted_status != "All statuses":
            visible = visible.filter(status=wanted_status)
        rows = [
            item.display()
            for item in visible.annotate(detail_short=Left("detail", 160))
            .defer("detail")
            .order_by("-created_at", "-external_id")
        ]
        rows.sort(key=lambda row: row["status"] != "PENDING")

        syncs = BrandSync.objects.select_related("brand").filter(day=day)
        if brand_name != "All":
            syncs = syncs.filter(brand__name=brand_name)
        errors = [item.message for item in syncs if item.message]
        synced_at = syncs.order_by("-updated_at").values_list("updated_at", flat=True).first()
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
            names = list(
                dict.fromkeys(
                    Brand.objects.filter(pk__in=scoped.values("brand_id"))
                    .order_by("sort_order")
                    .values_list("name", flat=True)
                )
            )
        else:
            names = [brand_name]
        if total_rows == 0:
            brand_line = f"{brand_name}: the API returned no rows for this date."
        else:
            parts = []
            for name in names:
                brand_rows = scoped.filter(brand__name=name)
                pending = brand_rows.filter(status="PENDING").count()
                parts.append(f"{name}: {brand_rows.count()} rows, {pending} pending")
            brand_line = "   ".join(parts)

        return Response(
            {
                "date": day.isoformat(),
                "brand": brand_name,
                "rows": rows,
                "stats": stats,
                "brand_line": brand_line,
                "status_line": status_line,
                "errors": errors,
                "synced_at": synced_at.isoformat() if synced_at else None,
            }
        )


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


def _stats(scoped) -> dict:
    pairs = (
        ("pending_deposit", "PENDING", "DEPOSIT"),
        ("pending_withdraw", "PENDING", "WITHDRAW"),
        ("completed_deposit", "COMPLETED", "DEPOSIT"),
        ("completed_withdraw", "COMPLETED", "WITHDRAW"),
    )
    result = {}
    for key, status, kind in pairs:
        match = scoped.filter(status=status, type=kind)
        total = match.aggregate(count=Count("id"), amount=Sum("amount"))
        amount = total["amount"] if isinstance(total["amount"], Decimal) else Decimal("0")
        result[key] = {"count": total["count"] or 0, "amount": f"{amount:.2f}"}
    return result
