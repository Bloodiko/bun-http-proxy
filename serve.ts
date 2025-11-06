
import {generateRootCA} from "./certs/rootCA";
import {createCSR, signCSR} from "./certs/serverCert";

const servers = new Map<string, Bun.Server<unknown>>();

const rootCA = await generateRootCA("CodikyoProxyRoot", 10);

async function createServerForDomain(domain: string): Promise<Bun.Server<unknown>> {

  const { privateKeyPEM, csr, csrPEM } = await createCSR(domain);
  console.log(`Created CSR for domain: ${domain}`);
  const { certificatePEM, certificate } = await signCSR(rootCA, csr, 365);

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      console.log(req)
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
      cert: `${certificatePEM}\n${rootCA.certificatePEM}`,
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
