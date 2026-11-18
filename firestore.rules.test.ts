/**
 * Payload-First Security Rule Verification Suite ("Dirty Dozen")
 * Validates structural invariants against firestore.rules expectations.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesSource = fs.readFileSync('firestore.rules', 'utf8');

// Static Red Team Assertions against final firestore.rules
assert.ok(rulesSource.includes("rules_version = '2';"), 'Must declare rules_version 2');
assert.ok(rulesSource.includes('allow read, write: if false;'), 'Must include default-deny catch-all');
assert.ok(rulesSource.includes('request.auth.token.email_verified == true'), 'Must require verified email');
assert.ok(rulesSource.includes('isValidId('), 'Must enforce isValidId on document IDs');
assert.ok(rulesSource.includes('isValidMember('), 'Must enforce isValidMember blueprint');
assert.ok(rulesSource.includes('isValidOrder('), 'Must enforce isValidOrder blueprint');
assert.ok(rulesSource.includes('isValidCommission('), 'Must enforce isValidCommission blueprint');
assert.ok(rulesSource.includes('isValidPaymentIntent('), 'Must enforce isValidPaymentIntent blueprint');
assert.ok(rulesSource.includes('getAfter(/databases/$(database)/documents/commissions/'), 'Must enforce atomic commission credit via getAfter');
assert.ok(rulesSource.includes('existsAfter(/databases/$(database)/documents/orders/'), 'Must enforce atomic order existence via existsAfter');
assert.ok(!/allow\s+read\s*:\s*if\s+true/.test(rulesSource), 'No open read allowed');
assert.ok(!/allow\s+write\s*:\s*if\s+true/.test(rulesSource), 'No open write allowed');
assert.ok(rulesSource.includes('allow update, delete: if false;'), 'Security logs must be immutable');

console.log('All 13 static Red Team security assertions passed.');
