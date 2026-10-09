from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import models

SYDNEY = ZoneInfo("Australia/Sydney")


class Brand(models.Model):
    GROUP_SOLO = "SOLO - KABOOM"
    GROUP_AK = "GROUP AK"
    GROUP_U = "GROUP U"
    GROUPS = (
        (GROUP_SOLO, GROUP_SOLO),
        (GROUP_AK, GROUP_AK),
        (GROUP_U, GROUP_U),
    )

    name = models.CharField(max_length=64, unique=True)
    domain = models.CharField(max_length=255)
    access_id = models.CharField(max_length=32)
    merchant_id = models.CharField(max_length=32, blank=True)
    token = models.CharField(max_length=128)
    group = models.CharField(max_length=32, blank=True, choices=GROUPS)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]

    def __str__(self) -> str:
        return self.name


class Transaction(models.Model):
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name="transactions")
    external_id = models.CharField(max_length=64)
    txn_date = models.DateField(db_index=True)
    status = models.CharField(max_length=32, db_index=True)
    type = models.CharField(max_length=32, db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    username = models.CharField(max_length=128, blank=True)
    player_name = models.CharField(max_length=255, blank=True)
    mobile = models.CharField(max_length=64, blank=True)
    bank = models.CharField(max_length=128, blank=True)
    bank_name = models.CharField(max_length=128, blank=True)
    bank_account_name = models.CharField(max_length=255, blank=True)
    acc_name = models.CharField(max_length=255, blank=True)
    acc_no = models.CharField(max_length=64, blank=True)
    bsb = models.CharField(max_length=32, blank=True)
    pay_id = models.CharField(max_length=128, blank=True)
    method = models.CharField(max_length=128, blank=True)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["brand", "external_id"], name="uniq_brand_txn"),
        ]
        indexes = [
            models.Index(fields=["txn_date", "brand", "status"]),
        ]

    def display(self) -> dict:
        return {
            "time": _clock(self.created_at),
            "id": self.external_id,
            "username": self.username,
            "name": self.player_name,
            "mobile": self.mobile,
            "amount": f"{self.amount:.2f}",
            "type": self.type,
            "bank_name": self.bank_name if self.status == "COMPLETED" and self.type in {"DEPOSIT", "WITHDRAW"} else "",
            "bank_account_name": self.bank_account_name if self.status == "COMPLETED" and self.type in {"DEPOSIT", "WITHDRAW"} else "",
            "bank": self.bank,
            "acc_name": self.acc_name,
            "acc_no": self.acc_no,
            "bsb": self.bsb,
            "pay_id": self.pay_id,
            "brand": self.brand.name,
            "created": _clock(self.created_at),
            "processed": _clock(self.processed_at),
            "status": self.status,
            "detail": str(getattr(self, "detail_short", None) or self.detail or "")[:160],
        }


class BrandSync(models.Model):
    brand = models.ForeignKey(Brand, on_delete=models.CASCADE, related_name="syncs")
    day = models.DateField()
    message = models.TextField(blank=True)
    row_count = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["brand", "day"], name="uniq_brand_sync_day"),
        ]


class CompanyBank(models.Model):
    """Organization bank account shared across brands, keyed by the brand API bank id."""

    external_id = models.CharField(max_length=32, unique=True)
    bank_name = models.CharField(max_length=128, blank=True)
    account_name = models.CharField(max_length=255, blank=True)

    def __str__(self) -> str:
        return self.account_name or self.external_id


class BankLedgerSetting(models.Model):
    """Manual status and limit for one bank account. Balances are not stored here."""

    STATUSES = (
        ("Block", "Block"),
        ("Withdraw only", "Withdraw only"),
        ("Deposit only", "Deposit only"),
        ("Both", "Both"),
        ("Active", "Active"),
        ("Inactive", "Inactive"),
    )

    bank_name = models.CharField(max_length=128)
    account_name = models.CharField(max_length=255)
    status = models.CharField(max_length=32, blank=True, choices=STATUSES)
    limit_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bank_name", "account_name"], name="uniq_bank_ledger_account"),
        ]

    def __str__(self) -> str:
        return f"{self.bank_name} · {self.account_name}"


def sydney_today():
    return datetime.now(SYDNEY).date()


def _clock(value) -> str:
    """Sydney wall time for a stored instant. The database value is left unchanged."""
    if value is None:
        return ""
    from django.utils import timezone

    local = value.astimezone(SYDNEY) if timezone.is_aware(value) else value.replace(tzinfo=SYDNEY)
    return local.strftime("%Y-%m-%d %H:%M")
