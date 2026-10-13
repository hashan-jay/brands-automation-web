import { useEffect, useState } from "react";
import { api } from "../api";
import { DateField, formatDay, today } from "./Dashboard";

const EMPTY = {
  registered: { count: 0, loaded: 0, complete: false, page: 1, pages: 1, rows: [] },
  played: { count: 0, rows: [] },
  joined: { count: 0, rows: [] },
  errors: [],
};

export default function Customers() {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState("All");
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/api/brands/")
      .then(setBrands)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let stopped = false;
    let inflight = false;
    let timer = 0;

    async function load() {
      if (stopped || inflight) return;
      inflight = true;
      const params = new URLSearchParams({
        date,
        brand,
        q,
        page: String(page),
      });
      try {
        const next = await api(`/api/customers/?${params.toString()}`);
        if (stopped) return;
        setData(next);
        setError("");
        if (next?.registered?.page && next.registered.page !== page) {
          setPage(next.registered.page);
        }
      } catch (err) {
        if (!stopped) setError(err.message);
      } finally {
        inflight = false;
        if (!stopped) setLoading(false);
      }
    }

    setLoading(true);
    load();
    timer = window.setInterval(load, 8000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [date, brand, q, page]);

  const registered = data.registered || EMPTY.registered;
  const played = data.played || EMPTY.played;
  const joined = data.joined || EMPTY.joined;
  const dayLabel = formatDay(date);

  return (
    <div className="users-page customers-page">
      <header className="users-head">
        <div>
          <h2>Customers</h2>
          <p>
            Players from each brand. The calendar picks the day for who played and who joined.
            The first list is everyone registered.
          </p>
        </div>
        <div className="customer-tools">
          <DateField value={date} onChange={setDate} label="Day" />
          <div className="users-summary">
            <span>
              <strong>{registered.loaded.toLocaleString()}</strong> registered
            </span>
            <span>
              <strong>{played.count.toLocaleString()}</strong> played
            </span>
            <span>
              <strong>{joined.count.toLocaleString()}</strong> joined
            </span>
          </div>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {(data.errors || []).map((message) => (
        <div className="form-error" key={message}>{message}</div>
      ))}

      <section className="card customer-section">
        <div className="customer-head">
          <div>
            <p className="customer-kicker">Section 1</p>
            <h3>All registered customers</h3>
            <p>
              Every player account saved from the brands.
              {!registered.complete && " The rest of the register is still loading."}
            </p>
          </div>
          <div className="customer-tools">
            <label>
              Brand
              <select
                value={brand}
                onChange={(event) => {
                  setBrand(event.target.value);
                  setPage(1);
                }}
              >
                <option value="All">All brands</option>
                {brands.map((item) => (
                  <option key={item.id} value={item.name}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              Search
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Username, name, or mobile"
              />
            </label>
          </div>
        </div>
        <p className="transfers-count">
          <strong>{registered.count.toLocaleString()}</strong>
          {registered.count === 1 ? " customer" : " customers"}
          {q ? " match this search" : ""}
        </p>
        <div className="table-wrap customer-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Brand</th>
                <th>Status</th>
                <th>Registered (Sydney)</th>
                <th>Last visit (Sydney)</th>
              </tr>
            </thead>
            <tbody>
              {loading && registered.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>Loading customers…</td>
                </tr>
              )}
              {!loading && registered.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>
                    {q ? "No customers match that search." : "No registered customers yet."}
                  </td>
                </tr>
              )}
              {registered.rows.map((row) => (
                <tr key={`${row.brand}-${row.id}`}>
                  <td>{row.username}</td>
                  <td>{row.name}</td>
                  <td>{row.mobile}</td>
                  <td>{row.email}</td>
                  <td className="bank-name">{row.brand}</td>
                  <td>{row.status}</td>
                  <td>{row.registered}</td>
                  <td>{row.visited}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={registered.page} pages={registered.pages} onPage={setPage} />
      </section>

      <section className="card customer-section">
        <div className="customer-head">
          <div>
            <p className="customer-kicker">Section 2</p>
            <h3>Played on {dayLabel}</h3>
            <p>
              Customers with a transaction on this day. Games is how many brands they were active on.
              Deposits and withdrawals are the number of those transactions.
            </p>
          </div>
        </div>
        <p className="transfers-count">
          <strong>{played.count.toLocaleString()}</strong>
          {played.count === 1 ? " customer" : " customers"} played
        </p>
        <div className="table-wrap customer-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Games</th>
                <th>Brands</th>
                <th>Deposits</th>
                <th>Withdrawals</th>
              </tr>
            </thead>
            <tbody>
              {loading && played.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>Loading the day…</td>
                </tr>
              )}
              {!loading && played.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>No customers played on {dayLabel}.</td>
                </tr>
              )}
              {played.rows.map((row, index) => (
                <tr key={`${row.username}-${row.name}-${row.mobile}-${index}`}>
                  <td>{row.username}</td>
                  <td>{row.name}</td>
                  <td>{row.mobile}</td>
                  <td className="customer-count">{row.games}</td>
                  <td>{(row.brands || []).join(", ")}</td>
                  <td className="customer-count">{row.deposits}</td>
                  <td className="customer-count">{row.withdrawals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card customer-section">
        <div className="customer-head">
          <div>
            <p className="customer-kicker">Section 3</p>
            <h3>Joined on {dayLabel}</h3>
            <p>
              Customers who registered on a brand this day, with that brand and how many deposits
              and withdrawals they made the same day.
            </p>
          </div>
        </div>
        <p className="transfers-count">
          <strong>{joined.count.toLocaleString()}</strong>
          {joined.count === 1 ? " new customer" : " new customers"}
        </p>
        <div className="table-wrap customer-table">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Email</th>
                <th>Brand</th>
                <th>Registered (Sydney)</th>
                <th>Deposits</th>
                <th>Withdrawals</th>
              </tr>
            </thead>
            <tbody>
              {loading && joined.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>Loading new customers…</td>
                </tr>
              )}
              {!loading && joined.rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={8}>No new customers joined on {dayLabel}.</td>
                </tr>
              )}
              {joined.rows.map((row) => (
                <tr key={`${row.brand}-${row.id}`}>
                  <td>{row.username}</td>
                  <td>{row.name}</td>
                  <td>{row.mobile}</td>
                  <td>{row.email}</td>
                  <td className="bank-name">{row.brand}</td>
                  <td>{row.registered}</td>
                  <td className="customer-count">{row.deposits}</td>
                  <td className="customer-count">{row.withdrawals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Pager({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="customer-pager">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page.toLocaleString()} of {pages.toLocaleString()}
      </span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
