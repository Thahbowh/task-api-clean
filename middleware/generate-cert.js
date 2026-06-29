// generate-cert.js
// ─────────────────────────────────────────────────────────────────────────────
// Generates a self-signed TLS certificate + private key for local HTTPS,
// with the correct SAN (Subject Alternative Name) entries so modern
// browsers (Chrome, Edge) will actually trust it once imported — a plain
// old-style self-signed cert without SANs gets silently rejected by them.
//
// Run this once: node generate-cert.js
// It creates two files in this same folder: cert.pem and key.pem
// ─────────────────────────────────────────────────────────────────────────────

const selfsigned = require('selfsigned');
const fs = require('fs');

// ── CHANGE THIS if your server's local IP is different ──────────────────────
const SERVER_IP = '192.168.8.152';

const attrs = [{ name: 'commonName', value: SERVER_IP }];

const options = {
  days: 825, // ~2.25 years — Chrome/Safari cap cert lifetime, this stays under it
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    {
      name: 'basicConstraints',
      cA: true,
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 7, ip: SERVER_IP },   // type 7 = IP address
        { type: 7, ip: '127.0.0.1' },
        { type: 2, value: 'localhost' }, // type 2 = DNS name
      ],
    },
  ],
};

async function main() {
  console.log(`Generating self-signed certificate for ${SERVER_IP} ...`);

  const pems = await selfsigned.generate(attrs, options);

  fs.writeFileSync('cert.pem', pems.cert);
  fs.writeFileSync('key.pem', pems.private);

  console.log('✅ Done. Created:');
  console.log('   - cert.pem  (the certificate — safe to share/install on devices)');
  console.log('   - key.pem   (the private key — keep this secret, never share it)');
  console.log('');
  console.log('Next: update server.js to use these files for HTTPS.');
}

main().catch(err => {
  console.error('❌ Certificate generation failed:', err.message);
  process.exit(1);
});