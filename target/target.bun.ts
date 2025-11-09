import util from "node:util";
import { generateSelfSignedCert } from "./cert";

const port = 3001;

const connected_streams = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
>();
const encoder = new TextEncoder();

function sendToStreams(obj: object | string) {
    console.log("[Target]", obj);
    const s = typeof obj === "string" ? obj : util.inspect(obj);
    connected_streams.values().forEach((controller) => {
        controller.enqueue(encoder.encode(s + "\n"));
    });
}

const handler = async (request: Request): Promise<Response> => {
    sendToStreams(`\n____________\n${new Date().toISOString()} - New Request:`);
    const url = new URL(request.url);

    sendToStreams(request.method + " Request: " + url.pathname);
    //console.log(request);

    // Root path - show available routes
    if (url.pathname === "/") {
        const routes = `
Target Test Server - HTTPS Enabled
===================================

Available Routes:
-----------------

GET  /                     - Show this help message
GET  /exit                 - Shut down the server
GET  /local/*              - Return "Hallo Welt." response
GET  /stream                - Open a stream to monitor all requests in real-time
GET  /favicon.ico          - Returns 404 (not found)
GET  /delay/{ms}           - Return response after specified delay (default: 20000ms)
     Example: /delay/5000  - 5 second delay
GET  /status/{code}        - Return response with specified HTTP status code
     Example: /status/404  - Returns 404 status
ANY  /{domain}/{path}      - Proxy request to the specified domain
     Example: /example.com/api/users

Notes:
- This server uses HTTPS with a self-signed certificate
- The proxy route (/{domain}/{path}) works with any HTTP method (GET, POST, PUT, DELETE, etc.)
- Streams can be monitored by connecting to /stream endpoint
- Use 'curl -k https://localhost:${port}/' to test from command line
`;
        return new Response(routes, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
        });
    }

    if (url.pathname === "/exit") {
        setTimeout(process.exit, 0, 0);
        return new Response("closing proxy");
    }

    let response = new Response("Hallo Welt.");
    if (url.pathname.startsWith("/local/")) {
        return response;
    }

    if (url.pathname == "/stream") {
        const uuid = crypto.randomUUID();
        return new Response(
            new ReadableStream({
                start(controller) {
                    connected_streams.set(uuid, controller);
                },
                cancel() {
                    connected_streams.delete(uuid);
                },
            }),
        );
    }

    if (url.pathname == "/favicon.ico") {
        return new Response(null, {
            status: 404,
            statusText: "not found",
        });
    }

    if (url.pathname.startsWith("/delay/")) {
        const delay = Number(url.pathname.split("/").pop()) || 20000; // defaulting to 20000ms --> 20s if not valid
        response = new Response(
            `Returning with ${delay}ms delay. Default delay is 20000ms == 20s`,
            { status: 200 },
        );
        await new Promise((r) => setTimeout(r, delay));
        return response;
    }

    if (url.pathname.startsWith("/status/")) {
        const status = Number(url.pathname.split("/").pop()) || 200; // defaulting to 200 if not valid
        response = new Response(
            `Returning with status ${status}. (If you receive 200 and did not request 200, conversion failed.)`,
            { status: status },
        );
        return response;
    }

    const pathname = url.pathname.startsWith("/")
        ? url.pathname.replace("/", "")
        : url.pathname;

    const splitted = pathname.split("/");
    const domain = splitted.shift();
    const path = splitted.join("/");

    if (!domain?.match(/\./g)) {
        sendToStreams(`not a proxy request: ${url.href}`);
        return new Response(
            `Not a proxy request: ${url.href}.\nUse /domain.com/path/to/file`,
        );
    }
    try {
        const headers = new Headers(request.headers);
        headers.set("Host", domain);
        //headers.set("user-agent", "curl/7.61.1")
        const remoteRequest = new Request(
            `https://${domain}/${path}${url.search}`,
            {
                method: request.method,
                headers: headers,
                body: request.body,
            },
        );

        sendToStreams(remoteRequest);

        const requestPromise = fetch(remoteRequest, {}); // includes leading /

        requestPromise.then((remoteResponse) => {
            const response = remoteResponse.clone();

            const responseHeader = structuredClone(response.headers);
            const contentType = responseHeader.get("content-type");
            const isTextBased = contentType?.match(
                /(text)|(json)|(script)|(xml)/g,
            )?.length;

            sendToStreams(response);

            if (request.method != "HEAD" && isTextBased) {
                response.text().then((responseText) => {
                    sendToStreams(`Response Body: ${responseText}`);
                });
            } else {
                // assume non-text data, pass as is to client
                sendToStreams(
                    `Head Request or none-text-content: ${request.method}: ${contentType}`,
                );
            }

            return remoteResponse;
        }, (e) => {
            if (e instanceof Error) {
                sendToStreams(e);
                return new Response(e.message, {
                    status: 500,
                    statusText: e.name,
                });
            } else {
                return new Response("unknown error in forwarding request", {
                    status: 500,
                    statusText: "unknown error",
                });
            }
        });

        const aresResponse = await requestPromise;

        response = aresResponse;
    } catch (e) {
        sendToStreams(`Error: ${e}`);
        if (e instanceof Error) {
            response = new Response(e.message, {
                status: 500,
                statusText: e.name,
            });
        } else {
            response = new Response("Unknown Error", {
                status: 500,
            });
        }
    }

    //console.log(`Returning Response:`);
    //console.log(response);
    return response;
};

// Generate self-signed certificate
console.log("[Target] Generating self-signed certificate...");
const { cert, key } = await generateSelfSignedCert("localhost");

console.log(`[Target] Server is running on https://localhost:${port}`);
console.log(
    `[Target] Visit https://localhost:${port}/ to see all available routes`,
);
console.log(
    `[Target] \nNote: This server uses a self-signed certificate. Your browser will show a security warning.`,
);
console.log(
    `[Target] In your browser, you may need to accept the certificate or use 'curl -k' to test.`,
);

Bun.serve({
    port,
    fetch: handler,
    tls: {
        cert,
        key,
    },
});
