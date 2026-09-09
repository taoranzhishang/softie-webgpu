// 生成stripe支付订单的新加坡区脚本如下：
(async function generateTeamLink() {
  // ================= 配置项 =================
  const WORKSPACE_NAME = "workspace";
  const COUPON = "UNSPNGBAM3F3NEWX";
  const SEAT_QUANTITY = 2;
  const COUNTRY = "SG";
  const CURRENCY = "SGD";
  // ==========================================

  console.log("⏳ 正在获取 ChatGPT Session Token...");

  let accessToken;
  try {
    const s = await fetch("/api/auth/session").then((r) => r.json());
    accessToken = s?.accessToken;
    if (!accessToken)
      throw new Error("accessToken 为空，请确认已登录 ChatGPT 账号");
  } catch (e) {
    console.error("❌ 获取 Token 失败：", e.message);
    return;
  }
  console.log("✅ Token 获取成功");

  const payload = {
    plan_name: "chatgptteamplan",
    team_plan_data: {
      workspace_name: WORKSPACE_NAME,
      price_interval: "month",
      seat_quantity: SEAT_QUANTITY,
    },
    billing_details: {
      country: COUNTRY,
      currency: CURRENCY,
    },
    cancel_url: "https://chatgpt.com",
    promo_code: COUPON,
    checkout_ui_mode: "hosted",
  };

  console.log("⏳ 正在请求 Stripe 支付长链接...");
  try {
    const resp = await fetch(
      "https://chatgpt.com/backend-api/payments/checkout",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const data = await resp.json();

    if (!resp.ok) {
      console.error(`❌ 请求失败 HTTP ${resp.status}`);
      console.log("📋 响应详情：", data);
      return;
    }

    const hostedUrl =
      data?.url || data?.stripe_hosted_url || data?.checkout_url;
    if (!hostedUrl) {
      console.warn("⚠️ 未找到长链接，原始响应：", data);
      return;
    }

    console.log("─".repeat(60));
    console.log("✅ ChatGPT Team 链接生成成功！");
    console.log(`📌 工作区名称 : ${WORKSPACE_NAME}`);
    console.log(`💺 席位数量   : ${SEAT_QUANTITY}`);
    console.log(`🎟️  优惠码     : ${COUPON}`);
    console.log(`🌍 地区/货币   : ${COUNTRY} (${CURRENCY})`);
    if (data.checkout_session_id) {
      console.log(`🆔 Session ID : ${data.checkout_session_id}`);
    }
    console.log("─".repeat(60));
    console.log("🔗 Stripe 支付长链接（复制到浏览器打开）：");
    console.log(hostedUrl);
    console.log("─".repeat(60));
  } catch (e) {
    console.error("❌ 网络异常或请求失败：", e.message);
  }
})();
