import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const COLUMNS = [
  ["time", "Time"],
  ["id", "ID"],
  ["username", "Username"],
  ["name", "Name"],
  ["mobile", "Mobile"],
  ["amount", "Amount"],
  ["type", "Type"],
  ["bank_name", "Bank Name"],
  ["bank", "Bank"],
  ["acc_name", "Acc Name"],
  ["acc_no", "Acc No"],
  ["bsb", "BSB"],
  ["pay_id", "PayID"],
  ["brand", "Brand"],
  ["created", "Created"],
  ["processed", "Processed"],
  ["status", "Status"],
  ["detail", "Detail"],
];

const EMPTY_STATS = {
  pending_deposit: { count: 0, amount: "0.00" },
  pending_withdraw: { count: 0, amount: "0.00" },
  completed_deposit: { count: 0, amount: "0.00" },
  completed_withdraw: { count: 0, amount: "0.00" },
};

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function Dashboard() {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState("All");
  const [date, setDate] = useState(today);
  const [type, setType] = useState("All types");
  const [status, setStatus] = useState("All statuses");
  const [live, setLive] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const revision = useRef("");

  useEffect(() => {
    api("/api/brands/")
      .then(setBrands)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let loading = false;
    revision.current = "";

    async function load() {
      if (loading) return;
      loading = true;
      const params = new URLSearchParams({ date, brand, type, status });
      if (revision.current) params.set("rev", revision.current);
      try {
        const next = await api(`/api/dashboard/?${params.toString()}`);
        if (stopped) return;
        if (next?.unchanged) {
          if (next.revision) revision.current = String(next.revision);
          setError("");
          return;
        }
        if (next?.revision) revision.current = String(next.revision);
        setData(next);
        setError("");
      } catch (err) {
        if (!stopped) setError(err.message);
      } finally {
        loading = false;
      }
    }

    load();
    if (live) timer = window.setInterval(load, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [brand, date, type, status, live]);

  async function refreshNow() {
    setRefreshing(true);
    setError("");
    try {
      await api("/api/sync/", { method: "POST", body: { date } });
      const params = new URLSearchParams({ date, brand, type, status });
      const next = await api(`/api/dashboard/?${params.toString()}`);
      if (next?.revision) revision.current = String(next.revision);
      if (!next?.unchanged) setData(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  const stats = data?.stats || EMPTY_STATS;
  const rows = data?.rows || [];
  const cards = [
    ["pending_deposit", "Pending deposits"],
    ["pending_withdraw", "Pending withdrawals"],
    ["completed_deposit", "Completed deposits"],
    ["completed_withdraw", "Completed withdrawals"],
  ];

  return (
    <div className="workspace">
      <aside className="side">
        <label>
          Brand
          <select value={brand} onChange={(event) => setBrand(event.target.value)}>
            <option>All</option>
            {brands.map((item) => (
              <option key={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="button" className={live ? "live on" : "live off"} onClick={() => setLive((value) => !value)}>
          {live ? "Live: ON" : "Live: OFF"}
        </button>
        <button type="button" className="primary" onClick={refreshNow} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
        <p className="status">{statusText(live, refreshing, data)}</p>
        {error && <p className="form-error">{error}</p>}
      </aside>

      <section className="main">
        <div className="toolbar">
          <h2>Transactions</h2>
          <div className="filters">
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option>All statuses</option>
                <option>PENDING</option>
                <option>COMPLETED</option>
                <option>REJECTED</option>
              </select>
            </label>
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option>All types</option>
                <option>DEPOSIT</option>
                <option>WITHDRAW</option>
                <option>BONUS</option>
              </select>
            </label>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={COLUMNS.length}>
                    No transactions for this date yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={`${row.brand}-${row.id}`} className={rowClass(row)}>
                  {COLUMNS.map(([key]) => (
                    <td key={key} className={key === "bank_name" && row[key] ? "bank-name" : undefined}>
                      {row[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats">
          <h3>Statistics · {brand}</h3>
          <div className="cards">
            {cards.map(([key, title]) => (
              <article key={key}>
                <span>{title}</span>
                <strong>
                  {stats[key].count} · {Number(stats[key].amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </strong>
              </article>
            ))}
          </div>
          <p>{data?.brand_line || "Waiting for the first API response."}</p>
        </div>
      </section>
    </div>
  );
}

function statusText(live, refreshing, data) {
  if (refreshing) return "Reading the brand APIs.";
  const line = data?.status_line || "Waiting for the first API response.";
  if (live) return line;
  return `Live is off. ${line.replace(/^Live\s/, "")}`;
}

function rowClass(row) {
  if (row.status === "PENDING") return "pending";
  if (row.status === "REJECTED") return "rejected";
  if (row.type === "DEPOSIT") return "deposit";
  if (row.type === "WITHDRAW") return "withdraw";
  if (row.type === "BONUS") return "bonus";
  return "";
}
