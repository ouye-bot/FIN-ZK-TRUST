# Audit Fixes Design Spec

> **Goal:** Fix all feasible issues identified in the cryptographic audit (A+B category)

**Architecture:** Backend JS fixes for crypto anti-patterns + Solidity contract fixes for access control + UX improvement for blockchain verification

**Tech Stack:** bcrypt, Node.js crypto (timingSafeEqual, hkdfSync, randomBytes), Solidity 0.8.x, React/MUI

---

## Part A: Backend Code Fixes (7 items)

### A1. Password Hashing: SM3 -> bcrypt (transparent upgrade)

**Files:**
- Modify: `backend/utils/cryptoUtils.js` - add bcrypt functions
- Modify: `backend/routes/auth.js` - update login/register flows

**Design:**
- Add `generateBcryptHash(password)` using bcrypt with cost=12
- Add `verifyBcryptHash(password, hash)` for bcrypt verification
- Login flow: try bcrypt first -> fallback to SM3 -> on SM3 success, transparently upgrade to bcrypt
- New registrations use bcrypt directly
- Detect hash version by length: bcrypt=60 chars, SM3=64 chars
- Keep SM3 functions for non-password use (blockchain hashing, audit chain, etc.)

### A2. HMAC Constant-Time Comparison

**Files:**
- Modify: `backend/services/kmsService.js` lines 36, 113
- Modify: `backend/utils/sm4Crypto.js` (if applicable)

**Design:**
- Replace `authTagHex !== expectedTag` with `crypto.timingSafeEqual(Buffer.from(authTagHex, 'hex'), Buffer.from(expectedTag, 'hex'))`
- Add length check before comparison (timingSafeEqual requires equal-length buffers)

### A3. SM4 Key Separation

**Files:**
- Modify: `backend/services/kmsService.js` - encryptWithDEK, decryptWithDEK

**Design:**
- Derive two keys from DEK using HKDF:
  - `encKey = crypto.hkdfSync('sha256', dekBuffer, '', 'sm4-encryption', 16)`
  - `hmacKey = crypto.hkdfSync('sha256', dekBuffer, '', 'sm3-hmac', 16)`
- Use encKey for SM4-CBC, hmacKey for HMAC-SM3
- Backward compatibility: decryptWithDEK tries new keys first, falls back to old single-key

### A4. SM2 Signature Cache Fix

**Files:**
- Modify: `backend/utils/cryptoUtils.js` line 247

**Design:**
- Change sign cache key from `sm2_sign::${message}` to `sm2_sign::${message}::${privateKey.slice(-8)}`
- Verify cache key already includes publicKey - no change needed

### A5. MFA Service Fixes

**Files:**
- Modify: `backend/services/mfaService.js` lines 124-131, 156-160

**Design:**
- `getSm4Key()`: throw Error if SM4_MASTER_KEY not set (remove hardcoded fallback)
- `decryptSecret()`: throw Error on decryption failure (remove silent return of ciphertext)

### A6. Force SM4_MASTER_KEY

Same as A5 - integrated into `getSm4Key()` fix.

### A7. Math.random -> crypto.randomBytes

**Files:**
- Modify: `backend/middleware/antiReplayMiddleware.js` line 40

**Design:**
- Replace `Math.random().toString(36)....` with `crypto.randomBytes(16).toString('hex')`

---

## Part B: Smart Contract Fixes (3 items)

### B1. AuditStorage: Access Control + bytes32

**Files:**
- Modify: `contracts/contracts/AuditStorage.sol`

**Design:**
- Add `address public owner` + `constructor() { owner = msg.sender; }`
- Add `modifier onlyOwner() { require(msg.sender == owner); _; }`
- Add `mapping(address => bool) public authorizedOperators`
- Add `function authorizeOperator(address op) external onlyOwner`
- `storeAuditHash`: change `string memory hashValue` to `bytes32 hashValue`
- `storeAuditHash`: require `onlyOwner || authorizedOperators[msg.sender]`
- Update mapping: `mapping(bytes32 => AuditRecord)` instead of `mapping(string => AuditRecord)`
- Update recordIndex: `bytes32[]` instead of `string[]`

### B2. ZKPVerifier: Access Control

**Files:**
- Modify: `contracts/contracts/ZKPVerifier.sol`

**Design:**
- Add `address public owner` + constructor + `onlyOwner` modifier
- `recordProofResult`: add `onlyOwner`

### B3. Redeploy + Update Addresses

**Files:**
- Modify: `contracts/scripts/deploy.js` - deploy all contracts
- Update: `backend/contract-addresses.json`

---

## Part C: Blockchain Verification UX

### C1. Backend Verify Endpoint Improvement

**Files:**
- Modify: `backend/routes/blockchain.js` - verify endpoint

**Design:**
- When `transactionData` query param is missing, look up the record by hash from chain
- Return record details + verification status
- New endpoint `GET /verify-by-hash/:hash` for direct hash-based lookup

### C2. Frontend Verify UX

**Files:**
- Modify: `frontend/src/pages/BlockchainExplorer.js`

**Design:**
- Add "Verify" button per table row
- Click calls verify endpoint, shows result in expandable section
- Show: hash match status, on-chain timestamp, submitter address

---

## Execution Order

1. A1-A7 (backend JS fixes) - independent, can be done in sequence
2. B1-B2 (contract changes)
3. B3 (redeploy contracts)
4. C1-C2 (UX improvements)
5. Run existing tests to verify no regressions
