/**
 * A simple TCP proxy server for handling HTTP CONNECT requests.
 * This allows proxying HTTPS traffic.
 *
 * Usage:
 * 1. Run this file: `bun run http-proxy.ts`
 * 2. Test with curl: `curl -x http://localhost:8080 https://www.google.com`
 */

export const DEFAULT_PORT = 8080;

export function createProxy(port: number = DEFAULT_PORT) {
  console.log(`Starting TCP proxy server on port ${port}...`);
  // Use a WeakMap to associate metadata with sockets (avoids mutating Bun.Socket)
  const socketMap = new WeakMap<
    Bun.Socket<undefined>,
    { targetSocket?: Bun.Socket<undefined> }
  >();

  const server = Bun.listen({
    hostname: "0.0.0.0",
    port,
    // Use the TCP-level API via the `socket` option
    socket: {
      // 1. A new client connects to our proxy server.
      open(clientSocket: Bun.Socket<undefined>) {
        console.log(`Client connected: ${clientSocket.remoteAddress}`);
        socketMap.set(clientSocket, { targetSocket: undefined });
      },

      // 2. The client sends data to our proxy.
      async data(clientSocket: Bun.Socket<undefined>, buffer: Uint8Array) {
        // Check if we already have a target socket (meaning the tunnel is established)
        const meta = socketMap.get(clientSocket);
        const targetSocket = meta?.targetSocket;

        if (targetSocket) {
          // 6. Tunnel is established. Pipe all data from client -> target.
          // We should handle backpressure here, but for simplicity, we write directly.
          targetSocket.write(buffer);
          return;
        }

        // 3. This is the first packet. It should be an HTTP CONNECT request.
        const requestText = new TextDecoder().decode(buffer);

        // A simple regex to parse the "CONNECT host:port HTTP/1.x" line.
        const connectMatch = requestText.match(
          /^CONNECT ([^:]+):(\d+) HTTP\/1\.[01]/
        );

        if (!connectMatch) {
          console.error("Invalid request. Not a CONNECT method.");
          clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          clientSocket.end();
          return;
        }

        const targetHost = connectMatch[1] ?? "";
        const targetPort = parseInt(connectMatch[2] ?? "0", 10);

        console.log(`CONNECT request for ${targetHost}:${targetPort}`);

        try {
          /**
           * 4. Attempt to connect to the target server.
           */
          const newTargetSocket = await Bun.connect({
            hostname: targetHost,
            port: targetPort,
            socket: {
              data(_targetSocket: Bun.Socket<undefined>, buf: Uint8Array) {
                clientSocket.write(buf);
              },
              close() {
                console.log("Target server disconnected.");
                clientSocket.end();
              },
              error(_: Bun.Socket<undefined>, err: unknown) {
                console.error("Target connection error:", err);
                clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
                clientSocket.end();
              },
              drain() {
                // backpressure handling stub
              },
            },
          });

          // Link the client socket to the new target socket
          if (meta) meta.targetSocket = newTargetSocket;

          /**
           * 5. Send "Connection Established" back to the client.
           * This signals that the TCP tunnel is open and it can
           * start its TLS handshake.
           */
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        } catch (err) {
          console.error(
            `Failed to connect to ${targetHost}:${targetPort}`,
            err
          );
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.end();
        }
      },

      // 7. The client closed the connection.
      close(clientSocket: Bun.Socket<undefined>) {
        console.log("Client disconnected.");
        const meta = socketMap.get(clientSocket);
        if (meta?.targetSocket) {
          meta.targetSocket.end(); // Close the target side too.
        }
        socketMap.delete(clientSocket);
      },

      error(clientSocket: Bun.Socket<undefined>, error: unknown) {
        console.error("Client connection error:", error);
        const meta = socketMap.get(clientSocket);
        if (meta?.targetSocket) {
          meta.targetSocket.end();
        }
      },

      // Handle backpressure from the client.
      drain(clientSocket: Bun.Socket<undefined>) {
        // This means the client's buffer is ready for more data.
        // If we were buffering data from the target, we'd send more now.
      },
    },
  });

  console.log(`Proxy server listening on http://localhost:${server.port}`);

  return server;
}

// If run directly (bun run index.ts) start the server.
if (typeof import.meta !== "undefined" && (import.meta as any).main) {
  createProxy();
}
