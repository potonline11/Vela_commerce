import React, { useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Eye,
  EyeOff,
  Gavel,
  LayoutDashboard,
  Link2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import {
  adminCancelAuction,
  adminProcessPayoutRequest,
  adminUpdateMemberStatus,
  archiveMemberListing,
  fetchOrderShippingPii,
  syncOrderTrackingWithCj,
} from '../services/commerceService';
import type {
  AuctionRecord,
  CjStatusResponse,
  CommissionRecord,
  MemberListingRecord,
  MemberProfile,
  OrderRecord,
  OrderShippingPii,
  PayoutRequestRecord,
  ProductItem,
  SecurityLogRecord,
} from '../types';

type AdminSection = 'overview' | 'payouts' | 'members' | 'orders_market' | 'system_cj';

interface AdminViewProps {
  lang: Lang;
  user: User;
  allMembers: MemberProfile[];
  orders: OrderRecord[];
  commissions: CommissionRecord[];
  payouts: PayoutRequestRecord[];
  memberListings: MemberListingRecord[];
  auctions: AuctionRecord[];
  products: ProductItem[];
  securityLogs: SecurityLogRecord[];
  onRefreshCatalog: () => Promise<void>;
}

export function AdminView({
  lang,
  user,
  allMembers,
  orders,
  commissions,
  payouts,
  memberListings,
  auctions,
  products,
  securityLogs,
  onRefreshCatalog,
}: AdminViewProps) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [memberSearch, setMemberSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [revealedPii, setRevealedPii] = useState<Record<string, OrderShippingPii | null>>({});
  const [verifyResults, setVerifyResults] = useState<Record<string, { verified: boolean; mode: string }>>({});

  // CJ Dropshipping API 2.0 Credentials State (Admin-only)
  const [cjStatus, setCjStatus] = useState<CjStatusResponse | null>(null);
  const [cjEmail, setCjEmail] = useState('');
  const [cjApiKey, setCjApiKey] = useState('');
  const [connectingCj, setConnectingCj] = useState(false);
  const [cjConnectMsg, setCjConnectMsg] = useState('');

  // VelaPayment Gateway Auth Diagnostic State
  const [gatewayDiag, setGatewayDiag] = useState<{
    checked: boolean;
    authenticated: boolean;
    looksLikeStripeKey?: boolean;
    message: string;
  } | null>(null);
  const [testingGateway, setTestingGateway] = useState(false);

  const runGatewayTest = async () => {
    setTestingGateway(true);
    try {
      const res = await fetch('/api/payments/test-connection', { method: 'POST' });
      const data = await res.json();
      setGatewayDiag({
        checked: true,
        authenticated: Boolean(data.authenticated),
        looksLikeStripeKey: Boolean(data.looksLikeStripeKey),
        message: data.authenticated
          ? lang === 'th'
            ? `เชื่อมต่อ ${data.velapaymentHost || 'VelaPayment'} สำเร็จพร้อมรับชำระเงินจริง`
            : `Connected to ${data.velapaymentHost || 'VelaPayment'} and ready for live payments.`
          : data.error || 'Unauthorized',
      });
    } catch (err) {
      setGatewayDiag({
        checked: true,
        authenticated: false,
        message: err instanceof Error ? err.message : 'Unable to test gateway connection',
      });
    } finally {
      setTestingGateway(false);
    }
  };

  useEffect(() => {
    fetch('/api/cj/status')
      .then((r) => r.json())
      .then((data) => setCjStatus(data as CjStatusResponse))
      .catch(() => {});
  }, []);

  const formatThb = (val: number) =>
    new Intl.NumberFormat('th-TH', {
      style: 'currency',
      currency: 'THB',
      maximumFractionDigits: 0,
    }).format(val);

  const totalPlatformGmv = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalPlatformFee5Pct = orders.reduce((s, o) => s + (o.platformFeeAmount || 0), 0);
  const totalMlmPaid = commissions.reduce((s, c) => s + c.commissionAmount, 0);
  const pendingPayouts = payouts.filter((p) => p.status === 'pending');
  const pendingPayoutSum = pendingPayouts.reduce((s, p) => s + p.amount, 0);
  const activeListingsCount = memberListings.filter((l) => l.status === 'active').length;
  const liveAuctionsCount = auctions.filter((a) => a.status === 'live').length;

  const filteredMembers = allMembers.filter((m) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.referralCode.toLowerCase().includes(q) ||
      m.uid.toLowerCase().includes(q)
    );
  });

  const handlePayoutDecision = async (
    payout: PayoutRequestRecord,
    nextStatus: 'approved' | 'completed' | 'rejected'
  ) => {
    setBusyId(payout.id);
    setActionMsg('');
    try {
      await adminProcessPayoutRequest(user, payout, nextStatus);
      setActionMsg(
        lang === 'th'
          ? `อัปเดตรายการถอนเงิน ${payout.id} เป็น ${nextStatus} เรียบร้อยแล้ว`
          : `Payout ${payout.id} updated to ${nextStatus}.`
      );
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleMemberStatus = async (member: MemberProfile) => {
    const nextStatus = member.status === 'active' ? 'suspended' : 'active';
    setBusyId(member.uid);
    setActionMsg('');
    try {
      await adminUpdateMemberStatus(member.uid, nextStatus);
      setActionMsg(
        lang === 'th'
          ? `เปลี่ยนสถานะสมาชิก ${member.displayName} เป็น ${nextStatus} แล้ว`
          : `Member ${member.displayName} status changed to ${nextStatus}.`
      );
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Unable to update member');
    } finally {
      setBusyId(null);
    }
  };

  const handleArchiveListing = async (listingId: string) => {
    setBusyId(listingId);
    try {
      await archiveMemberListing(listingId);
    } finally {
      setBusyId(null);
    }
  };

  const handleCancelAuction = async (auctionId: string) => {
    setBusyId(auctionId);
    try {
      await adminCancelAuction(auctionId);
    } finally {
      setBusyId(null);
    }
  };

  const handleTogglePii = async (orderId: string) => {
    if (orderId in revealedPii) {
      setRevealedPii((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      return;
    }
    const pii = await fetchOrderShippingPii(orderId);
    setRevealedPii((prev) => ({ ...prev, [orderId]: pii }));
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

  const handleSyncCjOrder = async (order: OrderRecord) => {
    setBusyId(order.id);
    try {
      await syncOrderTrackingWithCj(order);
    } finally {
      setBusyId(null);
    }
  };

  const handleCjConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectingCj(true);
    setCjConnectMsg('');
    try {
      const res = await fetch('/api/cj/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cjEmail, apiKey: cjApiKey }),
      });
      const rawText = await res.text();
      let data: { error?: string } = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        throw new Error(`API HTTP ${res.status}: ${rawText.slice(0, 80)}`);
      }
      if (!res.ok) throw new Error(data.error || 'CJ connection failed');
      setCjApiKey('');
      setCjConnectMsg(
        lang === 'th' ? 'เชื่อมต่อ CJ Dropshipping API 2.0 สำเร็จ' : 'Connected to CJ Dropshipping API 2.0'
      );
      const statusRes = await fetch('/api/cj/status');
      setCjStatus((await statusRes.json()) as CjStatusResponse);
      await onRefreshCatalog();
    } catch (err) {
      setCjConnectMsg(err instanceof Error ? err.message : 'Unable to connect');
    } finally {
      setConnectingCj(false);
    }
  };

  const navItems: Array<{ id: AdminSection; labelTh: string; labelEn: string; icon: React.ReactNode; count?: number }> = [
    {
      id: 'overview',
      labelTh: 'ภาพรวมระบบ & รายได้ 5%',
      labelEn: 'System Overview',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'payouts',
      labelTh: 'อนุมัติถอนเงิน',
      labelEn: 'Payout Approvals',
      icon: <Wallet className="w-4 h-4" />,
      count: pendingPayouts.length,
    },
    {
      id: 'members',
      labelTh: 'จัดการสมาชิก',
      labelEn: 'Member Governance',
      icon: <Users className="w-4 h-4" />,
      count: allMembers.length,
    },
    {
      id: 'orders_market',
      labelTh: 'คำสั่งซื้อ · ตลาด & ประมูล',
      labelEn: 'Orders & Market Control',
      icon: <Store className="w-4 h-4" />,
      count: orders.length,
    },
    {
      id: 'system_cj',
      labelTh: 'CJ API 2.0 & Audit Logs',
      labelEn: 'CJ API & Security Logs',
      icon: <ShieldCheck className="w-4 h-4" />,
      count: securityLogs.length,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-emerald-700 block mb-1.5">
            {lang === 'th' ? 'ศูนย์ควบคุมผู้ดูแลระบบ · Admin System Control' : 'Admin System Control Console'}
          </span>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {lang === 'th' ? 'บริหารจัดการแพลตฟอร์ม Vela Commerce' : 'Vela Commerce Platform Operations'}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {lang === 'th'
              ? `เข้าสู่ระบบด้วยสิทธิ์ผู้ดูแลระบบ (${user.email}) · ตรวจสอบธุรกรรม อนุมัติถอนเงิน และควบคุมคลัง CJ`
              : `Signed in with verified Admin privilege (${user.email}) · Governance, payouts, moderation & CJ API`}
          </p>
        </div>

        <div className="text-xs font-mono text-slate-600 bg-white border border-slate-200 rounded-lg px-4 py-2.5 shrink-0">
          Fee Rate: <span className="font-semibold text-slate-900">5.0%</span> · MLM Pool:{' '}
          <span className="font-semibold text-slate-900">22.5%</span>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 flex items-center justify-between">
          <span>{actionMsg}</span>
          <button
            type="button"
            onClick={() => setActionMsg('')}
            className="text-slate-500 hover:text-slate-900 font-medium ml-4"
          >
            {lang === 'th' ? 'ปิด' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Enterprise SaaS Layout: Left Vertical Sidebar + Main Control Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-2 space-y-1">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors text-left ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  {item.icon}
                  <span>{lang === 'th' ? item.labelTh : item.labelEn}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      active ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <div className="lg:col-span-9 space-y-8">
          {/* SECTION 1: SYSTEM OVERVIEW */}
          {section === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'ยอดขายรวมทั้งแพลตฟอร์ม (GMV)' : 'Platform Gross Merchandise Value'}
                  </span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {formatThb(totalPlatformGmv)}
                  </span>
                  <span className="text-xs text-slate-500 block mt-1 tabular-nums">
                    {orders.length} {lang === 'th' ? 'คำสั่งซื้อทั้งหมด' : 'total orders'}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'รายได้ค่าธรรมเนียม 5% (ตลาด + ประมูล)' : '5% Platform Fees Collected'}
                  </span>
                  <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
                    {formatThb(totalPlatformFee5Pct)}
                  </span>
                  <span className="text-xs text-slate-500 block mt-1 tabular-nums">
                    {activeListingsCount} {lang === 'th' ? 'ลงขาย' : 'listings'} · {liveAuctionsCount}{' '}
                    {lang === 'th' ? 'ประมูลสด' : 'live auctions'}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'คำขอถอนเงินรออนุมัติ' : 'Pending Payout Approvals'}
                  </span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {formatThb(pendingPayoutSum)}
                  </span>
                  <span className="text-xs text-slate-500 block mt-1 tabular-nums">
                    {pendingPayouts.length} {lang === 'th' ? 'รายการรอตรวจสอบ' : 'pending requests'}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'คอมมิชชั่น MLM จ่ายออกรวม' : 'Total MLM Commissions Credited'}
                  </span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {formatThb(totalMlmPaid)}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'จำนวนสมาชิกทั้งหมด' : 'Registered Members'}
                  </span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {allMembers.length}
                  </span>
                  <span className="text-xs text-slate-500 block mt-1 tabular-nums">
                    {allMembers.filter((m) => m.status === 'suspended').length}{' '}
                    {lang === 'th' ? 'ถูกระงับสิทธิ์' : 'suspended'}
                  </span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-6">
                  <span className="text-xs font-medium text-slate-500 block mb-2">
                    {lang === 'th' ? 'สถานะ CJ Dropshipping API' : 'CJ Dropshipping API Mode'}
                  </span>
                  <span className="text-lg font-semibold font-mono text-emerald-700 block">
                    {cjStatus?.mode === 'live_api' ? 'LIVE API 2.0' : 'CATALOG SYNC'}
                  </span>
                  <span className="text-xs text-slate-500 block mt-1 truncate font-mono">
                    {cjStatus?.maskedEmail || 'sync@velacommerce.co'}
                  </span>
                </div>
              </div>

              {/* Quick Pending Payout Queue */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    {lang === 'th' ? 'คิวอนุมัติการถอนเงินล่าสุด' : 'Recent Payout Queue'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSection('payouts')}
                    className="text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4"
                  >
                    {lang === 'th' ? 'จัดการทั้งหมด' : 'Manage All'}
                  </button>
                </div>
                {pendingPayouts.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    {lang === 'th' ? 'ไม่มีคำขอถอนเงินที่ค้างรออนุมัติ' : 'No pending payout requests.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {pendingPayouts.slice(0, 5).map((p) => (
                      <div
                        key={p.id}
                        className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-0.5 text-xs">
                          <div className="font-mono font-semibold text-slate-900">
                            {p.memberUid} · {p.destinationMasked} ({p.method})
                          </div>
                          <div className="text-slate-500 font-mono">ID: {p.id}</div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                            {formatThb(p.amount)}
                          </span>
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => handlePayoutDecision(p, 'approved')}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                          >
                            {lang === 'th' ? 'อนุมัติ' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === p.id}
                            onClick={() => handlePayoutDecision(p, 'rejected')}
                            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                          >
                            {lang === 'th' ? 'ปฏิเสธ & คืนเงิน' : 'Reject & Refund'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* SECTION 2: PAYOUT APPROVALS */}
          {section === 'payouts' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  {lang === 'th' ? 'รายการขอถอนค่าคอมมิชชั่นและยอดขายสมาชิก' : 'Member Payout Requests Ledger'}
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">{payouts.length} requests</span>
              </div>

              {payouts.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  {lang === 'th' ? 'ยังไม่มีคำขอถอนเงินในระบบ' : 'No payout requests submitted yet.'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-5 font-medium">Member UID</th>
                        <th className="py-3 px-5 font-medium">Method / Dest</th>
                        <th className="py-3 px-5 font-medium text-right">Amount</th>
                        <th className="py-3 px-5 font-medium">Status</th>
                        <th className="py-3 px-5 font-medium text-right">Admin Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {payouts.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-3.5 px-5 font-mono text-slate-900">{p.memberUid.slice(0, 14)}…</td>
                          <td className="py-3.5 px-5 font-mono text-slate-700">
                            {p.method} · {p.destinationMasked}
                          </td>
                          <td className="py-3.5 px-5 font-mono font-semibold text-slate-900 text-right tabular-nums">
                            {formatThb(p.amount)}
                          </td>
                          <td className="py-3.5 px-5 font-medium text-slate-700">{p.status}</td>
                          <td className="py-3.5 px-5 text-right space-x-2 whitespace-nowrap">
                            {p.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyId === p.id}
                                  onClick={() => handlePayoutDecision(p, 'approved')}
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === p.id}
                                  onClick={() => handlePayoutDecision(p, 'rejected')}
                                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50"
                                >
                                  Reject & Refund
                                </button>
                              </>
                            )}
                            {p.status === 'approved' && (
                              <>
                                <button
                                  type="button"
                                  disabled={busyId === p.id}
                                  onClick={() => handlePayoutDecision(p, 'completed')}
                                  className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50"
                                >
                                  Mark Paid
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === p.id}
                                  onClick={() => handlePayoutDecision(p, 'rejected')}
                                  className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50"
                                >
                                  Reject & Refund
                                </button>
                              </>
                            )}
                            {(p.status === 'completed' || p.status === 'rejected') && (
                              <span className="text-slate-400 font-mono">Finalized</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: MEMBER GOVERNANCE */}
          {section === 'members' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  {lang === 'th' ? 'รายชื่อสมาชิกและการควบคุมสิทธิ์บัญชี' : 'Member Directory & Access Governance'}
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder={lang === 'th' ? 'ค้นหาชื่อ / รหัสแนะนำ...' : 'Search name / code...'}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-5 font-medium">Member</th>
                      <th className="py-3 px-5 font-medium">Code / Rank</th>
                      <th className="py-3 px-5 font-medium text-right">PV / TV</th>
                      <th className="py-3 px-5 font-medium text-right">Wallet</th>
                      <th className="py-3 px-5 font-medium">Status</th>
                      <th className="py-3 px-5 font-medium text-right">Control</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredMembers.map((m) => (
                      <tr key={m.uid} className="hover:bg-slate-50/70">
                        <td className="py-3.5 px-5">
                          <div className="font-medium text-slate-900">{m.displayName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{m.uid.slice(0, 14)}…</div>
                        </td>
                        <td className="py-3.5 px-5 font-mono text-slate-700">
                          {m.referralCode} · {m.rank}
                        </td>
                        <td className="py-3.5 px-5 font-mono text-right tabular-nums text-slate-700">
                          {formatThb(m.personalVolume)} / {formatThb(m.teamVolume)}
                        </td>
                        <td className="py-3.5 px-5 font-mono font-semibold text-right tabular-nums text-slate-900">
                          {formatThb(m.walletBalance)}
                        </td>
                        <td className="py-3.5 px-5">
                          <span
                            className={`font-medium ${
                              m.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {m.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          {m.uid !== user.uid && (
                            <button
                              type="button"
                              disabled={busyId === m.uid}
                              onClick={() => handleToggleMemberStatus(m)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 disabled:opacity-50"
                            >
                              <Ban className="w-3 h-3" />
                              <span>{m.status === 'active' ? 'Suspend' : 'Activate'}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 4: ORDERS & MARKETPLACE / AUCTION MODERATION */}
          {section === 'orders_market' && (
            <div className="space-y-8">
              {/* All Platform Orders */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    {lang === 'th' ? 'คำสั่งซื้อทั้งหมดในระบบ & ตรวจสอบข้อมูลจัดส่ง PII' : 'All Platform Orders & PII Inspection'}
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">{orders.length} orders</span>
                </div>

                {orders.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    {lang === 'th' ? 'ยังไม่มีคำสั่งซื้อในระบบ' : 'No platform orders found.'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {orders.map((ord) => {
                      const pii = revealedPii[ord.id];
                      const isRevealed = ord.id in revealedPii;
                      const v = verifyResults[ord.id];
                      return (
                        <div key={ord.id} className="p-5 space-y-3">
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono">
                                <span className="font-semibold text-slate-900">{ord.orderNumber}</span>
                                <span aria-hidden="true">·</span>
                                <span>{ord.orderSource || 'cj_dropship'}</span>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-700">{ord.paymentStatus}</span>
                                <span aria-hidden="true">·</span>
                                <span>{ord.fulfillmentStatus}</span>
                              </div>
                              <div className="text-sm font-medium text-slate-900">
                                {ord.itemTitle} × {ord.quantity}
                              </div>
                              <div className="text-xs font-mono text-slate-500">
                                Buyer: {ord.buyerUid.slice(0, 12)}… · Seller: {ord.sellerUid.slice(0, 12)}…
                                {typeof ord.platformFeeAmount === 'number' &&
                                  ` · Fee 5%: ${formatThb(ord.platformFeeAmount)}`}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold font-mono text-slate-900 tabular-nums mr-2">
                                {formatThb(ord.totalAmount)}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleTogglePii(ord.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
                              >
                                {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                <span>{isRevealed ? 'Hide PII' : 'Inspect PII'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleVerifySignature(ord)}
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
                              >
                                Verify Gateway
                              </button>
                              {ord.cjOrderId && ord.fulfillmentStatus !== 'delivered' && (
                                <button
                                  type="button"
                                  disabled={busyId === ord.id}
                                  onClick={() => handleSyncCjOrder(ord)}
                                  className="px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                                >
                                  Sync CJ
                                </button>
                              )}
                            </div>
                          </div>

                          {v && (
                            <div className="text-xs font-medium text-emerald-700 inline-flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {v.verified ? `Verified (${v.mode})` : 'Signature mismatch'}
                              </span>
                            </div>
                          )}

                          {isRevealed && (
                            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 space-y-1">
                              {pii ? (
                                <>
                                  <div>
                                    Recipient: <span className="font-semibold text-slate-900">{pii.recipientName}</span> ·{' '}
                                    <span className="font-mono">{pii.phone}</span>
                                  </div>
                                  <div>
                                    Address: {pii.addressLine}, {ord.shippingCity} {pii.postalCode} ({pii.countryCode})
                                  </div>
                                </>
                              ) : (
                                <span className="text-slate-500">No shipping PII document found.</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Member Marketplace & Auction Moderation */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PackageCheck className="w-4 h-4 text-slate-700" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {lang === 'th' ? 'สินค้าสมาชิก (ค่าธรรมเนียม 5%)' : 'Member Listings Moderation'}
                      </h3>
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums">{memberListings.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {memberListings.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">No member listings.</div>
                    ) : (
                      memberListings.map((l) => (
                        <div key={l.id} className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">{l.title}</div>
                            <div className="font-mono text-slate-500">
                              {l.sellerName} · {formatThb(l.price)} · {l.status}
                            </div>
                          </div>
                          {l.status === 'active' && (
                            <button
                              type="button"
                              disabled={busyId === l.id}
                              onClick={() => handleArchiveListing(l.id)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 shrink-0"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Gavel className="w-4 h-4 text-slate-700" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {lang === 'th' ? 'ควบคุมรอบประมูล (ค่าธรรมเนียม 5%)' : 'Live Auctions Control'}
                      </h3>
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums">{auctions.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {auctions.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500">No auctions.</div>
                    ) : (
                      auctions.map((a) => (
                        <div key={a.id} className="px-5 py-3.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">{a.title}</div>
                            <div className="font-mono text-slate-500">
                              {formatThb(a.currentBid)} ({a.bidCount} bids) · {a.status}
                            </div>
                          </div>
                          {a.status === 'live' && (
                            <button
                              type="button"
                              disabled={busyId === a.id}
                              onClick={() => handleCancelAuction(a.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 shrink-0"
                            >
                              <XCircle className="w-3 h-3" />
                              <span>Cancel</span>
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 5: CJ DROPSHIPPING API 2.0 & IMMUTABLE SECURITY AUDIT LOGS */}
          {section === 'system_cj' && (
            <div className="space-y-8">
              {/* VelaPayment Gateway Auth Diagnostic */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-700" />
                    <h2 className="text-base font-semibold text-slate-900">
                      {lang === 'th'
                        ? 'ตรวจสอบการเชื่อมต่อ VelaPayment Gateway (https://velapayment.vercel.app)'
                        : 'VelaPayment Gateway Connection Check'}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600">
                    {gatewayDiag
                      ? gatewayDiag.message
                      : lang === 'th'
                      ? 'กดทดสอบเพื่อตรวจสอบว่าตัวแปร PAYMENT_GATEWAY_SECRET ถูกต้องและพร้อมรับชำระเงินจริง'
                      : 'Verify that PAYMENT_GATEWAY_SECRET authenticates with VelaPayment Merchant API.'}
                  </p>
                  {gatewayDiag && !gatewayDiag.authenticated && (
                    <p className="text-xs text-rose-700 font-medium">
                      {gatewayDiag.looksLikeStripeKey
                        ? lang === 'th'
                          ? 'ตรวจพบว่า Key ที่ใส่อยู่เป็น Stripe Secret Key (sk_...) กรุณาใช้ Merchant Secret Key จากแดชบอร์ด velapayment.vercel.app แทน'
                          : 'Detected Stripe key (sk_...). Replace PAYMENT_GATEWAY_SECRET with your VelaPayment Merchant Secret Key.'
                        : lang === 'th'
                        ? 'กรุณาตั้งค่า Secret ชื่อ PAYMENT_GATEWAY_SECRET ใน Settings → Secrets ของ AI Studio (หรือ Environment Variables บน Vercel) ด้วย Merchant Secret Key จาก velapayment.vercel.app'
                        : 'Update PAYMENT_GATEWAY_SECRET in AI Studio Secrets with your Merchant Secret Key from velapayment.vercel.app.'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={testingGateway}
                  onClick={runGatewayTest}
                  className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 shrink-0 whitespace-nowrap"
                >
                  {testingGateway
                    ? lang === 'th'
                      ? 'กำลังทดสอบ...'
                      : 'Testing...'
                    : lang === 'th'
                    ? 'ทดสอบ Secret Key'
                    : 'Test Gateway Auth'}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-slate-700" />
                      <h2 className="text-base font-semibold text-slate-900">
                        {lang === 'th' ? 'ตั้งค่า CJ API 2.0 (เฉพาะ Admin)' : 'CJ Open API 2.0 Credentials'}
                      </h2>
                    </div>
                    <span className="text-xs font-mono text-emerald-700">
                      {cjStatus?.mode === 'live_api' ? 'Live API' : 'Catalog Sync'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div>
                      Account: <span className="font-mono text-slate-900">{cjStatus?.maskedEmail || 'sync@velacommerce.co'}</span>
                    </div>
                    <div>
                      Warehouses:{' '}
                      <span className="font-mono text-slate-900">
                        {cjStatus?.warehouses?.join(' · ') || 'BKK-LOCAL-01 · CN-SZ-02'}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleCjConnect} className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">
                        {lang === 'th' ? 'อีเมลบัญชี CJ Dropshipping (ไม่บังคับ)' : 'CJ Account Email (Optional)'}
                      </label>
                      <input
                        type="email"
                        value={cjEmail}
                        onChange={(e) => setCjEmail(e.target.value)}
                        placeholder="merchant@domain.com"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">
                        {lang === 'th' ? 'CJ API Key (เก็บฝั่งเซิร์ฟเวอร์)' : 'CJ API Key (Server-Side Only)'}
                      </label>
                      <input
                        type="password"
                        required
                        value={cjApiKey}
                        onChange={(e) => setCjApiKey(e.target.value)}
                        placeholder="CJUserNum@api@xxxxxxxxxxxxxxxx"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>

                    {cjConnectMsg && <p className="text-xs text-slate-700">{cjConnectMsg}</p>}

                    <button
                      type="submit"
                      disabled={connectingCj}
                      className="w-full py-2.5 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                    >
                      {connectingCj
                        ? lang === 'th'
                          ? 'กำลังเชื่อมต่อ...'
                          : 'Connecting...'
                        : lang === 'th'
                        ? 'บันทึกและเชื่อมต่อ CJ API'
                        : 'Save & Connect CJ API'}
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">CJ Wholesale Margin Matrix</h3>
                    <button
                      type="button"
                      onClick={onRefreshCatalog}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Sync SKUs</span>
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">SKU</th>
                          <th className="py-2.5 px-4 font-medium">Title</th>
                          <th className="py-2.5 px-4 font-medium text-right">Cost</th>
                          <th className="py-2.5 px-4 font-medium text-right">Retail</th>
                          <th className="py-2.5 px-4 font-medium text-right">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {products.map((p) => (
                          <tr key={p.sku}>
                            <td className="py-2.5 px-4 font-mono text-slate-900">{p.sku}</td>
                            <td className="py-2.5 px-4 text-slate-700 max-w-[180px] truncate">
                              {lang === 'th' ? p.titleTh : p.title}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-right tabular-nums text-slate-600">
                              {formatThb(p.wholesaleCost)}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-right tabular-nums font-semibold text-slate-900">
                              {formatThb(p.retailPrice)}
                            </td>
                            <td className="py-2.5 px-4 font-mono text-right tabular-nums text-emerald-700">
                              {p.stock}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Immutable Platform Security Logs */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-slate-700" />
                    <h2 className="text-base font-semibold text-slate-900">
                      {lang === 'th' ? 'บันทึกความปลอดภัยทั้งระบบ (Immutable Audit Logs)' : 'Platform Security Audit Logs'}
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500 tabular-nums">{securityLogs.length} events</span>
                </div>
                {securityLogs.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-500">No security audit logs recorded yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-5 font-medium">Action</th>
                          <th className="py-3 px-5 font-medium">Actor UID</th>
                          <th className="py-3 px-5 font-medium">Resource</th>
                          <th className="py-3 px-5 font-medium">Integrity Hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {securityLogs.slice(0, 30).map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-5 font-semibold text-slate-900">{log.action}</td>
                            <td className="py-3 px-5 text-slate-600">{log.actorUid.slice(0, 14)}…</td>
                            <td className="py-3 px-5 text-slate-600">
                              {log.resourceType}:{log.resourceId.slice(0, 14)}
                            </td>
                            <td className="py-3 px-5 text-slate-500 truncate max-w-[180px]">{log.integrityHash}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
