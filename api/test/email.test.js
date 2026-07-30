import assert from "node:assert/strict";
import test from "node:test";
import { buildVerificationEmail } from "../src/email.js";

test("builds a branded verification email with safe user content", () => {
  const email = buildVerificationEmail({
    email: "member@example.com",
    displayName: "<script>alert(1)</script>",
    token: "verification-token"
  });
  assert.equal(email.subject, "完成注册 | 超级大脑");
  assert.match(email.text, /24 小时/);
  assert.match(email.html, /完成邮箱验证/);
  assert.match(email.html, /私有知识空间/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.doesNotMatch(email.html, /<script>alert/);
  assert.match(email.html, /verification-token/);
});
