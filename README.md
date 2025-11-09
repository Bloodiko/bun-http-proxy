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

## Requirements

- Bun runtime
- TypeScript 5+

