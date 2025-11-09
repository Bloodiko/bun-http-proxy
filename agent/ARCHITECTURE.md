# Architecture Documentation

## Project Overview

MITM HTTP/HTTPS proxy built on Bun runtime with dynamic TLS certificate generation.

## Core Components

### 1. Proxy Implementations

#### `serve.ts` (Current)
- MITM proxy with dynamic TLS cert generation
- Hybrid: Bun TCP for CONNECT + temp Bun.serve() per connection
- On-demand domain-specific certificates from root CA
- Optional bypass mode for direct forwarding

#### `index.ts` (Legacy)
- Plain TCP proxy using Bun TCP API
- CONNECT tunneling only
- Kept for reference during prototyping

### 2. Certificate Infrastructure (`certs/`)

#### `rootCA.ts`
- Generates self-signed root CA using ECDSA P-256
- X.509 v3 with CA basic constraints
- 10-year validity
- Exports PEM format for system trust store
- Uses pkijs + asn1js for certificate operations

#### `serverCert.ts`
- Creates CSR for domain-specific certificates
- Signs CSR with root CA to issue server certificates
- Includes SubjectAltName (SAN) extension
- 1-year validity per certificate
- ECDSA P-256 keys

**Workflow:**
1. Generate root CA once on startup
2. Per-domain: create CSR → sign with root CA → get server cert
3. Use server cert in temporary Bun.serve() for MITM

## Test Infrastructure (`target/`)

### Purpose
Standalone HTTPS test server for validating proxy functionality without external dependencies.

### Components

#### `target.bun.ts` - Test Server
HTTPS server with self-signed certificate running on port 3001.

**Endpoints:**
- `GET /` - Route documentation
- `GET /exit` - Shutdown server
- `GET /local/*` - Simple response ("Hallo Welt.")
- `GET /stream` - Real-time request monitoring stream
- `GET /favicon.ico` - 404 response
- `GET /delay/{ms}` - Delayed response (default 20s)
- `GET /status/{code}` - Custom HTTP status response
- `ANY /{domain}/{path}` - Proxy requests to external domains

**Features:**
- Self-signed TLS certificate (localhost)
- Request logging to connected streams
- Acts as both target server & secondary proxy
- Useful for testing proxy chains

**Usage:**
```bash
bun run target
# or
bun run target/target.bun.ts
# Access at https://localhost:3001/
```

#### `cert.ts` - Certificate Generator
Self-signed certificate generator for test server.

**Implementation:**
- ECDSA P-256 key generation
- X.509 v3 certificate
- SubjectAltName extension for localhost
- 1-year validity
- PEM format output
- Uses pkijs + asn1js (consistent with main proxy)

**Key differences from main proxy certs:**
- Self-signed (not CA-signed)
- Single certificate, not CA infrastructure
- Simplified for testing purposes

### Testing Workflow

1. Start test server: `bun run target`
2. Start proxy: `bun serve.ts`
3. Configure client to use proxy
4. Make requests to `https://localhost:3001/*`
5. Monitor requests via `/stream` endpoint

**Test scenarios:**
- Delay testing: `/delay/5000`
- Error handling: `/status/500`
- Streaming: `/stream`
- External proxying: `/example.com/api`
- MITM validation: Any endpoint through main proxy

## Data Flow

### MITM Proxy Flow (serve.ts)
```
Client → Proxy (TCP CONNECT)
      ↓
Generate domain cert from root CA
      ↓
Temp Bun.serve() with domain cert
      ↓
Client ←SSL→ Proxy ←SSL→ Target
      ↓
Inspect/modify requests & responses
```

### Test Infrastructure Flow
```
Test Client → Main Proxy → Test Server (localhost:3001)
                  ↓              ↓
           Inspect traffic   Log requests
                             Return test data
```

## Dependencies

**Runtime:**
- Bun (TCP API, serve, crypto)

**Core:**
- `pkijs@3.3.2` - X.509/PKCS operations
- `asn1js@3.0.6` - ASN.1 encoding/decoding

**Development:**
- `@types/bun` - Bun TypeScript definitions
- `@types/node` - Node.js type definitions
- TypeScript 5+

## File Structure

```
bun-http-proxy/
├── index.ts              # Legacy TCP proxy
├── serve.ts              # Current MITM proxy
├── certs/
│   ├── rootCA.ts         # Root CA generation
│   └── serverCert.ts     # Domain cert signing
├── target/
│   ├── target.bun.ts     # HTTPS test server
│   └── cert.ts           # Test cert generator
├── package.json          # Dependencies & scripts
├── tsconfig.json         # TypeScript config
├── AGENT.md              # AI assistant guidelines
├── README.md             # User documentation
└── ARCHITECTURE.md       # This file
```

## Development Workflow

1. **Prototype phase** - Rapid iteration expected
2. Both proxy implementations active for comparison
3. Test server provides isolated testing environment
4. No over-engineering - keep it simple

## Future Considerations

- Performance optimization for cert generation
- Certificate caching mechanism
- Connection pooling
- Request/response modification API
- Test suite expansion
- Production hardening (if needed)

