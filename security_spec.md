# Security Specification & Payload-First TDD

## 1. Data Invariants

1. **Zero-Trust Identity & Verified Auth**: All writes require `request.auth != null && request.auth.token.email_verified == true`. No guest or unverified email can mutate state.
2. **PII Split-Collection Isolation**: `/members/{memberId}` never stores `email`, `phone`, or `shippingAddress`. PII resides strictly in `/members/{memberId}/private/{docId}` and `/orders/{orderId}/shipping/{docId}`, readable only by the owning UID or verified Admin.
3. **Anti-Self-Promotion & Balance Integrity**: A newly created `/members/{memberId}` must initialize with `rank == 'Bronze'`, `walletBalance == 0`, `totalCommissionEarned == 0`, `personalVolume == 0`, and `teamVolume == 0`.
4. **Atomic Commission Credit**: Crediting a member's `walletBalance` during checkout requires an atomic batch referencing a newly created `/commissions/{commissionId}` (`getAfter` verification) where `sourceBuyerUid == request.auth.uid` and `beneficiaryUid == memberId`, plus an existing or co-created `/orders/{orderId}` (`existsAfter`).
5. **Terminal State Locking**: Once an order reaches `delivered` or `cancelled`, a payment intent reaches `settled`, or a payout request reaches `completed`, non-admin updates are permanently rejected.
6. **Immutable Security Audit Trail**: `/securityLogs/{logId}` denies all `update` and `delete` operations.
7. **Server-Side Secret Containment**: Payment Gateway HMAC secret keys and CJ Dropshipping API Access Tokens remain strictly on the Express backend (`/api/*`) and are never stored in Firestore or exposed to the client.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Shadow Field Injection on Member Creation**: Sending `{ uid, displayName, ..., isAdmin: true }` to `/members/{uid}`. Expected: `PERMISSION_DENIED` (`hasOnly` rejection).
2. **Self-Assigned Diamond Rank**: Creating `/members/{uid}` with `rank: "Diamond"` or `walletBalance: 50000`. Expected: `PERMISSION_DENIED`.
3. **Unverified Email Spoofing**: Admin email claim with `email_verified: false`. Expected: `PERMISSION_DENIED`.
4. **Cross-User PII Read**: Authenticated User B reading `/members/{userA}/private/contact`. Expected: `PERMISSION_DENIED`.
5. **Order Shipping PII Scrape**: Authenticated User B listing `/orders/{orderA}/shipping/details`. Expected: `PERMISSION_DENIED`.
6. **Blanket List Query Bypass**: Listing `/commissions` without `where('beneficiaryUid', '==', auth.uid)`. Expected: `PERMISSION_DENIED`.
7. **Orphan Commission Fraud**: Creating `/commissions/{id}` pointing to a non-existent `orderId`. Expected: `PERMISSION_DENIED` (`existsAfter` fails).
8. **Direct Balance Inflation**: Updating `/members/{uplineUid}` `walletBalance` by `+10000` without an atomic commission doc. Expected: `PERMISSION_DENIED`.
9. **ID Poisoning Attack**: Writing `/orders/{1500_char_junk_id}` or path traversal characters. Expected: `PERMISSION_DENIED` (`isValidId` fails).
10. **Client Timestamp Forgery**: Creating `/orders/{id}` with backdated `createdAt` not equal to `request.time`. Expected: `PERMISSION_DENIED`.
11. **Terminal State Reversal**: User updating a `settled` `/paymentIntents/{id}` back to `requires_confirmation`. Expected: `PERMISSION_DENIED`.
12. **Audit Log Tampering**: Updating or deleting an entry in `/securityLogs/{logId}`. Expected: `PERMISSION_DENIED`.
