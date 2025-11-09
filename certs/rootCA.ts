import * as asn1js from "asn1js";
import { Certificate, AttributeTypeAndValue, BasicConstraints, Extension } from "pkijs";

// Minimal type that describes the result of generateRootCA
export interface RootCAResult {
  privateKey: CryptoKey; // PKCS#8 exportable key
  certificate: Certificate;
  certificatePEM: string;
  privateKeyPEM: string; // PKCS#8 PEM
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as any);
  }
  return globalThis.btoa(binary);
}

function toPEM(buffer: ArrayBuffer, label: string) {
  const b64 = arrayBufferToBase64(buffer);
  const chunked = b64.replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${chunked}\n-----END ${label}-----\n`;
}

/**
 * Generate a v3 self-signed root CA using ECDSA (P-256).
 * Returns the key pair, raw certificate and PEM-encoded certificate and private key.
 */
export async function generateRootCA(
  commonName: string = "Local Root CA",
  validityYears: number = 10
): Promise<RootCAResult> {
  // Ensure pkijs is wired to the WebCrypto engine
  const cryptoObj = crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error("WebCrypto (globalThis.crypto.subtle) not available");
  }

  // Set pkijs crypto engine (id string arbitrary)
  // pkijs historically required calling setEngine to wire a crypto
  // implementation. That API has been deprecated in newer pkijs
  // releases. Since this runtime (Bun/Deno) provides a full
  // WebCrypto implementation on `globalThis.crypto.subtle`, we
  // can just use the SubtleCrypto APIs directly and let pkijs
  // operate against the global crypto where appropriate.
  // (If you use an environment without global WebCrypto, you
  // can provide a compatible engine via pkijs' engine APIs.)

  // Generate an EC key pair (P-256) for ECDSA
  const keyPair = await cryptoObj.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const privateKey = keyPair.privateKey as CryptoKey;
  const publicKey = keyPair.publicKey as CryptoKey;

  // Build certificate
  const certificate = new Certificate();
  // X.509 versions are zero-based in the ASN.1 structure:
  //   v1 -> 0, v2 -> 1, v3 -> 2
  // We want X.509 v3, so set numeric value 2.
  const X509_V3 = 2;
  certificate.version = X509_V3;
  certificate.serialNumber = new asn1js.Integer({ value: Date.now() });

  // issuer and subject (self-signed)
  const name = new AttributeTypeAndValue({
    type: "2.5.4.3", // commonName
    value: new asn1js.Utf8String({ value: commonName }),
  });
  certificate.issuer.typesAndValues.push(name);
  certificate.subject.typesAndValues.push(name);

  const now = new Date();
  certificate.notBefore.value = now;
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + validityYears);
  certificate.notAfter.value = notAfter;

  // subjectPublicKeyInfo
  await certificate.subjectPublicKeyInfo.importKey(publicKey);

  // Extensions
  certificate.extensions = [];

  // BasicConstraints: CA = true
  const basicConstr = new BasicConstraints({ cA: true, pathLenConstraint: 0 });
  certificate.extensions.push(new Extension({ extnID: "2.5.29.19", critical: true, extnValue: basicConstr.toSchema().toBER(false) }));

  // KeyUsage: 
  // Digital Signature, Certificate Signing, Off-line CRL Signing, CRL Signing (86)
  const keyUsageBitstring = new asn1js.BitString({ valueHex: new Uint8Array([0x86]).buffer });
  certificate.extensions.push(new Extension({ extnID: "2.5.29.15", critical: true, extnValue: keyUsageBitstring.toBER(false) }));

  // SubjectKeyIdentifier: SHA-1 of public key (SPKI)
  try {
    const spki = await cryptoObj.subtle.exportKey("spki", publicKey);
    const digest = await cryptoObj.subtle.digest("SHA-1", spki);
    const skiOctet = new asn1js.OctetString({ valueHex: digest });
    certificate.extensions.push(new Extension({ extnID: "2.5.29.14", critical: false, extnValue: skiOctet.toBER(false) }));

    // AuthorityKeyIdentifier (keyIdentifier only) -> SEQUENCE { [0] keyIdentifier }
    const keyIdTagged = new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 0 }, value: [skiOctet] });
    const authSeq = new asn1js.Sequence({ value: [keyIdTagged] });
    certificate.extensions.push(new Extension({ extnID: "2.5.29.35", critical: false, extnValue: authSeq.toBER(false) }));
  } catch (e) {
    // ignore ski if export/digest fails
  }

  // Sign certificate with private key using SHA-256 and ECDSA
  await certificate.sign(privateKey, "SHA-256");

  // Export certificate to DER
  const certSchema = certificate.toSchema(true);
  const certRaw = certSchema.toBER(false);

  // Export private key as PKCS#8
  const pkcs8 = await cryptoObj.subtle.exportKey("pkcs8", privateKey);

  const certificatePEM = toPEM(certRaw, "CERTIFICATE");
  const privateKeyPEM = toPEM(pkcs8, "PRIVATE KEY");

  return {
    privateKey,
    certificate,
    certificatePEM,
    privateKeyPEM,
  };
}

export default generateRootCA;
