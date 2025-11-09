import * as asn1js from "asn1js";
import {
    AttributeTypeAndValue,
    BasicConstraints,
    Certificate,
    Extension,
} from "pkijs";

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
 * Generate a simple self-signed certificate for the target test server
 */
export async function generateSelfSignedCert(domain: string = "localhost") {
    const cryptoObj = crypto;
    if (!cryptoObj || !cryptoObj.subtle) {
        throw new Error("WebCrypto not available");
    }

    // Generate EC key pair (P-256) for ECDSA
    const keyPair = await cryptoObj.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"],
    );

    const privateKey = keyPair.privateKey as CryptoKey;
    const publicKey = keyPair.publicKey as CryptoKey;

    // Build certificate
    const certificate = new Certificate();
    certificate.version = 2; // X.509 v3
    certificate.serialNumber = new asn1js.Integer({ value: Date.now() });

    // Subject and Issuer (self-signed)
    const cn = new AttributeTypeAndValue({
        type: "2.5.4.3", // commonName
        value: new asn1js.Utf8String({ value: domain }),
    });
    certificate.issuer.typesAndValues.push(cn);
    certificate.subject.typesAndValues.push(cn);

    // Validity period (1 year)
    const now = new Date();
    certificate.notBefore.value = now;
    const notAfter = new Date(now);
    notAfter.setFullYear(notAfter.getFullYear() + 1);
    certificate.notAfter.value = notAfter;

    // Public key
    await certificate.subjectPublicKeyInfo.importKey(publicKey);

    // Extensions
    certificate.extensions = [];

    // BasicConstraints: not a CA
    const basicConstr = new BasicConstraints({ cA: false });
    certificate.extensions.push(
        new Extension({
            extnID: "2.5.29.19",
            critical: true,
            extnValue: basicConstr.toSchema().toBER(false),
        }),
    );

    // SubjectAltName: DNS name
    const dnsName = new asn1js.Primitive({
        idBlock: { tagClass: 3, tagNumber: 2 },
        valueHex: new TextEncoder().encode(domain).buffer,
    });
    const sanSequence = new asn1js.Sequence({ value: [dnsName] });
    certificate.extensions.push(
        new Extension({
            extnID: "2.5.29.17",
            critical: false,
            extnValue: sanSequence.toBER(false),
        }),
    );

    // Sign certificate
    await certificate.sign(privateKey, "SHA-256");

    // Export to PEM format
    const certRaw = certificate.toSchema(true).toBER(false);
    const certificatePEM = toPEM(certRaw, "CERTIFICATE");

    const pkcs8 = await cryptoObj.subtle.exportKey("pkcs8", privateKey);
    const privateKeyPEM = toPEM(pkcs8, "PRIVATE KEY");

    return {
        cert: certificatePEM,
        key: privateKeyPEM,
    };
}
