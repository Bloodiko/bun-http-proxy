import { generateRootCA } from "./src/certs/rootCA";
import { createCSR, signCSRWithFullChain } from "./src/certs/serverCert";
import { Certificate } from "pkijs";

const servers = new Map<string, Bun.Server<unknown>>();

function pemToDer(pem: string): ArrayBuffer {
  // Remove PEM headers and footers, strip whitespace
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s/g, "");

  // Base64 decode to binary
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function loadRootCA() {
  try {
    const certificatePEM = await Bun.file("./certs/rootCA.crt").text();
    const privateKeyPEM = await Bun.file("./certs/rootCA.key").text();

    // Convert PEM to DER before parsing
    const certDER = pemToDer(certificatePEM);
    const certificate = Certificate.fromBER(certDER);

    // Convert PEM to DER and import private key
    const keyDER = pemToDer(privateKeyPEM);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      keyDER,
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    );

    return { certificatePEM, privateKeyPEM, privateKey, certificate };
  } catch (error) {
    console.error("Error loading root CA:", error);
    const rootCA = await generateRootCA("CodikyoProxyRoot", 10);

    return rootCA;
  }
}

const rootCA = await loadRootCA();

Bun.file("./certs/rootCA.crt").write(rootCA.certificatePEM);
console.log("Root CA certificate written to ./certs/rootCA.crt");
Bun.file("./certs/rootCA.key").write(rootCA.privateKeyPEM);
console.log("Root CA private key written to ./certs/rootCA.key");

async function createServerForDomain(
  domain: string,
): Promise<Bun.Server<unknown>> {
  const { privateKeyPEM, csr } = await createCSR(domain);
  console.log(`Created CSR for domain: ${domain}`);
  const { fullChainPEM } = await signCSRWithFullChain(
    rootCA,
    csr,
    privateKeyPEM,
    365,
  );
  console.log(fullChainPEM);

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      console.log(req);
      console.log(`Request handled in custom server for domain: ${domain}`);

      if (req.method === "CONNECT") {
        return new Response(null, {
          status: 200,
        });
      }

      return new Response("Hello, World!");
    },
    tls: {
      key: privateKeyPEM,
      // Provide the full chain: server cert followed by the root CA cert
      cert: fullChainPEM,
    },
  });
  servers.set(domain, server);
  console.log(
    `Created HTTPS server for domain: https://${domain}:${server.port}`,
  );
  return server;
}

const onConnectRequest = async (request: Request): Promise<Response> => {
  const host = request.headers.get("host");
  if (!host) {
    return new Response("Bad Request: Missing Host header", { status: 400 });
  }
  const domain = new URL(`http://${host}`).hostname;
  const server = servers.get(domain) || await createServerForDomain(domain);
  return await server.fetch(request);
};

Bun.serve({
  port: 8080,
  async fetch(req) {
    console.log(req);

    return await onConnectRequest(req);
  },
});
