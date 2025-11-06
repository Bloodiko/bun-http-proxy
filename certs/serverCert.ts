import * as asn1js from "asn1js";
import { CertificationRequest, AttributeTypeAndValue, Extension, Certificate, BasicConstraints, Attribute } from "pkijs";
import { generateRootCA } from "./rootCA";

export interface CSRResult {
	privateKey: CryptoKey;
	publicKey: CryptoKey;
	csr: CertificationRequest;
	csrPEM: string;
	privateKeyPEM: string;
}

export interface SignedCertificateResult {
	certificatePEM: string;
	certificateRaw: ArrayBuffer;
	certificate: Certificate;
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
 * Create a CSR for the given domain using ECDSA P-256 and include SAN extension.
 */
export async function createCSR(domain: string): Promise<CSRResult> {
	const cryptoObj: any = (globalThis as any).crypto;
	if (!cryptoObj || !cryptoObj.subtle) throw new Error("WebCrypto not available");

	// Generate key pair
	const keys = await cryptoObj.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
	const privateKey = keys.privateKey as CryptoKey;
	const publicKey = keys.publicKey as CryptoKey;

	const csr = new CertificationRequest();
	csr.version = 0;

	// Subject: CN=domain
	const cn = new AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: domain }) });
	csr.subject.typesAndValues.push(cn as any);

	// subjectPublicKeyInfo
	await csr.subjectPublicKeyInfo.importKey(publicKey);

	// Add SAN extension as an attribute (pkijs requires requestAttributes)
	// Build SubjectAltName (GeneralNames) -> dNSName (tag [2], IA5String)
	const dnsName = new asn1js.Primitive({ idBlock: { tagClass: 3, tagNumber: 2 }, valueHex: new TextEncoder().encode(domain).buffer });
	const sanSequence = new asn1js.Sequence({ value: [dnsName] });

	// Create an Extension object for SubjectAltName
	const sanExt = new Extension({ extnID: "2.5.29.17", critical: false, extnValue: sanSequence.toBER(false) });

	// The extensionRequest attribute (1.2.840.113549.1.9.14) contains a SET with a SEQUENCE of extensions
	const extensionsSequence = new asn1js.Sequence({ value: [sanExt.toSchema()] });

	const attribute = new Attribute({ type: "1.2.840.113549.1.9.14", values: [extensionsSequence] });
	csr.attributes = csr.attributes || [];
	csr.attributes.push(attribute);

	// Sign CSR
	await csr.sign(privateKey, "SHA-256");

	// Export CSR to DER
	const csrRaw = csr.toSchema(true).toBER(false);
	const csrPEM = toPEM(csrRaw, "CERTIFICATE REQUEST");

	// Export private key as PKCS#8 PEM
	const pkcs8 = await cryptoObj.subtle.exportKey("pkcs8", privateKey);
	const privateKeyPEM = toPEM(pkcs8, "PRIVATE KEY");

	return { privateKey, publicKey, csr, csrPEM, privateKeyPEM };
}

/**
 * Sign a CSR with the given root CA (result from generateRootCA) and return a certificate.
 */
export async function signCSR(rootCA: Awaited<ReturnType<typeof generateRootCA>>, csr: CertificationRequest, validityDays = 365): Promise<SignedCertificateResult> {
	const cryptoObj: any = (globalThis as any).crypto;
	if (!cryptoObj || !cryptoObj.subtle) throw new Error("WebCrypto not available");

	const { certificate: caCert, privateKey: caKey } = rootCA as any;

	// Build new certificate
	const cert = new Certificate();
	cert.version = 2; // v3
	cert.serialNumber = new asn1js.Integer({ value: Date.now() });
	cert.issuer.typesAndValues = caCert.subject.typesAndValues;
	cert.subject.typesAndValues = csr.subject.typesAndValues as any;
	const now = new Date();
	cert.notBefore.value = now;
	const notAfter = new Date(now);
	notAfter.setDate(notAfter.getDate() + validityDays);
	cert.notAfter.value = notAfter;

	// Copy subjectPublicKeyInfo from CSR
	cert.subjectPublicKeyInfo = csr.subjectPublicKeyInfo;

	// BasicConstraints - not a CA
	const basic = new BasicConstraints({ cA: false });
	cert.extensions = [new Extension({ extnID: "2.5.29.19", critical: true, extnValue: basic.toSchema().toBER(false) })] as any;

	// Sign certificate with CA private key
	await cert.sign(caKey, "SHA-256");

	const certRaw = cert.toSchema(true).toBER(false);
	const certPEM = toPEM(certRaw, "CERTIFICATE");

	return { certificatePEM: certPEM, certificateRaw: certRaw, certificate: cert };
}

export default { createCSR, signCSR };

