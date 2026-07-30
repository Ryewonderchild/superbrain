const resendEndpoint = process.env.RESEND_API_URL || "https://api.resend.com/emails";

function publicUrl() {
  return String(process.env.APP_PUBLIC_URL || "https://ryewonderchild.com").replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function verificationUrl(token) {
  return `${publicUrl()}/?verify=${encodeURIComponent(token)}`;
}

export function buildVerificationEmail({ email, displayName, token }) {
  const link = verificationUrl(token);
  const safeName = escapeHtml(displayName || email.split("@")[0] || "你好");
  const safeEmail = escapeHtml(email);
  const safeLink = escapeHtml(link);
  return {
    subject: "完成注册 | 超级大脑",
    text: `${displayName || "你好"}：

欢迎加入超级大脑。

请在 24 小时内打开下面的链接验证邮箱，以启用你的私有知识空间：
${link}

该链接只能使用一次。如果这不是你的操作，请忽略此邮件。

超级大脑
知识有来源，关系可验证
https://ryewonderchild.com`,
    html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>完成注册 | 超级大脑</title>
</head>
<body style="margin:0;padding:0;background:#e7e2d7;color:#222723;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">验证邮箱，启用你的私有知识空间。</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#e7e2d7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#fffdf8;border:1px solid #cbc5b9;">
          <tr>
            <td style="padding:24px 32px;background:#26322d;color:#f7f5ef;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:19px;font-weight:700;letter-spacing:0;">超级大脑</td>
                  <td align="right" style="font-size:11px;color:#b8c7c0;text-transform:uppercase;">KNOWLEDGE, WITH PROVENANCE</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:48px 40px 18px;">
              <div style="font-size:12px;font-weight:700;color:#2f6f67;text-transform:uppercase;margin-bottom:14px;">ACCOUNT VERIFICATION</div>
              <h1 style="margin:0 0 18px;font-size:30px;line-height:1.25;font-weight:700;color:#222723;">验证邮箱，开始构建<br>你的知识网络</h1>
              <p style="margin:0 0 12px;font-size:16px;line-height:1.8;color:#3d4944;">${safeName}，你好。</p>
              <p style="margin:0;font-size:16px;line-height:1.8;color:#3d4944;">你正在注册超级大脑。完成验证后，即可启用独立的私有知识空间、模型配置与 Token 账户。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 40px 32px;">
              <a href="${safeLink}" style="display:inline-block;padding:14px 24px;background:#2f6f67;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:4px;">完成邮箱验证</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 36px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1eee6;border-left:3px solid #d6a76d;">
                <tr>
                  <td style="padding:16px 18px;font-size:13px;line-height:1.7;color:#4f5954;">
                    <strong style="color:#26322d;">验证有效期：24 小时</strong><br>
                    注册邮箱：${safeEmail}<br>
                    链接验证成功后立即失效。
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 42px;">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#66706b;">按钮无法打开时，请将以下地址粘贴到浏览器：</p>
              <p style="margin:0;padding:12px 14px;background:#ece6da;font-size:12px;line-height:1.6;color:#355249;word-break:break-all;">${safeLink}</p>
              <p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#75807b;">如果这不是你的操作，请直接忽略此邮件。我们不会因此创建一个已激活的账户。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px;border-top:1px solid #d8d1c4;font-size:12px;line-height:1.6;color:#66706b;">
              <strong style="color:#26322d;">超级大脑</strong><br>
              知识有来源，关系可验证<br>
              <a href="https://ryewonderchild.com" style="color:#2f6f67;text-decoration:none;">ryewonderchild.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  };
}

export async function sendVerificationEmail({ email, displayName, token }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    const error = new Error("邮件服务尚未配置，请联系管理员");
    error.statusCode = 503;
    throw error;
  }

  const content = buildVerificationEmail({ email, displayName, token });
  const response = await fetch(resendEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [email],
      ...content
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "验证邮件发送失败，请稍后重试");
    error.statusCode = 502;
    throw error;
  }
  return payload;
}
