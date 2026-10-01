import { useEffect, useState } from "react";
import { api } from "../api";

export default function Users() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isStaff, setIsStaff] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    try {
      await api("/api/auth/users/", {
        method: "POST",
        body: { username, password, is_staff: isStaff },
      });
      setUsername("");
      setPassword("");
      setIsStaff(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(user, patch) {
    setError("");
    try {
      await api(`/api/auth/users/${user.id}/`, { method: "PATCH", body: patch });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="users">
      <form className="card" onSubmit={createUser}>
        <h2>New user</h2>
        <p>Accounts can sign in from any device. The brand API keys stay on this server.</p>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={isStaff} onChange={(event) => setIsStaff(event.target.checked)} />
          Staff (can manage users)
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Create user"}
        </button>
      </form>
      <div className="card">
        <h2>Accounts</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Staff</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>
                    <input type="checkbox" checked={user.is_staff} onChange={(event) => updateUser(user, { is_staff: event.target.checked })} />
                  </td>
                  <td>
                    <input type="checkbox" checked={user.is_active} onChange={(event) => updateUser(user, { is_active: event.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
