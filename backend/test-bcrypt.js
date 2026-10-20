const bcrypt = require('bcryptjs');
async function test() {
  const isMatch = await bcrypt.compare('admin', '$2a$10$wYp3O/1XlR./p2D9g2.X4uWlq59kGgLq.p6.b/9u2T3o6sT2/1nRy');
  console.log("Match:", isMatch);
}
test();
