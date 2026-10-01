import os
import sys

from django.apps import AppConfig


class BrandsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "brands"

    def ready(self) -> None:
        if "runserver" not in sys.argv:
            return
        if os.environ.get("RUN_MAIN") != "true":
            return
        from brands.poller import start_poller

        start_poller()
