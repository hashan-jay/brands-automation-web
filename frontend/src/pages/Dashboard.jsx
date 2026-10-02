import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

const COLUMNS = [
  ["time", "Time (Sydney)"],
  ["id", "ID"],
  ["username", "Username"],
  ["name", "Name"],
  ["mobile", "Mobile"],
  ["amount", "Amount"],
  ["type", "Type"],
  ["bank_name", "Bank Name"],
  ["bank_account_name", "Bank Account Name"],
  ["bank", "Bank"],
  ["acc_name", "Acc Name"],
  ["acc_no", "Acc No"],
  ["bsb", "BSB"],
  ["pay_id", "PayID"],
  ["brand", "Brand"],
  ["created", "Created (Sydney)"],
  ["processed", "Processed (Sydney)"],
  ["status", "Status"],
  ["detail", "Detail"],
];

const EMPTY_BUCKET = { count: 0, amount: "0.00" };

const EMPTY_STATS = {
  pending_deposit: EMPTY_BUCKET,
  pending_withdraw: EMPTY_BUCKET,
  completed_deposit: EMPTY_BUCKET,
  completed_withdraw: EMPTY_BUCKET,
  bonus: EMPTY_BUCKET,
  forfeited: EMPTY_BUCKET,
  processing: EMPTY_BUCKET,
  rejected: EMPTY_BUCKET,
  other: EMPTY_BUCKET,
  net_completed: EMPTY_BUCKET,
  row_count: EMPTY_BUCKET,
};

const SORTS = [
  "Sort by Time",
  "Sort by Received Time",
  "Sort by Alphabetical Order",
  "Sort by Amount",
];

const WIDGETS = [
  ["pending_deposit", "Pending deposits", "pending-in"],
  ["pending_withdraw", "Pending withdrawals", "pending-out"],
  ["completed_deposit", "Completed deposits", "done-in"],
  ["completed_withdraw", "Completed withdrawals", "done-out"],
  ["bonus", "Bonus", "bonus"],
  ["forfeited", "Forfeited", "forfeited"],
  ["processing", "Processing", "processing"],
  ["rejected", "Rejected", "rejected"],
];

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function Dashboard() {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState("All");
  const [date, setDate] = useState(today);
  const [type, setType] = useState("All types");
  const [status, setStatus] = useState("All statuses");
  const [sortBy, setSortBy] = useState("Sort by Time");
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
  const rows = useMemo(() => sortRows(data?.rows || [], sortBy), [data, sortBy]);
  if (data?.stats && data.stats.row_count == null) revision.current = "";
  const widgets = stats.other?.count ? [...WIDGETS, ["other", "Other", "other"]] : WIDGETS;
  const brandSummary = data?.brand_summary || [];

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
        <DateField value={date} onChange={setDate} />
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
              Sort by
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                {SORTS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option>All statuses</option>
                <option>PENDING</option>
                <option>PROCESSING</option>
                <option>COMPLETED</option>
                <option>REJECTED</option>
                <option>OTHER</option>
              </select>
            </label>
            <label>
              Type
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option>All types</option>
                <option>DEPOSIT</option>
                <option>WITHDRAW</option>
                <option>BONUS</option>
                <option>FORFEITED</option>
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
                    <td
                      key={key}
                      className={
                        key === "bank_name" && row[key]
                          ? "bank-name"
                          : key === "bank_account_name" && row[key]
                            ? "bank-account"
                            : undefined
                      }
                    >
                      {row[key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats">
          <div className="stats-head">
            <div>
              <h3>Statistics</h3>
              <p>
                {brand} · {date} · {Number(bucket(stats, "row_count").count).toLocaleString()} transactions
              </p>
            </div>
            <div className="stats-net">
              <span>Net completed</span>
              <strong className={amountTone(bucket(stats, "net_completed").amount)}>
                {money(bucket(stats, "net_completed").amount)}
              </strong>
              <span>{Number(bucket(stats, "net_completed").count).toLocaleString()} deposits and withdrawals</span>
            </div>
          </div>
          <div className="widgets">
            {widgets.map(([key, title, tone]) => {
              const item = bucket(stats, key);
              return (
                <article key={key} className={`widget ${tone}`}>
                  <span className="widget-label">{title}</span>
                  <strong className={`widget-amount ${amountTone(item.amount)}`}>{money(item.amount)}</strong>
                  <span className="widget-count">{Number(item.count).toLocaleString()} transactions</span>
                </article>
              );
            })}
          </div>
          {brandSummary.length > 1 && (
            <div className="brand-chips">
              {brandSummary.map((item) => (
                <span key={item.name} className="brand-chip">
                  <strong>{item.name}</strong>
                  <span>{Number(item.rows).toLocaleString()} rows</span>
                  <span className={item.pending ? "chip-pending" : ""}>{Number(item.pending).toLocaleString()} pending</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function stamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return 0;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function DateField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => value.slice(0, 7));
  const root = useRef(null);

  useEffect(() => {
    function onPointer(event) {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggle() {
    setCursor(value.slice(0, 7));
    setOpen((current) => !current);
  }

  function pick(day) {
    onChange(day);
    setOpen(false);
  }

  return (
    <div className="date-field" ref={root}>
      <span className="date-label">Date</span>
      <button type="button" className="date-button" onClick={toggle} aria-expanded={open}>
        {formatDay(value)}
      </button>
      {open && <Calendar month={cursor} selected={value} onMonth={setCursor} onPick={pick} />}
    </div>
  );
}

function Calendar({ month, selected, onMonth, onPick }) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const startOffset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const cells = [];
  for (let index = 0; index < startOffset; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  const sydneyToday = today();

  function shift(amount) {
    const next = new Date(Date.UTC(year, monthIndex - 1 + amount, 1));
    const text = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    onMonth(text);
  }

  return (
    <div className="calendar" key={month}>
      <div className="calendar-head">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <strong>{first.toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
        <button type="button" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>
      <div className="calendar-week">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((day, index) => {
          if (!day) return <span key={`empty-${index}`} />;
          const iso = `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const className = ["calendar-day", iso === selected ? "selected" : "", iso === sydneyToday ? "today" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={iso} type="button" className={className} onClick={() => onPick(iso)}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatDay(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function receivedStamp(row) {
  return stamp(row.processed) || stamp(row.time);
}

function sortRows(rows, sortBy) {
  const next = [...rows];
  next.sort((left, right) => {
    if (sortBy === "Sort by Received Time") {
      return receivedStamp(right) - receivedStamp(left) || stamp(right.time) - stamp(left.time) || compareText(right.id, left.id);
    }
    if (sortBy === "Sort by Alphabetical Order") {
      const byName = compareName(left.name, right.name);
      if (byName) return byName;
      return stamp(right.time) - stamp(left.time);
    }
    if (sortBy === "Sort by Amount") {
      const byAmount = amountValue(left) - amountValue(right);
      if (byAmount) return byAmount;
      return compareName(left.name, right.name);
    }
    return stamp(right.time) - stamp(left.time) || compareText(right.id, left.id);
  });
  return next;
}

function amountValue(row) {
  const value = Number(row.amount);
  return Number.isFinite(value) ? value : 0;
}

function compareName(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a && b) return 1;
  if (a && !b) return -1;
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
}

function bucket(stats, key) {
  return stats[key] || EMPTY_BUCKET;
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0.00";
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function amountTone(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return "flat";
  return amount > 0 ? "up" : "down";
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
  if (row.type === "FORFEITED") return "forfeited";
  return "";
}
