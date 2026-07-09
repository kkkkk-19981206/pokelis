const MODEL = "claude-sonnet-5";
const MAX_IMAGES = 6;
const MAX_IMAGE_BASE64 = 8_500_000;
const pinAttempts = new Map();
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_FAILURES = 10;

const listingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    analysis: {
      type: "object",
      additionalProperties: false,
      properties: {
        itemName: { type: "string", description: "写真から確認できる一般的な商品名。断定できない型番は書かない。" },
        confidence: { type: "integer", description: "読み取りの確信度。0から100の整数。" },
        observation: { type: "string", description: "写真で確認できた特徴を、日本語で簡潔に1文。" },
        uncertainty: { type: "string", description: "出品前に人が確認すべき不明点。なければ空文字。" }
      },
      required: ["itemName", "confidence", "observation", "uncertainty"]
    },
    mercari: platformSchema("メルカリ"),
    rakuma: platformSchema("楽天ラクマ")
  },
  required: ["analysis", "mercari", "rakuma"]
};

function platformSchema(platform) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: `${platform}向け。40文字以内の自然で検索しやすい日本語タイトル。` },
      description: { type: "string", description: "事実と入力情報だけを使った、読みやすく誠実な日本語の商品説明。" },
      category: { type: "string", description: "プラットフォームで探す際のカテゴリ候補。正確なカテゴリIDではない。" },
      brand: { type: "string", description: "確認できたブランド。推測なら空文字。" },
      size: { type: "string", description: "確認できたサイズや規格。推測なら空文字。" },
      suggestedPrice: { type: "integer", description: "1円以上。希望価格があれば尊重した出品価格案。なければ一般的な参考推定。" },
      priceLow: { type: "integer", description: "1円以上の価格帯下限。" },
      priceHigh: { type: "integer", description: "1円以上の価格帯上限。" },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "商品と関係する検索キーワードを3〜8個。ハッシュ記号は付けない。"
      }
    },
    required: ["title", "description", "category", "brand", "size", "suggestedPrice", "priceLow", "priceHigh", "keywords"]
  };
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POSTのみ利用できます" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const appPin = process.env.APP_PIN;
  if (!apiKey || !appPin) {
    return res.status(500).json({ error: "サーバーの環境変数が未設定です" });
  }

  if (isPinRateLimited(req)) {
    return res.status(429).json({ error: "PINの誤入力が続いたため、しばらく待ってください" });
  }

  if (!safeEqual(String(req.headers["x-app-pin"] || ""), appPin)) {
    recordPinFailure(req);
    return res.status(401).json({ error: "PINが違います" });
  }
  clearPinFailures(req);

  const validation = validateBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error });
  }

  const { condition, desiredPrice, shipping, memo, images } = req.body;
  const userText = buildPrompt({ condition, desiredPrice, shipping, memo });
  const content = [
    ...images.map((image) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data
      }
    })),
    { type: "text", text: userText }
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2600,
        system: "あなたは日本のフリマ出品を支援する、慎重で誠実なアシスタントです。写真で見えない事実、真贋、型番、素材、購入時期、定価、傷の有無を捏造しません。断定できない内容は不明として扱います。説明文は押し売り調にせず、簡潔で感じのよい日本語にします。",
        messages: [{ role: "user", content }],
        output_config: {
          format: {
            type: "json_schema",
            schema: listingSchema
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Anthropic API error", response.status, JSON.stringify(data).slice(0, 800));
      const status = response.status === 429 ? 429 : 502;
      return res.status(status).json({ error: friendlyApiError(response.status) });
    }

    if (data.stop_reason === "max_tokens") {
      return res.status(502).json({ error: "回答が途中で切れました。もう一度お試しください" });
    }

    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      return res.status(502).json({ error: "AIから回答を受け取れませんでした" });
    }

    const result = JSON.parse(textBlock.text);
    normalizeResult(result, desiredPrice);
    return res.status(200).json(result);
  } catch (error) {
    console.error("generate failed", error);
    return res.status(500).json({ error: "通信に失敗しました。少し待って再度お試しください" });
  }
};

function buildPrompt({ condition, desiredPrice, shipping, memo }) {
  return `添付写真の商品について、メルカリと楽天ラクマへ手動出品するための下書きを作ってください。

出品者からの情報:
- 商品の状態: ${condition}
- 希望価格: ${desiredPrice ? `${desiredPrice}円` : "未指定"}
- 送料: ${shipping === "separate" ? "着払い" : "送料込み"}
- 補足メモ: ${memo || "なし"}

重要なルール:
1. 写真やメモで確認できないブランド・型番・素材・サイズ・真贋は推測で断定しない。
2. 説明文には、商品の特徴、申告された状態、写真で状態を確認してほしい旨、梱包や中古品への自然な注意を含める。
3. 希望価格がある場合はrecommendedPriceの中心として尊重する。
4. 希望価格がない場合、価格はリアルタイム相場検索ではなく一般的な参考推定である。過度に精密な根拠は作らない。
5. メルカリとラクマで同じ事実を保ちつつ、文章を自然に変える。
6. titleは必ず40文字以内。
7. ハッシュタグの乱用や、状態を実際より良く見せる表現は禁止。`;
}

function validateBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "入力がありません" };
  if (typeof body.condition !== "string" || body.condition.length > 50) return { ok: false, error: "商品の状態が不正です" };
  if (body.memo != null && (typeof body.memo !== "string" || body.memo.length > 1000)) return { ok: false, error: "メモは1000文字以内にしてください" };
  if (body.desiredPrice != null && (!Number.isInteger(body.desiredPrice) || body.desiredPrice < 1 || body.desiredPrice > 100000000)) return { ok: false, error: "希望価格が不正です" };
  if (!["included", "separate"].includes(body.shipping)) return { ok: false, error: "送料の指定が不正です" };
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > MAX_IMAGES) return { ok: false, error: `写真は1〜${MAX_IMAGES}枚にしてください` };

  for (const image of body.images) {
    if (!image || image.mediaType !== "image/jpeg" || typeof image.data !== "string") return { ok: false, error: "対応していない画像形式です" };
    if (image.data.length < 100 || image.data.length > MAX_IMAGE_BASE64) return { ok: false, error: "画像サイズが大きすぎます" };
    if (!/^[A-Za-z0-9+/]+=*$/.test(image.data)) return { ok: false, error: "画像データが不正です" };
  }
  return { ok: true };
}

function normalizeResult(result, desiredPrice) {
  result.analysis.confidence = Math.max(0, Math.min(100, Number(result.analysis.confidence) || 0));
  for (const platform of ["mercari", "rakuma"]) {
    const listing = result[platform];
    listing.title = [...String(listing.title || "")].slice(0, 40).join("");
    listing.description = String(listing.description || "").trim();
    listing.brand = String(listing.brand || "").trim();
    listing.size = String(listing.size || "").trim();
    listing.category = String(listing.category || "").trim();
    listing.keywords = [...new Set((listing.keywords || []).map((word) => String(word).replace(/^#+/, "").trim()).filter(Boolean))].slice(0, 8);
    listing.suggestedPrice = Math.max(1, Number(listing.suggestedPrice) || desiredPrice || 1000);
    listing.priceLow = Math.max(1, Number(listing.priceLow) || listing.suggestedPrice);
    listing.priceHigh = Math.max(1, Number(listing.priceHigh) || listing.suggestedPrice);
    if (desiredPrice) listing.suggestedPrice = desiredPrice;
    if (listing.priceLow > listing.priceHigh) [listing.priceLow, listing.priceHigh] = [listing.priceHigh, listing.priceLow];
    if (desiredPrice) {
      listing.priceLow = Math.min(listing.priceLow, desiredPrice);
      listing.priceHigh = Math.max(listing.priceHigh, desiredPrice);
    }
  }
}

function safeEqual(value, expected) {
  if (value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i += 1) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.headers["x-real-ip"] || "unknown");
}

function isPinRateLimited(req) {
  const entry = pinAttempts.get(clientKey(req));
  if (!entry) return false;
  if (Date.now() - entry.startedAt > PIN_WINDOW_MS) {
    pinAttempts.delete(clientKey(req));
    return false;
  }
  return entry.failures >= PIN_MAX_FAILURES;
}

function recordPinFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = pinAttempts.get(key);
  if (!entry || now - entry.startedAt > PIN_WINDOW_MS) {
    pinAttempts.set(key, { failures: 1, startedAt: now });
  } else {
    entry.failures += 1;
  }
  if (pinAttempts.size > 1000) {
    for (const [storedKey, stored] of pinAttempts) {
      if (now - stored.startedAt > PIN_WINDOW_MS) pinAttempts.delete(storedKey);
    }
  }
}

function clearPinFailures(req) {
  pinAttempts.delete(clientKey(req));
}

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function friendlyApiError(status) {
  if (status === 401) return "Anthropic APIキーを確認してください";
  if (status === 402 || status === 403) return "APIの残高または利用権限を確認してください";
  if (status === 413) return "写真のデータ量が大きすぎます";
  if (status === 429) return "APIが混み合っています。少し待ってください";
  return "AIサービスが一時的に利用できません";
}
