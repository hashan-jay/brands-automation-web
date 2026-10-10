import { useEffect, useState } from "react";
import { api } from "../api";

export default function Users() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingId, setSavingId] = useState(null);

  async function load() {
    setUsers(await api("/api/auth/users/"));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function createUser(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/auth/users/", {
        method: "POST",
        body: { username, password, is_staff: isStaff },
      });
      setUsername("");
      setPassword("");
      setShowPassword(false);
      setIsStaff(false);
      setNotice(`${username.trim()} can sign in now.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(user, patch) {
    setError("");
    setNotice("");
    setSavingId(user.id);
    try {
      await api(`/api/auth/users/${user.id}/`, { method: "PATCH", body: patch });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  const staffCount = users.filter((user) => user.is_staff).length;
  const activeCount = users.filter((user) => user.is_active).length;

  return (
    <div className="users-page">
      <header className="users-head">
        <div>
          <h2>People</h2>
          <p>Create sign-in accounts and choose who can manage them. Brand API keys stay on this server.</p>
        </div>
        <div className="users-summary">
          <span><strong>{users.length}</strong> accounts</span>
          <span><strong>{staffCount}</strong> staff</span>
          <span><strong>{activeCount}</strong> can sign in</span>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {notice && <p className="users-notice">{notice}</p>}

      <div className="users">
        <form className="card users-create" onSubmit={createUser}>
          <div>
            <h2>New account</h2>
            <p>They sign in from any device with this username and password.</p>
          </div>
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="off"
              placeholder="Name they type at sign-in"
            />
          </label>
          <label>
            Password
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
              <button type="button" className="text-button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          <label className="switch-row">
            <span>
              <strong>Staff</strong>
              <small>Can open this page and change other accounts</small>
            </span>
            <input className="switch" type="checkbox" checked={isStaff} onChange={(event) => setIsStaff(event.target.checked)} />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <section className="card users-list">
          <div className="users-list-head">
            <h2>Accounts</h2>
            <p>Staff can manage people. Turning Active off stops that person from signing in.</p>
          </div>
          {users.length === 0 && <p className="users-empty">No accounts yet.</p>}
          <ul className="account-list">
            {users.map((user) => (
              <li key={user.id} className={user.is_active ? "account" : "account is-paused"}>
                <span className="who-mark account-mark" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
                <div className="account-id">
                  <strong>{user.username}</strong>
                  <span className="account-pills">
                    <span className={user.is_staff ? "pill staff" : "pill"}>{user.is_staff ? "Staff" : "Standard"}</span>
                    <span className={user.is_active ? "pill on" : "pill off"}>{user.is_active ? "Can sign in" : "Sign-in paused"}</span>
                  </span>
                </div>
                <label className="switch-field">
                  <span>Staff</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={user.is_staff}
                    disabled={savingId === user.id}
                    onChange={(event) => updateUser(user, { is_staff: event.target.checked })}
                  />
                </label>
                <label className="switch-field">
                  <span>Active</span>
                  <input
                    className="switch"
                    type="checkbox"
                    checked={user.is_active}
                    disabled={savingId === user.id}
                    onChange={(event) => updateUser(user, { is_active: event.target.checked })}
                  />
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
