import type { BasketRow } from "../types";
import { formatUsd, parseMoneyInput } from "../lib/cardAppUtils";

type SidebarProps = {
  basket: BasketRow[];
  onUpdatePaid: (id: string, paidCents: number | null) => void;
  onUpdateMethod: (id: string, method: BasketRow["method"]) => void;
  onRemoveRow: (id: string) => void;
};

export function Sidebar({ basket, onUpdatePaid, onUpdateMethod, onRemoveRow }: SidebarProps) {
  return (
    <aside className="layout-sidebar" aria-label="Sidebar">
      <section className="basket-section" aria-label="Buy basket">
        <h2 className="basket-title">Buy basket / inventory</h2>
        <div className="basket-table-wrap">
          <table className="basket-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Card</th>
                <th>Paid</th>
                <th>Current value</th>
                <th>Profit / loss</th>
                <th>Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {basket.length === 0 ? (
                <tr>
                  <td colSpan={7} className="basket-empty-cell">
                    No cards added yet.
                  </td>
                </tr>
              ) : (
                basket.map((row) => {
                  const profit =
                    row.paidCents != null && row.currentValueCents != null
                      ? row.currentValueCents - row.paidCents
                      : null;
                  return (
                    <tr key={row.id}>
                      <td className="nowrap">{new Date(row.addedAt).toLocaleString()}</td>
                      <td>{row.cardLabel}</td>
                      <td>
                        <input
                          key={`paid-${row.id}-${row.paidCents ?? "x"}`}
                          className="basket-money-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label="Paid"
                          defaultValue={
                            row.paidCents != null ? (row.paidCents / 100).toFixed(2) : ""
                          }
                          onBlur={(e) => onUpdatePaid(row.id, parseMoneyInput(e.target.value))}
                        />
                      </td>
                      <td>{formatUsd(row.currentValueCents)}</td>
                      <td className={profit != null && profit >= 0 ? "profit-pos" : profit != null ? "profit-neg" : ""}>
                        {profit != null ? formatUsd(profit) : "—"}
                      </td>
                      <td>
                        <select
                          className="basket-method-select"
                          value={row.method}
                          onChange={(e) =>
                            onUpdateMethod(row.id, e.target.value as BasketRow["method"])
                          }
                        >
                          <option value="">—</option>
                          <option value="cash">Cash</option>
                          <option value="trade">Trade</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => onRemoveRow(row.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </aside>
  );
}
