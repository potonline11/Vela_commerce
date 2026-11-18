import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import type {
  CartItem,
  CommissionRecord,
  MemberPrivateInfo,
  MemberProfile,
  MemberRank,
  OrderRecord,
  OrderShippingPii,
  PaymentIntentRecord,
  PaymentMethod,
  PayoutRequestRecord,
  SecurityLogRecord,
} from '../types';

export const MLM_TIERS = [
  { tier: 1, ratePercent: 12.0, label: 'Tier 1 · Direct Sponsor' },
  { tier: 2, ratePercent: 6.0, label: 'Tier 2 · Second Level' },
  { tier: 3, ratePercent: 3.0, label: 'Tier 3 · Third Level' },
  { tier: 4, ratePercent: 1.5, label: 'Tier 4 · Fourth Level' },
] as const;

export function calculateRank(personalVolume: number, teamVolume: number): MemberRank {
  const combined = personalVolume + teamVolume;
  if (combined >= 150_000) return 'Diamond';
  if (combined >= 60_000) return 'Platinum';
  if (combined >= 20_000) return 'Gold';
  if (combined >= 5_000) return 'Silver';
  return 'Bronze';
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function ensureMemberProfile(user: User, sponsorReferralCode?: string): Promise<void> {
  const memberRef = doc(db, 'members', user.uid);
  let snap;
  try {
    snap = await getDoc(memberRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `members/${user.uid}`);
  }

  let resolvedSponsorUid = '';
  if (sponsorReferralCode && sponsorReferralCode.trim().length >= 4) {
    try {
      const q = query(
        collection(db, 'members'),
        where('referralCode', '==', sponsorReferralCode.trim().toUpperCase()),
        where('status', '==', 'active')
      );
      const sponsorMatches = await getDocs(q);
      if (!sponsorMatches.empty) {
        const candidate = sponsorMatches.docs[0].id;
        if (candidate !== user.uid) {
          resolvedSponsorUid = candidate;
        }
      }
    } catch {
      // Optional sponsor lookup
    }
  }

  if (!snap.exists()) {
    const cleanCode = `VELA-${user.uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}`;
    const displayName = (user.displayName || user.email?.split('@')[0] || 'Member').slice(0, 80);
    const batch = writeBatch(db);

    batch.set(memberRef, {
      uid: user.uid,
      displayName,
      referralCode: cleanCode,
      ...(resolvedSponsorUid ? { sponsorUid: resolvedSponsorUid } : {}),
      rank: 'Bronze',
      personalVolume: 0,
      teamVolume: 0,
      directCount: 0,
      totalCommissionEarned: 0,
      walletBalance: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const privateRef = doc(db, 'members', user.uid, 'private', 'contact');
    batch.set(privateRef, {
      uid: user.uid,
      email: user.email || 'verified@velacommerce.co',
      phone: '',
      shippingAddress: '',
      promptPayMasked: '',
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `members/${user.uid}`);
    }
  }
}

export async function updateMemberPrivateContact(
  uid: string,
  data: { email: string; phone: string; shippingAddress: string; promptPayMasked: string }
): Promise<void> {
  const ref = doc(db, 'members', uid, 'private', 'contact');
  try {
    await setDoc(
      ref,
      {
        uid,
        email: data.email.slice(0, 160),
        phone: data.phone.slice(0, 32),
        shippingAddress: data.shippingAddress.slice(0, 300),
        promptPayMasked: data.promptPayMasked.slice(0, 32),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `members/${uid}/private/contact`);
  }
}

export function subscribeMyProfile(
  uid: string,
  onData: (profile: MemberProfile | null) => void
): Unsubscribe {
  const ref = doc(db, 'members', uid);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as MemberProfile) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `members/${uid}`)
  );
}

export function subscribeMyPrivateInfo(
  uid: string,
  onData: (info: MemberPrivateInfo | null) => void
): Unsubscribe {
  const ref = doc(db, 'members', uid, 'private', 'contact');
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as MemberPrivateInfo) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `members/${uid}/private/contact`)
  );
}

export function subscribeNetworkMembers(
  onData: (members: MemberProfile[]) => void
): Unsubscribe {
  const q = query(collection(db, 'members'), where('status', '==', 'active'));
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as MemberProfile));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'members')
  );
}

export function subscribeMyOrders(
  uid: string,
  isAdminUser: boolean,
  onData: (orders: OrderRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'orders'), where('buyerUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderRecord, 'id'>) }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
  );
}

export function subscribeMyCommissions(
  uid: string,
  isAdminUser: boolean,
  onData: (commissions: CommissionRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'commissions'), orderBy('createdAt', 'desc'))
    : query(collection(db, 'commissions'), where('beneficiaryUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<CommissionRecord, 'id'>),
      }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'commissions')
  );
}

export function subscribeMyPaymentIntents(
  uid: string,
  onData: (intents: PaymentIntentRecord[]) => void
): Unsubscribe {
  const q = query(collection(db, 'paymentIntents'), where('ownerUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PaymentIntentRecord, 'id'>),
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'paymentIntents')
  );
}

export function subscribeMyPayoutRequests(
  uid: string,
  isAdminUser: boolean,
  onData: (payouts: PayoutRequestRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'payoutRequests'))
    : query(collection(db, 'payoutRequests'), where('memberUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<PayoutRequestRecord, 'id'>),
      }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'payoutRequests')
  );
}

export function subscribeSecurityLogs(
  uid: string,
  isAdminUser: boolean,
  onData: (logs: SecurityLogRecord[]) => void
): Unsubscribe {
  const q = isAdminUser
    ? query(collection(db, 'securityLogs'))
    : query(collection(db, 'securityLogs'), where('actorUid', '==', uid));

  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityLogRecord, 'id'>),
      }));
      list.sort((a, b) => {
        const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
        const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
        return tb - ta;
      });
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'securityLogs')
  );
}

export async function fetchOrderShippingPii(orderId: string): Promise<OrderShippingPii | null> {
  const ref = doc(db, 'orders', orderId, 'shipping', 'details');
  try {
    const snap = await getDoc(ref);
    return snap.exists() ? (snap.data() as OrderShippingPii) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `orders/${orderId}/shipping/details`);
  }
}

export interface CheckoutInput {
  user: User;
  buyerProfile: MemberProfile;
  allMembers: MemberProfile[];
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  intentCode: string;
  hmacSignature: string;
  receiptHash: string;
  maskedSource: string;
  idempotencyKey: string;
  orderId?: string;
  orderNumber?: string;
  sponsorReferralCode?: string;
  shipping: {
    recipientName: string;
    phone: string;
    addressLine: string;
    city: string;
    postalCode: string;
  };
}

export async function commitAtomicCheckout(input: CheckoutInput): Promise<{
  orderNumber: string;
  cjOrderId: string;
  trackingNumber: string;
  commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }>;
}> {
  const totalAmount = input.cart.reduce(
    (sum, item) => sum + item.product.retailPrice * item.quantity,
    0
  );
  const totalWholesale = input.cart.reduce(
    (sum, item) => sum + item.product.wholesaleCost * item.quantity,
    0
  );
  const primaryItem = input.cart[0];
  const totalQty = input.cart.reduce((sum, item) => sum + item.quantity, 0);
  const orderNumber =
    input.orderNumber ||
    `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 899)}`;

  // 1. Push order automatically to CJ Dropshipping backend proxy
  const cjRes = await fetch('/api/cj/orders/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderNumber,
      sku: primaryItem.product.sku,
      quantity: totalQty,
      shippingCity: input.shipping.city,
    }),
  });
  if (!cjRes.ok) {
    throw new Error('CJ Dropshipping fulfillment push failed');
  }
  const cjData = (await cjRes.json()) as {
    cjOrderId: string;
    trackingNumber: string;
    carrierName: string;
    fulfillmentStatus: 'processing';
  };

  // 2. Resolve 4-tier upline chain safely
  const memberByUid = new Map<string, MemberProfile>();
  const memberByCode = new Map<string, MemberProfile>();
  for (const m of input.allMembers) {
    memberByUid.set(m.uid, m);
    memberByCode.set(m.referralCode.toUpperCase(), m);
  }

  let firstSponsorUid = input.buyerProfile.sponsorUid || '';
  if (!firstSponsorUid && input.sponsorReferralCode) {
    const matched = memberByCode.get(input.sponsorReferralCode.trim().toUpperCase());
    if (matched && matched.uid !== input.user.uid) {
      firstSponsorUid = matched.uid;
    }
  }

  const orderId =
    input.orderId && /^[a-zA-Z0-9_\-]+$/.test(input.orderId)
      ? input.orderId
      : `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const intentDocId = `pi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeIntentCode = input.intentCode.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);

  const batch = writeBatch(db);

  // PaymentIntent doc
  batch.set(doc(db, 'paymentIntents', intentDocId), {
    intentCode: safeIntentCode.length >= 6 ? safeIntentCode : `VP_${safeIntentCode}`,
    ownerUid: input.user.uid,
    orderId,
    amount: totalAmount,
    currency: 'THB',
    method: input.paymentMethod,
    maskedSource: input.maskedSource,
    hmacSignature: input.hmacSignature,
    idempotencyKey: input.idempotencyKey,
    status: 'settled',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Order doc (zero street-level PII)
  batch.set(doc(db, 'orders', orderId), {
    orderNumber,
    buyerUid: input.user.uid,
    sellerUid: firstSponsorUid || input.user.uid,
    itemSku: primaryItem.product.sku,
    itemTitle:
      input.cart.length > 1
        ? `${primaryItem.product.title} (+${input.cart.length - 1})`
        : primaryItem.product.title,
    quantity: totalQty,
    unitPrice: primaryItem.product.retailPrice,
    totalAmount,
    wholesaleCost: totalWholesale,
    paymentIntentId: input.intentCode,
    paymentMethod: input.paymentMethod,
    paymentSignature: input.receiptHash,
    paymentStatus: 'paid',
    cjOrderId: cjData.cjOrderId,
    fulfillmentStatus: cjData.fulfillmentStatus,
    trackingNumber: cjData.trackingNumber,
    carrierName: cjData.carrierName,
    shippingCity: input.shipping.city.slice(0, 80),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Isolated Order Shipping PII subcollection
  batch.set(doc(db, 'orders', orderId, 'shipping', 'details'), {
    orderId,
    buyerUid: input.user.uid,
    recipientName: input.shipping.recipientName.slice(0, 100),
    phone: input.shipping.phone.slice(0, 32),
    addressLine: input.shipping.addressLine.slice(0, 240),
    postalCode: input.shipping.postalCode.slice(0, 16),
    countryCode: 'TH',
    createdAt: serverTimestamp(),
  });

  // Buyer personal volume + wallet debit if paid via wallet
  const nextPv = Number((input.buyerProfile.personalVolume + totalAmount).toFixed(2));
  const nextBuyerWallet =
    input.paymentMethod === 'wallet'
      ? Math.max(0, Number((input.buyerProfile.walletBalance - totalAmount).toFixed(2)))
      : input.buyerProfile.walletBalance;

  batch.update(doc(db, 'members', input.user.uid), {
    personalVolume: nextPv,
    walletBalance: nextBuyerWallet,
    rank: calculateRank(nextPv, input.buyerProfile.teamVolume),
    updatedAt: serverTimestamp(),
  });

  // Multi-tier MLM Commission distribution (Tier 1 -> Tier 4)
  const commissionsDistributed: Array<{ tier: number; beneficiaryName: string; amount: number }> = [];
  const visited = new Set<string>([input.user.uid]);
  let cursorUid = firstSponsorUid;

  for (const tierSpec of MLM_TIERS) {
    if (!cursorUid || visited.has(cursorUid)) break;
    const upline = memberByUid.get(cursorUid);
    if (!upline) break;
    visited.add(cursorUid);

    const commissionAmount = Number(((totalAmount * tierSpec.ratePercent) / 100).toFixed(2));
    if (commissionAmount > 0) {
      const commId = `com_${Date.now()}_t${tierSpec.tier}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(doc(db, 'commissions', commId), {
        orderId,
        orderNumber,
        beneficiaryUid: upline.uid,
        sourceBuyerUid: input.user.uid,
        tier: tierSpec.tier,
        ratePercent: tierSpec.ratePercent,
        commissionAmount,
        status: 'credited',
        createdAt: serverTimestamp(),
      });

      const nextTeamVolume = Number((upline.teamVolume + totalAmount).toFixed(2));
      const nextWallet = Number((upline.walletBalance + commissionAmount).toFixed(2));
      const nextEarned = Number((upline.totalCommissionEarned + commissionAmount).toFixed(2));

      batch.update(doc(db, 'members', upline.uid), {
        teamVolume: nextTeamVolume,
        totalCommissionEarned: nextEarned,
        walletBalance: nextWallet,
        lastCommissionId: commId,
        rank: calculateRank(upline.personalVolume, nextTeamVolume),
        updatedAt: serverTimestamp(),
      });

      commissionsDistributed.push({
        tier: tierSpec.tier,
        beneficiaryName: upline.displayName,
        amount: commissionAmount,
      });
    }

    cursorUid = upline.sponsorUid || '';
  }

  // Immutable Security Audit Log
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: input.user.uid,
    action: 'PAYMENT_SETTLED_CJ_DISPATCHED',
    resourceType: 'order',
    resourceId: orderId,
    integrityHash: input.receiptHash,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `orders/${orderId}`);
  }

  return {
    orderNumber,
    cjOrderId: cjData.cjOrderId,
    trackingNumber: cjData.trackingNumber,
    commissionsDistributed,
  };
}

export async function syncOrderTrackingWithCj(order: OrderRecord): Promise<void> {
  if (!order.cjOrderId) return;
  const res = await fetch(`/api/cj/orders/${encodeURIComponent(order.cjOrderId)}/tracking`);
  if (!res.ok) {
    throw new Error('Failed to sync tracking from CJ Dropshipping');
  }
  const data = (await res.json()) as {
    fulfillmentStatus: 'synced_cj' | 'processing' | 'in_transit' | 'delivered';
    trackingNumber: string;
    carrierName: string;
  };

  try {
    await updateDoc(doc(db, 'orders', order.id), {
      fulfillmentStatus: data.fulfillmentStatus,
      trackingNumber: data.trackingNumber,
      carrierName: data.carrierName,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function submitPayoutWithdrawal(
  profile: MemberProfile,
  amount: number,
  destination: string,
  method: 'promptpay' | 'bank_transfer'
): Promise<void> {
  if (amount < 100 || amount > profile.walletBalance) {
    throw new Error('Invalid withdrawal amount');
  }

  const cleanDest = destination.trim();
  const masked =
    cleanDest.length > 4
      ? `${'*'.repeat(Math.max(4, cleanDest.length - 4))}${cleanDest.slice(-4)}`
      : cleanDest;

  const payoutId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const batch = writeBatch(db);
  batch.set(doc(db, 'payoutRequests', payoutId), {
    memberUid: profile.uid,
    amount: Number(amount.toFixed(2)),
    destinationMasked: masked.slice(0, 48),
    method,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'members', profile.uid), {
    walletBalance: Number((profile.walletBalance - amount).toFixed(2)),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'securityLogs', logId), {
    actorUid: profile.uid,
    action: 'PAYOUT_REQUEST_SUBMITTED',
    resourceType: 'payoutRequest',
    resourceId: payoutId,
    integrityHash: `${profile.uid.slice(0, 12)}_${Date.now()}`,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payoutRequests/${payoutId}`);
  }
}
