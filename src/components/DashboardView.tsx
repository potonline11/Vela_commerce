import React, { useState } from 'react';
import { CheckCircle2, ShieldCheck, Wallet } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import { submitPayoutWithdrawal } from '../services/commerceService';
import type {
  CommissionRecord,
  MemberProfile,
  OrderRecord,
  PayoutRequestRecord,
  SecurityLogRecord,
} from '../types';

interface DashboardViewProps {
  lang: Lang;
  user: User | null;
  profile: MemberProfile | null;
  orders: OrderRecord[];
  commissions: CommissionRecord[];
  payouts: PayoutRequestRecord[];
  securityLogs: SecurityLogRecord[];
  onSignIn: () => Promise<void>;
}

export function DashboardView({
  lang,
  user,
  profile,
  orders,
  commissions,
  payouts,
  securityLogs,
  onSignIn,
}: DashboardViewProps) {
  const t = COPY[lang];
  const [payoutAmount, setPayoutAmount] = useState('500');
  const [payoutDest, setPayoutDest] = useState('089-XXX-4567');
  const [payoutMethod, setPayoutMethod] = useState<'promptpay' | 'bank_transfer'>('promptpay');
  const [payoutMsg, setPayoutMsg] = useState('');
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [verifyResults, setVerifyResults] = useState<Record<string, { verified: boolean; mode: string }>>({});

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(val);

  if (!user) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">{t.signInRequiredTitle}</h2>
        <p className="text-sm text-slate-600 leading-relaxed">{t.signInRequiredDesc}</p>
        <button
          type="button"
          onClick={onSignIn}
          className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
        >
          {t.signIn}
        </button>
      </div>
    );
  }

  const totalGmv = orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalEarned = profile?.totalCommissionEarned || 0;
  const walletBalance = profile?.walletBalance || 0;

  // Build 6-point series from real orders & commissions (falls back cleanly to zero baseline if empty)
  const chartPoints = [1, 2, 3, 4, 5, 6].map((slot) => {
    const sliceOrders = orders.filter((_, idx) => idx % 6 === slot - 1);
    const sliceComm = commissions.filter((_, idx) => idx % 6 === slot - 1);
    const sales = sliceOrders.reduce((s, o) => s + o.totalAmount, 0);
    const comm = sliceComm.reduce((s, c) => s + c.commissionAmount, 0);
    return { label: `P${slot}`, sales, comm };
  });
  const maxChartVal = Math.max(1000, ...chartPoints.map((p) => p.sales));

  const handlePayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setPayoutMsg('');
    setSubmittingPayout(true);
    try {
      await submitPayoutWithdrawal(profile, Number(payoutAmount), payoutDest, payoutMethod);
      setPayoutMsg(lang === 'th' ? 'ส่งคำขอถอนเงินเรียบร้อยแล้ว' : 'Withdrawal request submitted.');
    } catch (err) {
      setPayoutMsg(err instanceof Error ? err.message : 'Unable to submit payout');
    } finally {
      setSubmittingPayout(false);
    }
  };

  const handleVerifySignature = async (order: OrderRecord) => {
    const res = await fetch('/api/payments/verify-signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentCode: order.paymentIntentId,
        signature: order.paymentSignature,
      }),
    });
    const data = await res.json();
    setVerifyResults((prev) => ({
      ...prev,
      [order.id]: { verified: Boolean(data.verified), mode: data.mode || 'verified' },
    }));
  };

  return (
    <div className="space-y-10">
      <div className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{t.dashboardTitle}</h1>
        <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{t.dashboardSubtitle}</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.totalSales}</span>
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">
            {formatThb(totalGmv)}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.totalCommission}</span>
          <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
            {formatThb(totalEarned)}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.walletBalance}</span>
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">
            {formatThb(walletBalance)}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.activeOrders}</span>
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Analytics Chart + Payout Request */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">{t.revenueChartTitle}</h2>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>Sales (Slate)</span>
              <span aria-hidden="true">/</span>
              <span className="text-emerald-700">Commissions (Emerald)</span>
            </div>
          </div>

          <div className="h-56 flex items-end gap-4 pt-4 border-t border-slate-100">
            {chartPoints.map((pt) => {
              const salesPct = Math.max(4, Math.round((pt.sales / maxChartVal) * 100));
              const commPct = Math.max(2, Math.round((pt.comm / maxChartVal) * 100));
              return (
                <div key={pt.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <div className="w-full flex items-end justify-center gap-1.5 h-40">
                    <div
                      className="w-5 bg-slate-900 rounded-t-sm transition-all duration-300"
                      style={{ height: `${salesPct}%` }}
                      title={`Sales: ${formatThb(pt.sales)}`}
                    />
                    <div
                      className="w-5 bg-emerald-600 rounded-t-sm transition-all duration-300"
                      style={{ height: `${commPct}%` }}
                      title={`Commission: ${formatThb(pt.comm)}`}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-500">{pt.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">{t.payoutTitle}</h2>
          </div>

          <form onSubmit={handlePayoutSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">{t.payoutAmount}</label>
              <input
                type="number"
                min={100}
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
              />
            </div>

            <div>
              <label className="text-xs text-slate-600 block mb-1">{t.payoutDestination}</label>
              <input
                type="text"
                required
                value={payoutDest}
                onChange={(e) => setPayoutDest(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPayoutMethod('promptpay')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                  payoutMethod === 'promptpay'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                PromptPay
              </button>
              <button
                type="button"
                onClick={() => setPayoutMethod('bank_transfer')}
                className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                  payoutMethod === 'bank_transfer'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                Bank Transfer
              </button>
            </div>

            {payoutMsg && <p className="text-xs text-slate-700">{payoutMsg}</p>}

            <button
              type="submit"
              disabled={submittingPayout || walletBalance < 100}
              className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {t.requestPayoutBtn}
            </button>
          </form>

          {payouts.length > 0 && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              {payouts.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-600">{p.destinationMasked}</span>
                  <span className="font-mono tabular-nums text-slate-900">
                    {formatThb(p.amount)} · {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Commission Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{t.commissionLedgerTitle}</h2>
          <span className="text-xs text-slate-500 tabular-nums">{commissions.length} entries</span>
        </div>

        {commissions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            ยังไม่มีประวัติค่าคอมมิชชั่น เมื่อมีคำสั่งซื้อในสายงานยอดจะอัปเดตแบบเรียลไทม์ที่นี่
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-6 font-medium">Order</th>
                  <th className="py-3 px-6 font-medium">Tier</th>
                  <th className="py-3 px-6 font-medium text-right">Rate</th>
                  <th className="py-3 px-6 font-medium text-right">Amount</th>
                  <th className="py-3 px-6 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {commissions.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-6 font-mono text-xs text-slate-900">{c.orderNumber}</td>
                    <td className="py-3 px-6 text-xs text-slate-700">Tier {c.tier}</td>
                    <td className="py-3 px-6 font-mono text-xs text-slate-600 text-right tabular-nums">
                      {c.ratePercent.toFixed(1)}%
                    </td>
                    <td className="py-3 px-6 font-mono text-xs font-semibold text-emerald-700 text-right tabular-nums">
                      +{formatThb(c.commissionAmount)}
                    </td>
                    <td className="py-3 px-6 text-xs text-slate-700">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Gateway HMAC Verification & Security Audit */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <h2 className="text-base font-semibold text-slate-900">{t.securityAuditTitle}</h2>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">{securityLogs.length} audit events</span>
        </div>

        <div className="divide-y divide-slate-100">
          {orders.slice(0, 5).map((ord) => {
            const v = verifyResults[ord.id];
            return (
              <div key={ord.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-900">{ord.orderNumber}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{ord.paymentIntentId}</span>
                    <span aria-hidden="true">·</span>
                    <span>{ord.paymentMethod}</span>
                  </div>
                  <p className="text-xs font-mono text-slate-500 truncate">
                    Signature: {ord.paymentSignature}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {v && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {v.verified
                        ? v.mode === 'velapayment_live_api'
                          ? 'VelaPayment Verified'
                          : 'HMAC Valid'
                        : 'Check Failed'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleVerifySignature(ord)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap"
                  >
                    {t.verifySignatureBtn}
                  </button>
                </div>
              </div>
            );
          })}

          {orders.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              ยังไม่มีรายการธุรกรรม Payment Gateway
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
