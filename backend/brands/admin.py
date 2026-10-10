from django.contrib import admin

from brands.models import BankTransfer, Brand, BrandSync, Transaction


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ("name", "group", "domain", "merchant_id", "is_active", "sort_order")
    search_fields = ("name", "domain")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("external_id", "brand", "txn_date", "status", "type", "amount", "username")
    list_filter = ("brand", "status", "type", "txn_date")
    search_fields = ("external_id", "username", "player_name")


@admin.register(BankTransfer)
class BankTransferAdmin(admin.ModelAdmin):
    list_display = (
        "transfer_date",
        "created_on",
        "from_bank_name",
        "from_account_name",
        "to_bank_name",
        "to_account_name",
        "amount",
    )
    list_filter = ("transfer_date", "created_on")
    search_fields = ("from_bank_name", "from_account_name", "to_bank_name", "to_account_name")
class BrandSyncAdmin(admin.ModelAdmin):
    list_display = ("brand", "day", "row_count", "updated_at", "message")
    list_filter = ("day", "brand")
