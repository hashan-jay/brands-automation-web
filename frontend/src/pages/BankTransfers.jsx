import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DateField, formatDay, lockPageScroll, today } from "./Dashboard";

function formatMoney(value) {
  const cents = amountCents(value);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

function amountCents(value) {
  const text = String(value ?? "0").replace(/,/g, "").trim();
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const amount = Number(whole || "0") * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -amount : amount;
}

function accountKey(account) {
  return `${account.bank_name}\n${account.account_name}`;
}

function accountFromKey(key) {
  const [bank_name, account_name] = String(key || "").split("\n");
  return { bank_name: bank_name || "", account_name: account_name || "" };
}

function accountLabel(account) {
  return `${account.bank_name} · ${account.account_name}`;
}

export default function BankTransfers() {
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stopped = false;
    api("/api/bank-transfers/accounts/")
      .then((body) => {
        if (!stopped) setAccounts(body?.accounts || []);
      })
      .catch((err) => {
        if (!stopped) setError(err.message);
      });
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    const params = new URLSearchParams({ date });
    api(`/api/bank-transfers/?${params.toString()}`)
      .then((body) => {
        if (stopped) return;
        setRows(body?.rows || []);
        setError("");
      })
      .catch((err) => {
        if (!stopped) setError(err.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [date]);

  const total = useMemo(() => {
    const cents = rows.reduce((sum, row) => sum + amountCents(row.amount), 0);
    const negative = cents < 0;
    const abs = Math.abs(cents);
    const text = `${Math.floor(abs / 100).toLocaleString()}.${String(abs % 100).padStart(2, "0")}`;
    return negative ? `-${text}` : text;
  }, [rows]);

  function saved(row) {
    setOpen(false);
    setNotice(
      `${row.from_bank_name} · ${row.from_account_name} sent ${formatMoney(row.amount)} to ${row.to_bank_name} · ${row.to_account_name} on ${formatDay(row.transfer_date)}.`,
    );
    setDate(row.transfer_date);
  }

  return (
    <div className="users-page transfers-page">
      <header className="users-head">
        <div>
          <h2>Bank transfers</h2>
          <p>
            Record cash moved by hand from one bank app to another. The transfer date is the day the money moved.
            Day created is the day this row was entered. Bank balances use the transfer date.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => { setNotice(""); setOpen(true); }}>
          Transfer money
        </button>
      </header>

      {error && <div className="form-error">{error}</div>}
      {notice && <p className="users-notice">{notice}</p>}

      <section className="card transfers-panel">
        <div className="transfers-tools">
          <DateField value={date} onChange={setDate} label="Transfer date" />
          <p className="transfers-count">
            <strong>{rows.length.toLocaleString()}</strong>
            {rows.length === 1 ? " transfer" : " transfers"}
            <span> · {total}</span>
          </p>
        </div>
        <div className="table-wrap transfers-table">
          <table>
            <thead>
              <tr>
                <th>Transfer date</th>
                <th>From bank</th>
                <th>From account</th>
                <th>To bank</th>
                <th>To account</th>
                <th>Amount</th>
                <th>Day created</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>Loading bank transfers…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td className="empty" colSpan={7}>No bank transfers on {formatDay(date)}.</td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDay(row.transfer_date)}</td>
                  <td className="bank-name">{row.from_bank_name}</td>
                  <td className="bank-account">{row.from_account_name}</td>
                  <td className="bank-name">{row.to_bank_name}</td>
                  <td className="bank-account">{row.to_account_name}</td>
                  <td className="transfer-amount">{formatMoney(row.amount)}</td>
                  <td>{formatDay(row.created_on)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <TransferDialog
          accounts={accounts}
          initialDate={date}
          onClose={() => setOpen(false)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function TransferDialog({ accounts, initialDate, onClose, onSaved }) {
  const [date, setDate] = useState(initialDate || today);
  const [fromKey, setFromKey] = useState("");
  const [toKey, setToKey] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => lockPageScroll(), []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && !document.querySelector(".transfer-dialog .calendar")) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    const from = accountFromKey(fromKey);
    const to = accountFromKey(toKey);
    if (!from.bank_name || !to.bank_name) {
      setError("Choose the bank the money leaves and the bank it arrives in.");
      return;
    }
    if (fromKey === toKey) {
      setError("Choose two different bank accounts.");
      return;
    }
    const text = amount.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) <= 0) {
      setError("Enter an amount greater than zero, with at most two decimal places.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = await api("/api/bank-transfers/", {
        method: "POST",
        body: {
          date,
          from_bank_name: from.bank_name,
          from_account_name: from.account_name,
          to_bank_name: to.bank_name,
          to_account_name: to.account_name,
          amount: text,
        },
      });
      onSaved(body.row);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="modal transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <h2 id="transfer-title">Transfer money</h2>
            <p>The date below is the day the money moved between the bank apps.</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>Close</button>
        </div>
        <DateField value={date} onChange={setDate} label="Transfer date" />
        <label>
          From bank
          <select value={fromKey} onChange={(event) => setFromKey(event.target.value)} required>
            <option value="">Select the account the money leaves</option>
            {accounts.map((account) => (
              <option key={`from-${accountKey(account)}`} value={accountKey(account)} disabled={accountKey(account) === toKey}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <label>
          To bank
          <select value={toKey} onChange={(event) => setToKey(event.target.value)} required>
            <option value="">Select the account the money arrives in</option>
            {accounts.map((account) => (
              <option key={`to-${accountKey(account)}`} value={accountKey(account)} disabled={accountKey(account) === fromKey}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save transfer"}
        </button>
      </form>
    </div>
  );
}
