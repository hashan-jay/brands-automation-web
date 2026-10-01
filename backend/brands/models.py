from django.db import models


class Brand(models.Model):
    name = models.CharField(max_length=64, unique=True)
    domain = models.CharField(max_length=255)
    access_id = models.CharField(max_length=32)
    merchant_id = models.CharField(max_length=32, blank=True)
    token = models.CharField(max_length=128)
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
            "bank": self.bank,
            "acc_name": self.acc_name,
            "acc_no": self.acc_no,
            "bsb": self.bsb,
            "pay_id": self.pay_id,
            "brand": self.brand.name,
            "created": _clock(self.created_at),
            "processed": _clock(self.processed_at),
            "status": self.status,
            "detail": self.detail,
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


def _clock(value) -> str:
    if value is None:
        return ""
    from django.utils import timezone

    local = timezone.localtime(value) if timezone.is_aware(value) else value
    return local.strftime("%Y-%m-%d %H:%M")
