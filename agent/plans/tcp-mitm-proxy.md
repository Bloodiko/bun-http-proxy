# TCP MITM Proxy Implementation Plan

## Overview

Refactor serve.ts to use Bun.listen for TCP connections, dynamically spawn
domain-specific Bun.serve instances with self-signed certs, and bridge traffic
between client and inner server.

## Architecture Changes

Replace the HTTP-level proxy with a TCP-level implementation:

- **Main proxy**: `Bun.listen` with socket handlers (port 8080)
- **Inner servers**: Domain-specific `Bun.serve` with TLS (dynamic ports)
- **Traffic flow**: Client TCP → Parse CONNECT → Get/Create inner server →
  Bridge streams

## Implementation Steps

### 0. Reorganize cert code structure (prerequisite)

**Move cert TypeScript files**:

- Move `certs/rootCA.ts` → `src/certs/rootCA.ts`
- Move `certs/serverCert.ts` → `src/certs/serverCert.ts`
- Update imports in `serve.ts` (lines 2-3): `./certs/` → `./src/certs/`

**Update .gitignore**:

- Add `/certs` to ignore generated certificates (rootCA.crt, rootCA.key, etc.)
- The `./certs/` folder will now contain only runtime-generated files, not
  source code

### 1. Fix certificate generation

**Update `src/certs/serverCert.ts`**:

- Modify `createCSR` (line 39) to add wildcard SAN: both `domain` and `*.domain`
  as dNSNames
- Create new function `signCSRWithFullChain` that returns
  `{ privateKeyPEM, fullChainPEM }` where fullChain = serverCert + rootCA cert

**Fix `serve.ts` rootCA loading** (lines 8-30):

- Fix PEM parsing: convert PEM to DER before `Certificate.fromBER` (strip
  headers, decode base64)
- Fix private key import: decode PEM, extract DER, then import as pkcs8
- Ensure rootCA persists to `./certs/rootCA.crt` and `./certs/rootCA.key` on
  first run
- Load from files on subsequent runs

**Create `tests/certs.test.ts`**:

- Test rootCA generation and persistence
- Test domain cert includes both domain and wildcard SAN
- Test fullChain PEM format is valid (contains 2 certs)
- Test cert is signed by rootCA
- Test private key matches cert public key

### 2. Replace main server with Bun.listen

In `serve.ts`, replace the bottom `Bun.serve` (lines 83-90) with `Bun.listen`:

- Use TCP socket API like `index.ts` (lines 20-133)
- Add WeakMap to track client socket metadata
- Implement `open`, `data`, `close`, `error`, `drain` handlers

### 3. Parse CONNECT requests

In the `data` handler:

- Decode first packet as text
- Use regex to extract domain from `CONNECT host:port HTTP/1.1` (see `index.ts`
  line 48-49)
- Extract hostname only (ignore port for cert generation)

### 4. Modify createServerForDomain

Keep the function mostly intact but update the inner `fetch` handler:

- Remove CONNECT handling (lines 54-58) - no longer needed
- Return `new Response("intercepted")` instead of "Hello, World!" (line 60)

### 5. Bridge client to inner server

After getting/creating domain server:

- Send `HTTP/1.1 200 Connection Established\r\n\r\n` to client
- Use `Bun.connect({ hostname: "localhost", port: innerServer.port })`
- Set up bidirectional piping:
  - Client data → inner socket write
  - Inner socket data → client write
  - Handle close/error on both sides

### 6. Remove old onConnectRequest

Delete `onConnectRequest` function (lines 73-81) - logic moves into the socket
`data` handler.

## Key Files

- `src/certs/rootCA.ts` - Root CA generation (moved from certs/)
- `src/certs/serverCert.ts` - Domain cert generation with wildcard SAN (moved
  from certs/)
- `serve.ts` - Complete refactor of main proxy logic
- `tests/certs.test.ts` - Certificate validation tests
- Reference `index.ts` for TCP socket patterns (lines 20-133)
