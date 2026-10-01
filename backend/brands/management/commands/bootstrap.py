import os

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from brands.models import Brand

BRANDS = (
    {"name": "KABOOM77", "prefix": "KABOOM77", "domain": "https://kaboom77.com", "sort_order": 1},
    {"name": "FF29", "prefix": "FF29", "domain": "https://ff29.co", "sort_order": 2},
    {"name": "CUNTWIN", "prefix": "CUNTWIN", "domain": "https://cuntwin.com", "sort_order": 3},
    {"name": "MATE29", "prefix": "MATE29", "domain": "https://mate29.com", "sort_order": 4},
    {"name": "BETCLUB6", "prefix": "BETCLUB6", "domain": "https://betclub6.net", "sort_order": 5},
    {"name": "SPINOO", "prefix": "SPINOO", "domain": "https://spinoo.net", "sort_order": 6},
    {"name": "COKESPIN", "prefix": "COKESPIN", "domain": "https://cokespin.com", "sort_order": 7},
)


class Command(BaseCommand):
    help = "Create the admin account and store brand API settings from the environment."

    def handle(self, *args, **options):
        username = os.getenv("ADMIN_USERNAME", "admin").strip() or "admin"
        password = os.getenv("ADMIN_PASSWORD", "").strip()
        if password and not User.objects.filter(username=username).exists():
            User.objects.create_superuser(username=username, password=password, email="")
            self.stdout.write(f"Created admin user {username}")
        elif User.objects.filter(username=username).exists():
            self.stdout.write(f"Admin user {username} already exists")
        else:
            self.stdout.write("ADMIN_PASSWORD is empty, so no admin user was created")

        for item in BRANDS:
            prefix = item["prefix"]
            Brand.objects.update_or_create(
                name=item["name"],
                defaults={
                    "domain": os.getenv(f"{prefix}_DOMAIN", item["domain"]).strip() or item["domain"],
                    "access_id": os.getenv(f"{prefix}_ACCESS_ID", "").strip(),
                    "merchant_id": os.getenv(f"{prefix}_MERCHANT_ID", "").strip(),
                    "token": os.getenv(f"{prefix}_TOKEN", "").strip(),
                    "is_active": True,
                    "sort_order": item["sort_order"],
                },
            )
        self.stdout.write(f"Stored {len(BRANDS)} brands")
