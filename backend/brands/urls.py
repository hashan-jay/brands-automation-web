from django.urls import path

from brands.views import BrandListView, DashboardView, SyncView

urlpatterns = [
    path("brands/", BrandListView.as_view()),
    path("dashboard/", DashboardView.as_view()),
    path("sync/", SyncView.as_view()),
]
