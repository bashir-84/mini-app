import { randomBytes, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [login = 'teacher', classId = 'class-1'] = process.argv.slice(2);
if (![login, classId].every(value => /^[a-z0-9-]{1,64}$/.test(value))) {
  throw new Error('Use lowercase letters, digits and hyphens.');
}
const key = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
writeFileSync('teacher-local.sql', `INSERT INTO users (id,display_name,login,key_hash)
VALUES ('teacher:${login}','معلم','${login}','${hash}');
INSERT INTO memberships VALUES ('${classId}','teacher:${login}','teacher','active');\n`,
{ flag: 'wx', mode: 0o600 });
console.log('Login:', login);
console.log('Save this access key privately:', key);
console.log('Apply teacher-local.sql after the migrations.');
