import fs from 'fs';
import path from 'path';

const mappings = [
  ['DB_PASSWORD', 'db_owner_password.txt'],
  ['APP_DB_PASSWORD', 'app_db_password.txt'],
];
const missing = mappings.filter(([name]) => !process.env[name]);
if (missing.length) {
  console.error(`Missing legacy .env value(s): ${missing.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

const directory = path.resolve('secrets');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.chmodSync(directory, 0o700);

const existing = mappings.filter(([, filename]) => fs.existsSync(path.join(directory, filename)));
if (existing.length) {
  console.error(`Refusing to overwrite existing secret(s): ${existing.map(([, filename]) => `secrets/${filename}`).join(', ')}`);
  process.exit(1);
}

for (const [name, filename] of mappings) {
  const target = path.join(directory, filename);
  try {
    fs.writeFileSync(target, process.env[name], { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    console.log(`Created secrets/${filename} from ${name}.`);
  } catch (error) {
    console.error(error.code === 'EEXIST'
      ? `Refusing to overwrite existing secrets/${filename}.`
      : `Could not create secrets/${filename}: ${error.message}`);
    process.exit(1);
  }
}

console.log('Secrets migrated. Keep the old .env values until the updated stack starts successfully, then remove them.');
