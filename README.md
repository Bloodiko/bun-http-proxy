# Bun HTTP Proxy

Pure TypeScript MITM proxy for TCP/HTTPS connections running on Bun.

## Features

- **MITM HTTPS/TLS** - Break & inspect encrypted connections
- **Bypass mode** - Optional direct forwarding without MITM
- **Dynamic TLS certs** - Generated per-domain on demand
- **Hybrid architecture** - Bun TCP for CONNECT + temp Bun.serve() per connection for routing

## Architecture

1. Proxy receives CONNECT request via Bun TCP
2. Generates domain-specific TLS cert from root CA
3. Creates temporary Bun.serve() instance for that connection
4. Routes traffic through temp server for easy request/response handling
5. Optional: bypass MITM and forward directly

## Status

⚠️ **Prototype phase** - Active experimentation

## Files

- `index.ts` - Legacy TCP proxy implementation (reference)
- `serve.ts` - Current implementation with dynamic TLS
- `certs/` - Root CA & cert generation utilities
- `target/` - HTTPS test server for proxy validation

## Usage

```bash
# Install
bun install

# Run current implementation
bun serve.ts

# Legacy implementation
bun index.ts
```

## Setup

Import generated root CA (`./certs/rootCA.crt`) into system/browser trust store for MITM functionality.

## Testing

```bash
# Start test server (HTTPS on port 3001)
bun run target

# In another terminal, start proxy
bun serve.ts

# Test endpoints
curl -k https://localhost:3001/              # Route list
curl -k https://localhost:3001/delay/2000    # 2s delay
curl -k https://localhost:3001/status/404    # Custom status
```

See `ARCHITECTURE.md` for detailed test infrastructure documentation.

## Requirements

- Bun runtime
- TypeScript 5+

