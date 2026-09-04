// encrypt-data.js <file.json> [file.json ...]
// Encrypts each plaintext JSON file to <name>.enc.json and DELETES the
// plaintext, so it can never be committed. Run in CI right after the
// fetch / generate scripts. Requires the DATA_ENCRYPTION_KEY secret.

const fs = require('fs');
const { encryptJSON } = require('./lib/crypto');

const KEY = process.env.DATA_ENCRYPTION_KEY;
const files = process.argv.slice(2);

(async () => {
  if (!KEY) throw new Error('Missing DATA_ENCRYPTION_KEY');
  if (!files.length) throw new Error('Usage: node encrypt-data.js <file.json> [...]');

  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`skip ${f} (not present)`); continue; }
    const obj = JSON.parse(fs.readFileSync(f, 'utf8'));
    const out = f.replace(/\.json$/, '.enc.json');
    fs.writeFileSync(out, JSON.stringify(await encryptJSON(obj, KEY)));
    fs.rmSync(f);
    console.log(`encrypted ${f} -> ${out}`);
  }
})();
