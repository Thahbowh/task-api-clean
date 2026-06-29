const bcrypt = require('bcryptjs');

const hash = bcrypt.hashSync("123456", 10);

console.log(hash);