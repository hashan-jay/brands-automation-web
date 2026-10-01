import { useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";
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
        <div>
          <h1>Brands Automation</h1>
          <p>Live deposits and withdrawals from each brand API.</p>
        </div>
        <div className="top-actions">
          {user.is_staff && (
            <button type="button" className="ghost" onClick={() => setPage(page === "users" ? "dashboard" : "users")}>
              {page === "users" ? "Transactions" : "Users"}
            </button>
          )}
          <span className="who">{user.username}</span>
          <button type="button" className="ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      {page === "users" && user.is_staff ? <Users /> : <Dashboard />}
    </div>
  );
}
