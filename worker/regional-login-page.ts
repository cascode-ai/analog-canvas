/** Shown only at the opt-in authority continuation; provider secrets stay there. */
export function regionalLoginPage(
  returnPath: string,
  providers: { github: boolean; google: boolean; email: boolean },
  currentAccount = false,
): Response {
  const choices = (["github", "google"] as const)
    .filter((provider) => providers[provider])
    .map(
      (provider) =>
        `<p><a href="/api/auth/${provider}/start?return=${encodeURIComponent(returnPath)}">${provider === "google" ? "Google" : "GitHub"}</a></p>`,
    )
    .join("");
  const mail = providers.email
    ? `<form id="email-form"><label>邮箱 <input id="email" type="email" autocomplete="email" required></label><button>发送验证码</button></form>
    <form id="code-form" hidden><label>验证码 <input id="code" inputmode="numeric" autocomplete="one-time-code" required></label><button>验证并继续</button></form>`
    : "";
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canvas 登录</title>
    <main><h1>登录 Canvas</h1><p>登录后返回发起登录的 Canvas 站点。</p>${currentAccount ? `<p><a href="${returnPath.replace(/&/gu, "&amp;")}">Continue with current account</a></p>` : ""}${choices}${mail}<p id="status" role="status"></p></main>
    <script>
      const status = document.getElementById('status');
      async function post(path, body) {
        const response = await fetch(path, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
        if (!response.ok) throw new Error('登录未完成，请稍后重试。');
      }
      const emailForm = document.getElementById('email-form');
      if (emailForm) {
        emailForm.onsubmit = async (event) => {
          event.preventDefault();
          try {await post('/api/auth/email/start', {email:document.getElementById('email').value}); document.getElementById('code-form').hidden = false; status.textContent = '验证码已发送。';}
          catch (error) {status.textContent = error.message;}
        };
        document.getElementById('code-form').onsubmit = async (event) => {
          event.preventDefault();
          try {await post('/api/auth/email/verify', {email:document.getElementById('email').value, code:document.getElementById('code').value}); location.assign(${JSON.stringify(returnPath).replace(/</gu, "\\u003c")});}
          catch (error) {status.textContent = error.message;}
        };
      }
    </script></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "content-security-policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      },
    },
  );
}
