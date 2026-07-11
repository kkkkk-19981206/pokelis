const MODEL = "claude-sonnet-5";
const MAX_IMAGE_BASE64 = 9_000_000;
const pinAttempts = new Map();
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_FAILURES = 10;

// Instagramのユーザーネームで使える文字（英数字・ピリオド・アンダースコア、最大30文字）
const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

const identifySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    isInstagramStory: {
      type: "boolean",
      description: "画像がInstagramのストーリー画面のスクリーンショットであればtrue。見た目がフィード投稿やDM、別アプリならfalse。"
    },
    account: {
      type: "object",
      additionalProperties: false,
      properties: {
        username: {
          type: "string",
          description: "画面に文字として表示されているユーザーネーム（@に続く英数字・ピリオド・アンダースコア）。はっきり読み取れない場合は必ず空文字。プロフィール画像や表示名から推測して創作しない。"
        },
        displayName: {
          type: "string",
          description: "表示名（本名やニックネーム）。ユーザーネームとは別物。見えなければ空文字。"
        },
        verified: {
          type: "boolean",
          description: "名前の横に認証バッジ（青いチェックマーク）が見えればtrue。"
        },
        confidence: {
          type: "integer",
          description: "ユーザーネームを正しく読み取れた確信度。0〜100の整数。文字がぼやけている・一部しか見えない場合は低くする。"
        },
        readFrom: {
          type: "string",
          description: "アカウント情報をどこから読み取ったかを日本語で簡潔に。例：ストーリー左上のユーザー名表示。"
        }
      },
      required: ["username", "displayName", "verified", "confidence", "readFrom"]
    },
    story: {
      type: "object",
      additionalProperties: false,
      properties: {
        postedAgo: {
          type: "string",
          description: "投稿からの経過時間の表示（例：3時間前、5h）。見えなければ空文字。"
        },
        summary: {
          type: "string",
          description: "ストーリーに写っている内容を日本語で簡潔に1文。個人を推測で特定する表現は避ける。"
        },
        visibleText: {
          type: "array",
          items: { type: "string" },
          description: "画面に見えるテキスト・キャプション・スタンプ・場所や音楽の表示などを短く列挙。なければ空配列。"
        },
        mentions: {
          type: "array",
          items: { type: "string" },
          description: "ストーリー内にタグ付け・メンションとして表示されている他アカウントのユーザーネーム。@は付けない。文字として見えるものだけ。なければ空配列。"
        }
      },
      required: ["postedAgo", "summary", "visibleText", "mentions"]
    },
    uncertainty: {
      type: "string",
      description: "特定にあたり人が確認すべき注意点。ユーザーネームが読み取れない・表示名しか分からない・別人の可能性があるなどの場合に日本語で書く。問題なければ空文字。"
    }
  },
  required: ["isInstagramStory", "account", "story", "uncertainty"]
};

const SYSTEM_PROMPT = [
  "あなたはInstagramのストーリーのスクリーンショットを見て、その投稿主のアカウントを特定するアシスタントです。",
  "特定は画面に文字として写っている情報だけを根拠にします。ユーザーネーム（@ハンドル）は画面上部などに表示された文字をそのまま読み取ります。",
  "読み取れない文字を推測で補完したり、プロフィール画像や表示名から実在しそうなユーザーネームを創作したりしてはいけません。読み取れないときはusernameを空文字にし、confidenceを低くします。",
  "表示名（本名・ニックネーム）とユーザーネーム（@ハンドル）は別物として扱います。",
  "顔や容姿から個人を推定することはしません。あくまで画面に表示されたアカウント情報の読み取りに徹します。",
  "日本語で、事実に忠実に、断定できないことは断定しないで回答します。"
].join("\n");

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

  const { image } = req.body;
  const content = [
    {
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data }
    },
    {
      type: "text",
      text: "このInstagramストーリーのスクリーンショットから、投稿主のアカウントを特定してください。画面に表示された文字だけを根拠にし、読み取れないユーザーネームは創作しないでください。"
    }
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
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
        output_config: {
          format: {
            type: "json_schema",
            schema: identifySchema
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
      return res.status(502).json({ error: "解析が途中で切れました。もう一度お試しください" });
    }

    const textBlock = data.content?.find((block) => block.type === "text");
    if (!textBlock?.text) {
      return res.status(502).json({ error: "AIから回答を受け取れませんでした" });
    }

    const result = JSON.parse(textBlock.text);
    return res.status(200).json(normalizeResult(result));
  } catch (error) {
    console.error("identify failed", error);
    return res.status(500).json({ error: "通信に失敗しました。少し待って再度お試しください" });
  }
};

function validateBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "入力がありません" };
  const image = body.image;
  if (!image || typeof image !== "object") return { ok: false, error: "スクリーンショットを選んでください" };
  if (image.mediaType !== "image/jpeg" || typeof image.data !== "string") return { ok: false, error: "対応していない画像形式です" };
  if (image.data.length < 100 || image.data.length > MAX_IMAGE_BASE64) return { ok: false, error: "画像サイズが大きすぎます" };
  if (!/^[A-Za-z0-9+/]+=*$/.test(image.data)) return { ok: false, error: "画像データが不正です" };
  return { ok: true };
}

function normalizeResult(result) {
  const account = result.account || {};
  const rawUsername = String(account.username || "").trim().replace(/^@+/, "").toLowerCase();
  const username = USERNAME_RE.test(rawUsername) ? rawUsername : "";

  const story = result.story || {};
  const mentions = uniqueUsernames(story.mentions).map((name) => ({
    username: name,
    profileUrl: profileUrl(name)
  }));

  return {
    isInstagramStory: Boolean(result.isInstagramStory),
    account: {
      username,
      displayName: String(account.displayName || "").trim(),
      verified: Boolean(account.verified),
      confidence: clamp(Number(account.confidence) || 0, 0, 100),
      readFrom: String(account.readFrom || "").trim(),
      profileUrl: username ? profileUrl(username) : ""
    },
    story: {
      postedAgo: String(story.postedAgo || "").trim(),
      summary: String(story.summary || "").trim(),
      visibleText: cleanList(story.visibleText, 12),
      mentions
    },
    uncertainty: String(result.uncertainty || "").trim()
  };
}

function uniqueUsernames(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw || "").trim().replace(/^@+/, "").toLowerCase();
    if (USERNAME_RE.test(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out.slice(0, 10);
}

function cleanList(list, max) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const value = String(raw || "").trim();
    if (value) out.push(value.slice(0, 120));
    if (out.length >= max) break;
  }
  return out;
}

function profileUrl(username) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
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
  if (status === 413) return "画像のデータ量が大きすぎます";
  if (status === 429) return "APIが混み合っています。少し待ってください";
  return "AIサービスが一時的に利用できません";
}
