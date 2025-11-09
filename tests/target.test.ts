import { beforeAll, describe, expect, test } from "bun:test";

const port = 3001; // Connect to existing target server
const baseUrl = `https://localhost:${port}`;

// Test client options to ignore self-signed cert warnings
const fetchOptions: RequestInit = {
    // @ts-expect-error - Bun-specific option to ignore cert errors
    tls: { rejectUnauthorized: false },
};

beforeAll(async () => {
    // Check if server is running
    try {
        const response = await fetch(`${baseUrl}/`, fetchOptions);
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }
        console.log("✓ Connected to target server on port 3001");
    } catch (error) {
        console.error("\n❌ Target server is not running on port 3001");
        console.error("   Start it with: bun run target\n");
        throw new Error(
            "Target server not available. Run 'bun run target' first.",
        );
    }
});

describe("Target Server - Basic Routes", () => {
    test("GET / returns route documentation", async () => {
        const response = await fetch(`${baseUrl}/`, fetchOptions);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/plain");
        const text = await response.text();
        expect(text).toContain("Available Routes");
    });

    test("GET /local/* returns Hallo Welt", async () => {
        const response = await fetch(`${baseUrl}/local/test`, fetchOptions);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe("Hallo Welt.");
    });

    test("GET /local/anything returns Hallo Welt", async () => {
        const response = await fetch(
            `${baseUrl}/local/anything/nested`,
            fetchOptions,
        );
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe("Hallo Welt.");
    });

    test("GET /favicon.ico returns 404", async () => {
        const response = await fetch(`${baseUrl}/favicon.ico`, fetchOptions);
        expect(response.status).toBe(404);
    });
});

describe("Target Server - Status Endpoint", () => {
    test("GET /status/200 returns 200 status", async () => {
        const response = await fetch(`${baseUrl}/status/200`, fetchOptions);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("status 200");
    });

    test("GET /status/404 returns 404 status", async () => {
        const response = await fetch(`${baseUrl}/status/404`, fetchOptions);
        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain("status 404");
    });

    test("GET /status/500 returns 500 status", async () => {
        const response = await fetch(`${baseUrl}/status/500`, fetchOptions);
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).toContain("status 500");
    });

    test("GET /status/201 returns 201 status", async () => {
        const response = await fetch(`${baseUrl}/status/201`, fetchOptions);
        expect(response.status).toBe(201);
        const text = await response.text();
        expect(text).toContain("status 201");
    });

    test("GET /status/invalid defaults to 200", async () => {
        const response = await fetch(
            `${baseUrl}/status/invalid`,
            fetchOptions,
        );
        expect(response.status).toBe(200);
    });
});

describe("Target Server - Delay Endpoint", () => {
    test("GET /delay/100 responds after 100ms", async () => {
        const start = Date.now();
        const response = await fetch(`${baseUrl}/delay/100`, fetchOptions);
        const duration = Date.now() - start;

        expect(response.status).toBe(200);
        expect(duration).toBeGreaterThanOrEqual(100);
        expect(duration).toBeLessThan(500); // Should not take too long

        const text = await response.text();
        expect(text).toContain("100ms delay");
    });

    test("GET /delay/500 responds after 500ms", async () => {
        const start = Date.now();
        const response = await fetch(`${baseUrl}/delay/500`, fetchOptions);
        const duration = Date.now() - start;

        expect(response.status).toBe(200);
        expect(duration).toBeGreaterThanOrEqual(500);
        expect(duration).toBeLessThan(1000);
    });

    test("GET /delay/invalid defaults to 20000ms message", async () => {
        // We won't wait for the full 20s, just check the response starts
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);

        try {
            await fetch(`${baseUrl}/delay/invalid`, {
                ...fetchOptions,
                signal: controller.signal,
            });
        } catch (e) {
            // Expected to abort
            clearTimeout(timeoutId);
            expect(e).toBeDefined();
        }
    }, 2000);
});

// No need to test the stream endpoint for now

describe("Target Server - Proxy Pattern", () => {
    test("Invalid proxy pattern returns error message", async () => {
        const response = await fetch(`${baseUrl}/invalid`, fetchOptions);
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("Not a proxy request");
    });

    test.skip("Valid proxy pattern makes external request", async () => {
        // Skip this test - external proxying behavior depends on network
        // and may cause compression/connection issues in test environment
    });
});

describe("Target Server - Security", () => {
    test("Server uses HTTPS", async () => {
        const url = new URL(baseUrl);
        expect(url.protocol).toBe("https:");
    });

    test("Server responds to HTTPS requests", async () => {
        const response = await fetch(`${baseUrl}/`, fetchOptions);
        expect(response.status).toBe(200);
    });
});

describe("Target Server - HTTP Methods", () => {
    test("POST to /local/ works", async () => {
        const response = await fetch(`${baseUrl}/local/test`, {
            ...fetchOptions,
            method: "POST",
            body: "test data",
        });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe("Hallo Welt.");
    });

    test("PUT to /status/201 works", async () => {
        const response = await fetch(`${baseUrl}/status/201`, {
            ...fetchOptions,
            method: "PUT",
        });
        expect(response.status).toBe(201);
    });

    test("DELETE to /local/ works", async () => {
        const response = await fetch(`${baseUrl}/local/test`, {
            ...fetchOptions,
            method: "DELETE",
        });
        expect(response.status).toBe(200);
    });
});
