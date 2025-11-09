
import {generateRootCA} from "./certs/rootCA";
import {createCSR, signCSR} from "./certs/serverCert";
import { Certificate } from "pkijs";

const servers = new Map<string, Bun.Server<unknown>>();

async function loadRootCA() {
  try {
    const certificatePEM = await Bun.file("./certs/rootCA.crt").text();
    const privateKeyPEM = await Bun.file("./certs/rootCA.key").text();

    const rootCA = Certificate.fromBER(
      Buffer.from(
        certificatePEM,
        "utf8"
      )
    );

    // privateKey as cryptoKey
    const privateKey = await crypto.subtle.importKey("pkcs8", Buffer.from(privateKeyPEM, "utf8"), { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

    return { certificatePEM, privateKeyPEM, privateKey, certificate: rootCA };
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

async function createServerForDomain(domain: string): Promise<Bun.Server<unknown>> {

  const { privateKeyPEM, csr, csrPEM } = await createCSR(domain);
  console.log(`Created CSR for domain: ${domain}`);
  const { certificatePEM, certificate } = await signCSR(rootCA, csr, 365);

  const fullChainPEM = `${certificatePEM}\n${rootCA.certificatePEM}`;
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
  console.log(`Created HTTPS server for domain: https://${domain}:${server.port}`);
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
    console.log(req)

    return await onConnectRequest(req);
  },
})
