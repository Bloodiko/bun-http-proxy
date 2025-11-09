import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateRootCA } from "../src/certs/rootCA";
import {
    createCSR,
    signCSR,
    signCSRWithFullChain,
} from "../src/certs/serverCert";
import { Certificate } from "pkijs";
import * as asn1js from "asn1js";

function pemToDer(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN [^-]+-----/, "")
        .replace(/-----END [^-]+-----/, "")
        .replace(/\s/g, "");

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function extractSANs(cert: Certificate): string[] {
    const sanExt = cert.extensions?.find((ext: any) =>
        ext.extnID === "2.5.29.17"
    );
    if (!sanExt) return [];

    // Parse the extension value as a SEQUENCE of GeneralNames
    const asn1 = asn1js.fromBER(sanExt.extnValue.valueBlock.valueHex);
    if (asn1.offset === -1) return [];

    const sanSequence = asn1.result as asn1js.Sequence;
    const dnsNames: string[] = [];

    for (const item of sanSequence.valueBlock.value) {
        // dNSName is tagged as [2] (context-specific, primitive)
        if ((item as any).idBlock?.tagNumber === 2) {
            const valueHex = (item as any).valueBlock?.valueHex ||
                (item as any).valueHex;
            if (valueHex) {
                const dnsName = new TextDecoder().decode(valueHex);
                dnsNames.push(dnsName);
            }
        }
    }

    return dnsNames;
}

describe("Certificate Generation", () => {
    let rootCA: Awaited<ReturnType<typeof generateRootCA>>;

    beforeAll(async () => {
        rootCA = await generateRootCA("TestRootCA", 10);
    });

    test("rootCA generates valid certificate", () => {
        expect(rootCA.certificate).toBeDefined();
        expect(rootCA.certificatePEM).toContain("-----BEGIN CERTIFICATE-----");
        expect(rootCA.certificatePEM).toContain("-----END CERTIFICATE-----");
        expect(rootCA.privateKeyPEM).toContain("-----BEGIN PRIVATE KEY-----");
        expect(rootCA.privateKeyPEM).toContain("-----END PRIVATE KEY-----");
    });

    test("rootCA certificate is self-signed", () => {
        // Issuer should equal subject for self-signed cert
        const issuerCN = rootCA.certificate.issuer.typesAndValues[0]?.value
            .valueBlock.value;
        const subjectCN = rootCA.certificate.subject.typesAndValues[0]?.value
            .valueBlock.value;
        expect(issuerCN).toBe(subjectCN);
    });

    test("rootCA has CA basic constraints", () => {
        const basicConstraintsExt = rootCA.certificate.extensions?.find(
            (ext: any) => ext.extnID === "2.5.29.19",
        );
        expect(basicConstraintsExt).toBeDefined();
        expect(basicConstraintsExt?.critical).toBe(true);
    });

    test("domain cert includes both domain and wildcard SAN", async () => {
        const domain = "example.com";
        const { csr } = await createCSR(domain);
        const { certificate } = await signCSR(rootCA, csr, 365);

        const sans = extractSANs(certificate);
        expect(sans).toContain(domain);
        expect(sans).toContain(`*.${domain}`);
        expect(sans.length).toBe(2);
    });

    test("fullChain PEM contains 2 certificates", async () => {
        const domain = "test.com";
        const { csr, privateKeyPEM } = await createCSR(domain);
        const { fullChainPEM } = await signCSRWithFullChain(
            rootCA,
            csr,
            privateKeyPEM,
            365,
        );

        // Count certificate blocks
        const certCount =
            (fullChainPEM.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
        expect(certCount).toBe(2);

        // Verify it contains both server cert and root CA
        expect(fullChainPEM).toContain("-----BEGIN CERTIFICATE-----");
        expect(fullChainPEM).toContain("-----END CERTIFICATE-----");
    });

    test("domain cert is signed by rootCA", async () => {
        const domain = "signed.test";
        const { csr } = await createCSR(domain);
        const { certificate } = await signCSR(rootCA, csr, 365);

        // Issuer should match rootCA subject
        const issuerCN = certificate.issuer.typesAndValues[0]?.value.valueBlock
            .value;
        const rootSubjectCN = rootCA.certificate.subject.typesAndValues[0]
            ?.value.valueBlock.value;
        expect(issuerCN).toBe(rootSubjectCN);

        // Subject should be the domain
        const subjectCN = certificate.subject.typesAndValues[0]?.value
            .valueBlock.value;
        expect(subjectCN).toBe(domain);
    });

    test("certificate contains CSR's public key", async () => {
        const domain = "keypair.test";
        const { csr, publicKey } = await createCSR(domain);
        const { certificate } = await signCSR(rootCA, csr, 365);

        // Compare the raw subjectPublicKeyInfo bytes
        const csrSpkiDer = csr.subjectPublicKeyInfo.toSchema().toBER(false);
        const certSpkiDer = certificate.subjectPublicKeyInfo.toSchema().toBER(
            false,
        );

        expect(new Uint8Array(csrSpkiDer)).toEqual(new Uint8Array(certSpkiDer));
    });

    test("rootCA persists to files correctly", async () => {
        const testPath = "./certs/test-rootCA";
        await Bun.write(`${testPath}.crt`, rootCA.certificatePEM);
        await Bun.write(`${testPath}.key`, rootCA.privateKeyPEM);

        // Read back and verify
        const loadedCertPEM = await Bun.file(`${testPath}.crt`).text();
        const loadedKeyPEM = await Bun.file(`${testPath}.key`).text();

        expect(loadedCertPEM).toBe(rootCA.certificatePEM);
        expect(loadedKeyPEM).toBe(rootCA.privateKeyPEM);

        // Parse loaded cert
        const certDER = pemToDer(loadedCertPEM);
        const loadedCert = Certificate.fromBER(certDER);

        expect(loadedCert.subject.typesAndValues[0]?.value.valueBlock.value)
            .toBe("TestRootCA");

        // Cleanup
        await Bun.write(`${testPath}.crt`, "").then(() =>
            Bun.file(`${testPath}.crt`).unlink()
        );
        await Bun.write(`${testPath}.key`, "").then(() =>
            Bun.file(`${testPath}.key`).unlink()
        );
    });
});
