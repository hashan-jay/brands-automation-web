import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  ["pending_deposit", "Pending deposits", "pending-in", "PENDING", "DEPOSIT"],
  ["pending_withdraw", "Pending withdrawals", "pending-out", "PENDING", "WITHDRAW"],
  ["completed_deposit", "Completed deposits", "done-in", "COMPLETED", "DEPOSIT"],
  ["completed_withdraw", "Completed withdrawals", "done-out", "COMPLETED", "WITHDRAW"],
  ["bonus", "Bonus", "bonus", "All statuses", "BONUS"],
  ["forfeited", "Forfeited", "forfeited", "All statuses", "FORFEITED"],
  ["processing", "Processing", "processing", "PROCESSING", "All types"],
  ["rejected", "Rejected", "rejected", "REJECTED", "All types"],
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
  const [focus, setFocus] = useState("");
  const [live, setLive] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [opened, setOpened] = useState(null);
  const revision = useRef("");
  const tableRef = useRef(null);

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

  function selectWidget(key, nextStatus, nextType) {
    if (focus === key) {
      setFocus("");
      setStatus("All statuses");
      setType("All types");
    } else {
      setFocus(key);
      setStatus(nextStatus);
      setType(nextType);
    }
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearFocus() {
    setFocus("");
    setStatus("All statuses");
    setType("All types");
  }

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
  const rows = useMemo(() => {
    const source = focus ? (data?.rows || []).filter((row) => matchesWidget(row, focus)) : data?.rows || [];
    return sortRows(source, sortBy);
  }, [data, sortBy, focus]);
  if (data?.stats && data.stats.row_count == null) revision.current = "";
  const widgets = stats.other?.count ? [...WIDGETS, ["other", "Other", "other", "OTHER", "All types"]] : WIDGETS;
  const focusTitle = widgetTitle(focus, widgets);
  const brandSummary = data?.brand_summary || [];

  return (
    <>
    <BankLedger date={date} revision={data?.revision || ""} />
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
        <BankAccounts date={date} brands={brands} revision={data?.revision || ""} />
      </aside>

      <section className="main">
        <div className="toolbar">
          <h2>{focusTitle ? focusTitle : "Transactions"}</h2>
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
              <select
                value={status}
                onChange={(event) => {
                  setFocus("");
                  setStatus(event.target.value);
                }}
              >
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
              <select
                value={type}
                onChange={(event) => {
                  setFocus("");
                  setType(event.target.value);
                }}
              >
                <option>All types</option>
                <option>DEPOSIT</option>
                <option>WITHDRAW</option>
                <option>BONUS</option>
                <option>FORFEITED</option>
              </select>
            </label>
          </div>
        </div>

        <div className="table-wrap" ref={tableRef}>
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
                    {focusTitle ? `No ${focusTitle.toLowerCase()} for this date.` : "No transactions for this date yet."}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={`${row.brand}-${row.id}`}
                  className={`${rowClass(row)} txn-row`.trim()}
                  tabIndex={0}
                  title="Show this transaction"
                  onClick={() => openTransaction(row, setOpened)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openTransaction(row, setOpened);
                  }}
                >
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
            <button
              type="button"
              className={`stats-net${focus === "net_completed" ? " selected" : ""}`}
              aria-pressed={focus === "net_completed"}
              onClick={() => selectWidget("net_completed", "COMPLETED", "All types")}
            >
              <span>Net completed</span>
              <strong className={amountTone(bucket(stats, "net_completed").amount)}>
                {money(bucket(stats, "net_completed").amount)}
              </strong>
              <span>{Number(bucket(stats, "net_completed").count).toLocaleString()} deposits and withdrawals</span>
            </button>
          </div>
          <p className="stats-hint">
            {focusTitle ? (
              <>
                Showing {focusTitle.toLowerCase()}.{" "}
                <button type="button" className="text-button" onClick={clearFocus}>
                  Show all
                </button>
              </>
            ) : (
              "Click a card to list those transactions."
            )}
          </p>
          <div className={`widgets${focus ? " filtering" : ""}`}>
            {widgets.map(([key, title, tone, nextStatus, nextType]) => {
              const item = bucket(stats, key);
              const selected = focus === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`widget ${tone}${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => selectWidget(key, nextStatus, nextType)}
                >
                  <span className="widget-label">{title}</span>
                  <strong className={`widget-amount ${amountTone(item.amount)}`}>{money(item.amount)}</strong>
                  <span className="widget-count">{Number(item.count).toLocaleString()} transactions</span>
                </button>
              );
            })}
          </div>
          {brandSummary.length > 1 && (
            <div className="brand-chips">
              {brandSummary.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  className={`brand-chip${brand === item.name ? " selected" : ""}`}
                  aria-pressed={brand === item.name}
                  onClick={() => setBrand(brand === item.name ? "All" : item.name)}
                >
                  <strong>{item.name}</strong>
                  <span>{Number(item.rows).toLocaleString()} rows</span>
                  <span className={item.pending ? "chip-pending" : ""}>{Number(item.pending).toLocaleString()} pending</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
    {opened && <TransactionDialog request={opened} onClose={() => setOpened(null)} />}
    </>
  );
}

function openTransaction(row, setOpened) {
  const id = String(row?.id || "").trim();
  const brandName = String(row?.brand || "").trim();
  if (!id || !brandName) return;
  setOpened({ brand: brandName, id, token: Date.now() });
}

function TransactionDialog({ request, onClose }) {
  const [state, setState] = useState({ status: "loading", body: null, error: "" });
  const requestId = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const id = ++requestId.current;
    let stopped = false;
    setState({ status: "loading", body: null, error: "" });
    const params = new URLSearchParams({ brand: request.brand, id: request.id });
    api(`/api/transactions/detail/?${params.toString()}`)
      .then((body) => {
        if (stopped || id !== requestId.current) return;
        if (body?.id !== request.id || body?.brand !== request.brand) {
          setState({ status: "error", body: null, error: "The brand API returned a different transaction." });
          return;
        }
        setState({ status: "ready", body, error: "" });
      })
      .catch((err) => {
        if (!stopped && id === requestId.current) {
          setState({ status: "error", body: null, error: err.message });
        }
      });
    return () => {
      stopped = true;
    };
  }, [request]);

  const body = state.body;
  const title = body?.type ? `${body.type} ${body.id}` : request.id;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="txn-title">
        <div className="modal-head">
          <div>
            <h2 id="txn-title">{title}</h2>
            <p>
              {request.brand}
              {body?.status ? ` · ${body.status}` : ""}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            Close
          </button>
        </div>
        {state.status === "loading" && <p className="bank-hint">Loading this transaction from the brand API…</p>}
        {state.status === "error" && <p className="form-error">{state.error}</p>}
        {state.status === "ready" &&
          (body.sections || []).map((section) => (
            <section key={section.title} className="detail-section">
              <h3>{section.title}</h3>
              <dl className="detail-grid">
                {(section.fields || []).map((field) => (
                  <div key={`${section.title}-${field.label}`} className="detail-row">
                    <dt>{field.label}</dt>
                    <dd>
                      {field.href ? (
                        <a href={field.href} target="_blank" rel="noreferrer">
                          {field.value}
                        </a>
                      ) : (
                        field.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </div>
  );
}

const LEDGER_STATUSES = ["Block", "Withdraw only", "Deposit only", "Both", "Active", "Inactive"];

const LEDGER_CARDS = [
  ["status", "Status", "text"],
  ["bank_name", "Bank name", "text"],
  ["account_name", "Bank account name", "text"],
  ["opening", "Opening balance", "money"],
  ["closing", "Closing balance", "money"],
  ["limit", "Limit", "limit"],
  ["deposit", "Deposit", "money"],
  ["withdraw", "Withdraw", "money"],
  ["transfer_in", "Transfer in", "money"],
  ["pending", "Pending", "money"],
  ["complete", "Complete", "money"],
  ["transfer_out", "Transfer out", "money"],
  ["cash_in", "Cash in", "money"],
  ["cash_out", "Cash out", "money"],
];

function BankLedger({ date, revision }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [opened, setOpened] = useState(null);
  const request = useRef(0);
  const skipSave = useRef(false);
  const tableHead = useRef(null);
  const tableScroll = useRef(null);
  const totalScroll = useRef(null);
  const [columnWidths, setColumnWidths] = useState([]);
  const totals = useMemo(() => ledgerTotals(rows), [rows]);

  useLayoutEffect(() => {
    const head = tableHead.current;
    if (!head) return;
    const measure = () => {
      setColumnWidths([...head.children].map((cell) => cell.getBoundingClientRect().width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    return () => observer.disconnect();
  }, [rows]);

  function syncTotalScroll() {
    if (tableScroll.current && totalScroll.current) {
      totalScroll.current.scrollLeft = tableScroll.current.scrollLeft;
    }
  }

  useEffect(() => {
    const id = ++request.current;
    let stopped = false;
    setLoading(true);
    api(`/api/bank-ledger/?date=${encodeURIComponent(date)}`)
      .then((next) => {
        if (stopped || id !== request.current) return;
        setRows(next?.rows || []);
        setError("");
      })
      .catch((err) => {
        if (!stopped && id === request.current) setError(err.message);
      })
      .finally(() => {
        if (!stopped && id === request.current) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [date, revision]);

  function replaceRow(row) {
    setRows((current) =>
      current.map((item) =>
        item.bank_name === row.bank_name && item.account_name === row.account_name ? row : item,
      ),
    );
  }

  async function save(row, body) {
    const next = await api("/api/bank-ledger/", {
      method: "POST",
      body: { date, bank_name: row.bank_name, account_name: row.account_name, ...body },
    });
    if (next?.row) replaceRow(next.row);
  }

  async function changeStatus(row, status) {
    const previous = rows;
    replaceRow({ ...row, status });
    try {
      await save(row, { status });
      setError("");
    } catch (err) {
      setRows(previous);
      setError(err.message);
    }
  }

  function startLimit(row) {
    setEditing({ bank_name: row.bank_name, account_name: row.account_name, value: row.limit ?? "" });
  }

  async function finishLimit(row, input) {
    if (skipSave.current) {
      skipSave.current = false;
      setEditing(null);
      return;
    }
    const value = input.value;
    setEditing(null);
    const current = row.limit ?? "";
    if (value.trim() === current) return;
    try {
      await save(row, { limit: value.trim() });
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="ledger">
      <div className="ledger-intro">
        <h2>Bank balances</h2>
        <p>
          All brands · {formatDay(date)}. Opening balance is the previous day at 11:59 PM. Closing balance is that
          opening balance plus this day’s deposits and withdrawals.
        </p>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="ledger-wrap" ref={tableScroll} onScroll={syncTotalScroll}>
        <table className="ledger-table">
          <thead>
            <tr ref={tableHead}>
              <th>STATUS</th>
              <th>BANK NAME</th>
              <th>BANK ACCOUNT NAME</th>
              <th>OPENING BALANCE</th>
              <th>CLOSING BALANCE</th>
              <th>LIMIT</th>
              <th>DEPOSIT</th>
              <th>WITHDRAW</th>
              <th>TRANSFER IN</th>
              <th>PENDING</th>
              <th>COMPLETE</th>
              <th>TRANSFER OUT</th>
              <th>CASH IN</th>
              <th>CASH OUT</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && (
              <tr>
                <td className="ledger-empty" colSpan={14}>
                  Loading bank balances…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="ledger-empty" colSpan={14}>
                  No bank accounts for this date.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const editingLimit =
                editing && editing.bank_name === row.bank_name && editing.account_name === row.account_name;
              return (
                <tr
                  key={`${row.bank_name}\u0000${row.account_name}`}
                  className="ledger-row"
                  onClick={() => setOpened({ bank_name: row.bank_name, account_name: row.account_name })}
                >
                  <td
                    className={`ledger-status ${ledgerStatusClass(row.status)}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <select
                      aria-label={`Status for ${row.account_name}`}
                      value={row.status}
                      onChange={(event) => changeStatus(row, event.target.value)}
                    >
                      {LEDGER_STATUSES.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </td>
                  <td className="ledger-bank">{row.bank_name}</td>
                  <td className="ledger-account">{row.account_name}</td>
                  <td className="ledger-open">{money(row.opening)}</td>
                  <td className="ledger-close">{money(row.closing)}</td>
                  <td className="ledger-limit" onClick={(event) => event.stopPropagation()}>
                    {editingLimit ? (
                      <input
                        aria-label={`Limit for ${row.account_name}`}
                        value={editing.value}
                        autoFocus
                        inputMode="decimal"
                        placeholder="N/A"
                        onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                        onBlur={(event) => finishLimit(row, event.currentTarget)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            skipSave.current = true;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    ) : (
                      <button type="button" onClick={() => startLimit(row)}>
                        {row.limit == null ? "N/A" : money(row.limit)}
                      </button>
                    )}
                  </td>
                  <td className="ledger-deposit">{money(row.deposit)}</td>
                  <td className="ledger-withdraw">{money(row.withdraw)}</td>
                  <td className="ledger-later">{money(row.transfer_in)}</td>
                  <td className="ledger-later">{money(row.pending)}</td>
                  <td className="ledger-later">{money(row.complete)}</td>
                  <td className="ledger-later">{money(row.transfer_out)}</td>
                  <td className="ledger-later">{money(row.cash_in)}</td>
                  <td className="ledger-later">{money(row.cash_out)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="ledger-total-wrap" ref={totalScroll}>
          <table
            className="ledger-table ledger-total-table"
            style={{ width: columnWidths.reduce((sum, width) => sum + width, 0) || undefined }}
          >
            <colgroup>
              {columnWidths.map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <tbody>
              <tr className="ledger-total">
                <td className="ledger-total-label" colSpan={3}>
                  Total
                </td>
                <td className="ledger-open">{money(totals.opening)}</td>
                <td className="ledger-close">{money(totals.closing)}</td>
                <td className="ledger-limit">{totals.limit == null ? "N/A" : money(totals.limit)}</td>
                <td className="ledger-deposit">{money(totals.deposit)}</td>
                <td className="ledger-withdraw">{money(totals.withdraw)}</td>
                <td className="ledger-later">{money(totals.transfer_in)}</td>
                <td className="ledger-later">{money(totals.pending)}</td>
                <td className="ledger-later">{money(totals.complete)}</td>
                <td className="ledger-later">{money(totals.transfer_out)}</td>
                <td className="ledger-later">{money(totals.cash_in)}</td>
                <td className="ledger-later">{money(totals.cash_out)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {opened && (
        <BankDayDialog
          key={`${opened.bank_name}\u0000${opened.account_name}`}
          account={opened}
          revision={revision}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

function BankDayDialog({ account, revision, onClose }) {
  const [day, setDay] = useState(today);
  const [state, setState] = useState({ status: "loading", body: null, error: "" });
  const requestId = useRef(0);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const id = ++requestId.current;
    let stopped = false;
    setState((current) => ({
      status: "loading",
      body: current.body?.date === day ? current.body : null,
      error: "",
    }));
    const params = new URLSearchParams({
      date: day,
      bank_name: account.bank_name,
      account_name: account.account_name,
    });
    api(`/api/bank-ledger/day/?${params.toString()}`)
      .then((body) => {
        if (stopped || id !== requestId.current) return;
        if (body?.row?.bank_name !== account.bank_name || body?.row?.account_name !== account.account_name) {
          setState({ status: "error", body: null, error: "The bank account details did not match." });
          return;
        }
        setState({ status: "ready", body, error: "" });
      })
      .catch((err) => {
        if (!stopped && id === requestId.current) setState({ status: "error", body: null, error: err.message });
      });
    return () => {
      stopped = true;
    };
  }, [account, day, revision]);

  const row = state.body?.row;
  const transactions = state.body?.transactions || [];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal bank-day" role="dialog" aria-modal="true" aria-labelledby="bank-day-title">
        <div className="modal-head">
          <div>
            <h2 id="bank-day-title">
              {account.bank_name} · {account.account_name}
            </h2>
            <p>All brands · {formatDay(day)}</p>
          </div>
          <div className="bank-day-tools">
            <DateField value={day} onChange={setDay} />
            <button type="button" className="modal-close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="bank-day-body">
          {state.status === "error" && <p className="form-error">{state.error}</p>}
          {state.status === "loading" && !row && <p className="bank-hint">Loading this bank…</p>}
          {row && (
            <div className="bank-cards">
              {LEDGER_CARDS.map(([key, label, kind]) => (
                <article key={key} className={`bank-card card-${key}`}>
                  <span>{label}</span>
                  <strong className={kind === "money" ? amountTone(row[key]) : ""}>{ledgerCardValue(row, key, kind)}</strong>
                </article>
              ))}
            </div>
          )}
          <section className="detail-section">
            <h3>
              Transactions
              {state.status === "ready" ? ` · ${transactions.length.toLocaleString()}` : ""}
            </h3>
            {state.status === "ready" && transactions.length === 0 && (
              <p className="bank-hint">No transactions for this bank account on this date.</p>
            )}
            {transactions.length > 0 && (
              <div className="table-wrap bank-day-table">
                <table>
                  <thead>
                    <tr>
                      {COLUMNS.map(([key, label]) => (
                        <th key={key}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((item) => (
                      <tr key={`${item.brand}-${item.id}`} className={rowClass(item)}>
                        {COLUMNS.map(([key]) => (
                          <td key={key}>{item[key]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ledgerTotals(rows) {
  const keys = [
    "opening",
    "closing",
    "deposit",
    "withdraw",
    "transfer_in",
    "pending",
    "complete",
    "transfer_out",
    "cash_in",
    "cash_out",
  ];
  const totals = {};
  for (const key of keys) {
    totals[key] = fromCents(rows.reduce((sum, row) => sum + cents(row[key]), 0));
  }
  const limits = rows.filter((row) => row.limit != null);
  totals.limit = limits.length ? fromCents(limits.reduce((sum, row) => sum + cents(row.limit), 0)) : null;
  return totals;
}

function cents(value) {
  const text = String(value ?? "0").replace(/,/g, "").trim();
  if (!text || text.toUpperCase() === "N/A") return 0;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const amount = Number(whole || "0") * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -amount : amount;
}

function fromCents(amount) {
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

function ledgerCardValue(row, key, kind) {
  if (kind === "limit") return row.limit == null ? "N/A" : money(row.limit);
  if (kind === "money") return money(row[key]);
  return row[key] || "";
}

function ledgerStatusClass(status) {
  return `is-${String(status || "inactive").toLowerCase().replace(/\s+/g, "-")}`;
}

function BankAccounts({ date, brands, revision }) {
  const [game, setGame] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [directory, setDirectory] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const accountNameRef = useRef("");
  accountNameRef.current = accountName;

  useEffect(() => {
    if (!game) {
      setDirectory(null);
      setError("");
      setLoading(false);
      return;
    }
    const id = ++request.current;
    let stopped = false;
    setLoading(true);
    const params = new URLSearchParams({ date, brand: game });
    if (bankName) params.set("bank_name", bankName);
    const selectedName = accountNameRef.current;
    api(`/api/bank-accounts/?${params.toString()}`)
      .then((next) => {
        if (stopped || id !== request.current) return;
        setDirectory(next);
        setError("");
        if (bankName && !(next.banks || []).includes(bankName)) {
          setBankName("");
          setAccountName("");
        } else if (selectedName && !(next.accounts || []).some((item) => item.name === selectedName)) {
          setAccountName("");
        }
      })
      .catch((err) => {
        if (!stopped && id === request.current) setError(err.message);
      })
      .finally(() => {
        if (!stopped && id === request.current) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [date, game, bankName, revision]);

  function chooseGame(value) {
    setGame(value);
    setBankName("");
    setAccountName("");
    setDirectory(null);
  }

  function chooseBank(value) {
    setBankName(value);
    setAccountName("");
  }

  const accounts = directory?.bank_name === bankName ? directory.accounts || [] : [];
  const selected = accounts.find((item) => item.name === accountName) || null;
  const banks = directory?.banks || [];

  return (
    <section className="bank-section">
      <h3>Bank accounts</h3>
      <p className="bank-hint">
        Choose a game, then a bank name. Account names are only the ones that game uses for that bank.
      </p>
      <label>
        Game
        <select value={game} onChange={(event) => chooseGame(event.target.value)}>
          <option value="">Select a game</option>
          {brands.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Bank name
        <select value={bankName} onChange={(event) => chooseBank(event.target.value)} disabled={!game}>
          <option value="">{game ? "Select a bank" : "Select a game first"}</option>
          {banks.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="form-error">{error}</p>}
      {!game && <p className="bank-hint">Select a game to see the banks that apply to it.</p>}
      {game && !bankName && !loading && directory && banks.length === 0 && (
        <p className="bank-hint">No bank account names for this game on this date.</p>
      )}
      {game && !bankName && loading && banks.length === 0 && <p className="bank-hint">Loading banks…</p>}
      {bankName && loading && directory?.bank_name !== bankName && <p className="bank-hint">Loading account names…</p>}
      {bankName && directory?.bank_name === bankName && (
        <>
          <div className="bank-total">
            <span>
              Final balance · {game} · {bankName}
            </span>
            <strong className={amountTone(directory.balance)}>{money(directory.balance)}</strong>
            <p>
              {money(directory.deposits)} deposits · {money(directory.withdrawals)} withdrawals ·{" "}
              {Number(directory.count).toLocaleString()} completed
            </p>
            {selected && (
              <>
                <span>Selected account · {selected.name}</span>
                <strong className={amountTone(selected.balance)}>{money(selected.balance)}</strong>
                <p>
                  {money(selected.deposits)} deposits · {money(selected.withdrawals)} withdrawals ·{" "}
                  {Number(selected.count).toLocaleString()} completed
                </p>
              </>
            )}
          </div>
          {directory.unassigned?.count > 0 && (
            <p className="bank-hint">
              {Number(directory.unassigned.count).toLocaleString()} completed{" "}
              {directory.unassigned.count === 1 ? "transaction has" : "transactions have"} no account name (
              {money(directory.unassigned.balance)}). That amount is not included.
            </p>
          )}
          {accounts.length === 0 ? (
            <p className="bank-hint">No bank account names for this bank on this date.</p>
          ) : (
            <ul className="bank-list">
              {accounts.map((account) => (
                <li key={account.name}>
                  <button
                    type="button"
                    className={`bank-account${account.name === accountName ? " selected" : ""}`}
                    aria-pressed={account.name === accountName}
                    onClick={() => setAccountName(account.name === accountName ? "" : account.name)}
                  >
                    <span className="bank-account-name">{account.name}</span>
                    <span className={`bank-account-balance ${amountTone(account.balance)}`}>{money(account.balance)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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

function widgetTitle(key, widgets) {
  if (key === "net_completed") return "Net completed";
  return widgets.find((item) => item[0] === key)?.[1] || "";
}

function matchesWidget(row, key) {
  if (key === "net_completed") {
    const bucketName = rowBucket(row);
    return bucketName === "completed_deposit" || bucketName === "completed_withdraw";
  }
  return rowBucket(row) === key;
}

function rowBucket(row) {
  const status = row.status;
  const kind = row.type;
  if (status === "PENDING" && kind === "DEPOSIT") return "pending_deposit";
  if (status === "PENDING" && kind === "WITHDRAW") return "pending_withdraw";
  if (status === "PROCESSING") return "processing";
  if (status === "REJECTED") return "rejected";
  if (status === "COMPLETED" && kind === "DEPOSIT") return "completed_deposit";
  if (status === "COMPLETED" && kind === "WITHDRAW") return "completed_withdraw";
  if (kind === "BONUS") return "bonus";
  if (kind === "FORFEITED") return "forfeited";
  return "other";
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
