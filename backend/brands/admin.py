from django.contrib import admin

from brands.models import Brand, BrandSync, Transaction


@admin.register(Brand)
class BrandAdmin(admin.ModelAdmin):
    list_display = ("name", "domain", "merchant_id", "is_active", "sort_order")
    search_fields = ("name", "domain")


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ("external_id", "brand", "txn_date", "status", "type", "amount", "username")
    list_filter = ("brand", "status", "type", "txn_date")
    search_fields = ("external_id", "username", "player_name")


@admin.register(BrandSync)
class BrandSyncAdmin(admin.ModelAdmin):
    list_display = ("brand", "day", "row_count", "updated_at", "message")
    list_filter = ("day", "brand")
