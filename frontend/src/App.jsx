import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
import BankTransfers from "./pages/BankTransfers";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Users from "./pages/Users";

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api("/api/auth/me/")
      .then(setUser)
      .catch(() => setToken(""))
      .finally(() => setReady(true));
  }, []);

  async function logout() {
    try {
      await api("/api/auth/logout/", { method: "POST" });
    } catch {
      /* the token is cleared either way */
    }
    setToken("");
    setUser(null);
    setPage("dashboard");
  }

  if (!ready) {
    return <div className="boot">Loading…</div>;
  }
  if (!user) {
    return <Login onSuccess={setUser} />;
  }
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-lockup">
          <button type="button" className="brand-home" onClick={() => setPage("dashboard")}>
            <h1>Brands Automation</h1>
            <p>Live deposits and withdrawals from each brand API.</p>
          </button>
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={`ghost${page === "transfers" ? " selected" : ""}`}
            aria-pressed={page === "transfers"}
            onClick={() => setPage(page === "transfers" ? "dashboard" : "transfers")}
          >
            Bank Transfers
          </button>
          {user.is_staff && (
            <button type="button" className={`ghost${page === "users" ? " selected" : ""}`} onClick={() => setPage(page === "users" ? "dashboard" : "users")}>
              {page === "users" ? "Transactions" : "Users"}
            </button>
          )}
          <span className="who">
            <span className="who-mark" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
            {user.username}
          </span>
          <button type="button" className="ghost logout" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {page === "users" && user.is_staff ? <Users /> : page === "transfers" ? <BankTransfers /> : <Dashboard />}
    </div>
  );
}
