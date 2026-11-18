import React, { useState } from 'react';
import { Check, Copy, GitBranch, Users } from 'lucide-react';
import type { User } from 'firebase/auth';
import type { Lang } from '../i18n';
import { COPY } from '../i18n';
import { MLM_TIERS } from '../services/commerceService';
import type { MemberProfile } from '../types';

interface NetworkViewProps {
  lang: Lang;
  user: User | null;
  profile: MemberProfile | null;
  allMembers: MemberProfile[];
  onSignIn: () => Promise<void>;
}

const RANK_THRESHOLDS = [
  { rank: 'Bronze', volume: 0 },
  { rank: 'Silver', volume: 5_000 },
  { rank: 'Gold', volume: 20_000 },
  { rank: 'Platinum', volume: 60_000 },
  { rank: 'Diamond', volume: 150_000 },
] as const;

export function NetworkView({
  lang,
  user,
  profile,
  allMembers,
  onSignIn,
}: NetworkViewProps) {
  const t = COPY[lang];
  const [copied, setCopied] = useState(false);
  const [simSaleAmount, setSimSaleAmount] = useState(4490);

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

  // Build 4-tier downline tree rooted at current member
  const tier1 = allMembers.filter((m) => m.sponsorUid === user.uid);
  const tier1Ids = new Set(tier1.map((m) => m.uid));
  const tier2 = allMembers.filter((m) => m.sponsorUid && tier1Ids.has(m.sponsorUid));
  const tier2Ids = new Set(tier2.map((m) => m.uid));
  const tier3 = allMembers.filter((m) => m.sponsorUid && tier2Ids.has(m.sponsorUid));
  const tier3Ids = new Set(tier3.map((m) => m.uid));
  const tier4 = allMembers.filter((m) => m.sponsorUid && tier3Ids.has(m.sponsorUid));

  const tierGroups = [
    { tier: 1, rate: '12.0%', members: tier1 },
    { tier: 2, rate: '6.0%', members: tier2 },
    { tier: 3, rate: '3.0%', members: tier3 },
    { tier: 4, rate: '1.5%', members: tier4 },
  ];

  const combinedVolume = (profile?.personalVolume || 0) + (profile?.teamVolume || 0);
  const nextRank =
    RANK_THRESHOLDS.find((r) => r.volume > combinedVolume) || RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
  const progressPct = Math.min(100, Math.round((combinedVolume / Math.max(1, nextRank.volume)) * 100));

  const handleCopyCode = async () => {
    if (!profile?.referralCode) return;
    await navigator.clipboard.writeText(profile.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{t.networkTitle}</h1>
          <p className="text-sm text-slate-600 mt-1.5 max-w-2xl">{t.networkSubtitle}</p>
        </div>

        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shrink-0">
          <div>
            <span className="text-xs text-slate-500 block">{t.yourReferralCode}</span>
            <span className="text-sm font-mono font-semibold text-slate-900">
              {profile?.referralCode || '—'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? t.copied : t.copyCode}</span>
          </button>
        </div>
      </div>

      {/* Member Status & Volume Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.currentRank}</span>
          <span className="text-2xl font-semibold text-slate-900">{profile?.rank || 'Bronze'}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.personalVolume}</span>
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">
            {formatThb(profile?.personalVolume || 0)}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.teamVolume}</span>
          <span className="text-2xl font-semibold text-emerald-700 tabular-nums">
            {formatThb(profile?.teamVolume || 0)}
          </span>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <span className="text-xs font-medium text-slate-500 block mb-2">{t.directRecruits}</span>
          <span className="text-2xl font-semibold text-slate-900 tabular-nums">{tier1.length}</span>
        </div>
      </div>

      {/* Rank Progress & Interactive Commission Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-slate-900">Rank Progression</h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600 tabular-nums">
              <span>Combined PV + TV: {formatThb(combinedVolume)}</span>
              <span>Target ({nextRank.rank}): {formatThb(nextRank.volume)}</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-700 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-5 gap-2 pt-3 border-t border-slate-100 text-xs">
            {RANK_THRESHOLDS.map((item) => (
              <div key={item.rank} className="text-center">
                <span
                  className={`block font-medium ${
                    profile?.rank === item.rank ? 'text-emerald-700' : 'text-slate-700'
                  }`}
                >
                  {item.rank}
                </span>
                <span className="text-slate-500 font-mono tabular-nums text-[11px]">
                  {item.volume >= 1000 ? `${item.volume / 1000}k` : '0'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900">{t.tierRatesTitle}</h2>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Order Sim:</span>
              <input
                type="number"
                min={100}
                step={100}
                value={simSaleAmount}
                onChange={(e) => setSimSaleAmount(Math.max(0, Number(e.target.value)))}
                className="w-24 px-2 py-1 border border-slate-200 rounded-md font-mono tabular-nums text-right"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {MLM_TIERS.map((tier) => (
              <div key={tier.tier} className="py-2.5 flex items-center justify-between text-xs">
                <span className="text-slate-700">{tier.label}</span>
                <div className="flex items-center gap-6 tabular-nums font-mono">
                  <span className="text-slate-500">{tier.ratePercent.toFixed(1)}%</span>
                  <span className="font-semibold text-emerald-700 w-20 text-right">
                    +{formatThb((simSaleAmount * tier.ratePercent) / 100)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Tier Genealogy Tree */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">{t.genealogyTitle}</h2>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">
            {allMembers.length} active network members
          </span>
        </div>

        <div className="divide-y divide-slate-200">
          {tierGroups.map((group) => (
            <div key={group.tier} className="p-6 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-900">
                  Tier {group.tier} · Commission {group.rate}
                </span>
                <span className="text-slate-500 tabular-nums">{group.members.length} members</span>
              </div>

              {group.members.length === 0 ? (
                <p className="text-xs text-slate-500">
                  ยังไม่มีสมาชิกในชั้นที่ {group.tier} — แชร์รหัสแนะนำ{' '}
                  <span className="font-mono text-slate-800">{profile?.referralCode}</span> เพื่อสร้างสายงาน
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.members.map((m) => (
                    <div
                      key={m.uid}
                      className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-900 flex items-center gap-1.5 truncate">
                          <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          {m.displayName}
                        </span>
                        <span className="text-xs font-medium text-emerald-700 shrink-0">{m.rank}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                        <span>{m.referralCode}</span>
                        <span>PV {formatThb(m.personalVolume)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
