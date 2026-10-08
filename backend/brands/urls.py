from django.urls import path

from brands.views import BankAccountsView, BrandListView, DashboardView, SyncView, TransactionDetailView

urlpatterns = [
    path("brands/", BrandListView.as_view()),
    path("dashboard/", DashboardView.as_view()),
    path("bank-accounts/", BankAccountsView.as_view()),
    path("transactions/detail/", TransactionDetailView.as_view()),
    path("sync/", SyncView.as_view()),
]
