import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage : node hash-password.js <mot-de-passe>");
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 12));
