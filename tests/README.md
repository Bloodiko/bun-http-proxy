# Test Suite

Automated tests using Bun's test framework.

## Prerequisites

**Start the target server before running tests:**

```bash
# Terminal 1 - Start target server
bun run target
```

## Running Tests

```bash
# Terminal 2 - Run tests
# Run all tests
bun test

# Run target server tests only
bun test:target
```

Tests will fail if the target server is not running on port 3001.

## Test Coverage

### `target.test.ts`

Tests for HTTPS test server (`target/target.bun.ts`).

**Coverage:**

- Basic routes (/, /local/*, /favicon.ico)
- Status endpoint (/status/{code})
- Delay endpoint (/delay/{ms})
- Proxy pattern validation
- HTTPS security
- HTTP methods (GET, POST, PUT, DELETE)

**Stats:** 18 tests pass, 1 skipped, ~1.6s runtime

## Implementation Details

- Tests connect to existing server on port 3001
- `beforeAll` verifies server availability (fails fast if not running)
- Ignores TLS cert validation (test environment)
- Validates response status, content, timing
- Does not start/stop server (manual control)

## Adding Tests

Create new test files in this directory:

```typescript
import { describe, expect, test } from "bun:test";

describe("My Feature", () => {
    test("does something", () => {
        expect(true).toBe(true);
    });
});
```
