"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  shot: null,
  result: null,
  controller: null
};

const STORAGE = {
  pin: "pokelis_app_pin" // ポケリスと同じPINを共用
};

const elements = {
  cameraInput: $("#shot-camera"),
  libraryInput: $("#shot-library"),
  emptyShot: $("#empty-shot"),
  shotPreview: $("#shot-preview"),
  shotImage: $("#shot-image"),
  identify: $("#identify"),
  loading: $("#loading"),
  resultBody: $("#result-body"),
  appPin: $("#app-pin"),
  toast: $("#toast")
};

function init() {
  bindNavigation();
  bindInputs();
  bindActions();
  bindSettings();
  elements.appPin.value = localStorage.getItem(STORAGE.pin) || "";
}

function bindNavigation() {
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.nav));
  });
}

function showScreen(name) {
  $$(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.id === `screen-${name}`));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.nav === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindInputs() {
  $("#take-shot").addEventListener("click", () => elements.cameraInput.click());
  $("#choose-shot").addEventListener("click", () => elements.libraryInput.click());
  $("#remove-shot").addEventListener("click", clearShot);
  elements.cameraInput.addEventListener("change", (event) => loadShot(event.target.files));
  elements.libraryInput.addEventListener("change", (event) => loadShot(event.target.files));
}

async function loadShot(fileList) {
  const file = [...fileList].find((item) => item.type.startsWith("image/"));
  if (!file) return;
  try {
    state.shot = await compressImage(file);
    renderShot();
  } catch (error) {
    console.error(error);
    toast("読み込めない画像でした");
  } finally {
    elements.cameraInput.value = "";
    elements.libraryInput.value = "";
  }
}

// テキストを読み取るため、写真より高めの解像度・画質で圧縮する
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSide = 1480;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        resolve({
          dataUrl,
          mediaType: "image/jpeg",
          data: dataUrl.split(",")[1]
        });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function renderShot() {
  const has = Boolean(state.shot);
  elements.emptyShot.hidden = has;
  elements.shotPreview.hidden = !has;
  elements.identify.disabled = !has;
  if (has) elements.shotImage.src = state.shot.dataUrl;
}

function clearShot() {
  state.shot = null;
  renderShot();
}

function bindActions() {
  elements.identify.addEventListener("click", identifyAccount);
  $("#cancel-identify").addEventListener("click", () => state.controller?.abort());
  $("#back-to-upload").addEventListener("click", () => showScreen("upload"));
  $("#new-shot").addEventListener("click", () => {
    clearShot();
    showScreen("upload");
  });
}

async function identifyAccount() {
  if (!state.shot) return;
  const pin = localStorage.getItem(STORAGE.pin) || "";
  if (!pin) {
    showScreen("settings");
    elements.appPin.focus();
    return toast("先にアプリPINを設定してください");
  }

  state.controller = new AbortController();
  setLoading(true);

  try {
    const response = await fetch("/api/identify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-pin": pin
      },
      body: JSON.stringify({
        image: { mediaType: state.shot.mediaType, data: state.shot.data }
      }),
      signal: state.controller.signal
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("PINが違います。設定画面で確認してください");
      if (response.status === 429) throw new Error("少し使いすぎたようです。1分ほど待ってください");
      throw new Error(body.error || "アカウントを特定できませんでした");
    }

    state.result = body;
    renderResult();
    showScreen("result");
  } catch (error) {
    if (error.name !== "AbortError") toast(error.message, 4200);
  } finally {
    setLoading(false);
    state.controller = null;
  }
}

function setLoading(active) {
  elements.loading.hidden = !active;
  document.body.style.overflow = active ? "hidden" : "";
}

function renderResult() {
  const result = state.result;
  const body = elements.resultBody;
  body.innerHTML = "";
  if (!result) return;

  if (!result.isInstagramStory) {
    body.appendChild(notFoundCard(
      "🤔",
      "ストーリーではなさそうです",
      "Instagramのストーリー画面のスクリーンショットを選んでください。ユーザー名が画面の上に写っていると特定しやすくなります。"
    ));
    appendStoryContext(body);
    return;
  }

  const account = result.account;
  if (account.username) {
    body.appendChild(accountCard(account));
  } else {
    body.appendChild(notFoundCard(
      "🔍",
      "ユーザー名を読み取れませんでした",
      "画面にユーザー名（@ではじまる文字）がはっきり写っていないようです。ストーリー左上のユーザー名が入るように撮り直すと特定できることがあります。"
    ));
  }

  if (result.uncertainty) {
    const note = document.createElement("p");
    note.className = "uncertain-note";
    note.textContent = `確認ポイント：${result.uncertainty}`;
    body.appendChild(note);
  }

  appendStoryContext(body);
}

function accountCard(account) {
  const card = document.createElement("article");
  card.className = "account-card";

  const verified = account.verified
    ? '<svg class="verified-badge" viewBox="0 0 24 24" aria-label="認証済み"><path fill="#fff" d="M12 1.6l2.5 2.1 3.3-.3 1 3.1 3 1.4-1.2 3.1 1.2 3.1-3 1.4-1 3.1-3.3-.3L12 22.4l-2.5-2.1-3.3.3-1-3.1-3-1.4 1.2-3.1L2.2 9.9l3-1.4 1-3.1 3.3.3z"/><path fill="#dc2743" d="M10.6 14.6l-2-2-1.2 1.2 3.2 3.2 5.6-5.6-1.2-1.2z"/></svg>'
    : "";

  const name = account.displayName
    ? `<p class="account-name">${escapeHtml(account.displayName)}</p>`
    : `<p class="account-name empty">表示名は読み取れませんでした</p>`;

  const readFrom = account.readFrom
    ? `<p class="read-from">${escapeHtml(account.readFrom)}</p>`
    : "";

  card.innerHTML = `
    <div class="account-top">
      <span class="account-handle">@${escapeHtml(account.username)}</span>
      ${verified}
    </div>
    ${name}
    <div class="conf-row">
      <span>特定の確信度</span>
      <span class="conf-track"><span class="conf-fill" style="width:${account.confidence}%"></span></span>
      <span>${account.confidence}%</span>
    </div>
    ${readFrom}
    <div class="account-actions">
      <a class="open-insta" href="${escapeAttr(account.profileUrl)}" target="_blank" rel="noopener noreferrer">
        Instagramで開く →
      </a>
      <button class="copy-handle" type="button">コピー</button>
    </div>
  `;

  $(".copy-handle", card).addEventListener("click", async (event) => {
    await copyText(`@${account.username}`);
    const btn = event.currentTarget;
    btn.textContent = "コピー済み";
    btn.classList.add("is-done");
    setTimeout(() => {
      btn.textContent = "コピー";
      btn.classList.remove("is-done");
    }, 1400);
  });

  return card;
}

function notFoundCard(emoji, title, message) {
  const card = document.createElement("article");
  card.className = "card not-found-card";
  card.innerHTML = `
    <div class="emoji" aria-hidden="true">${emoji}</div>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  `;
  return card;
}

function appendStoryContext(body) {
  const story = state.result?.story;
  if (!story) return;
  const hasContext = story.summary || story.postedAgo || (story.mentions && story.mentions.length) || (story.visibleText && story.visibleText.length);
  if (!hasContext) return;

  const card = document.createElement("article");
  card.className = "card story-card";
  card.innerHTML = `<span class="block-label">STORY</span><h3>ストーリーの内容</h3>`;

  const summary = document.createElement("p");
  summary.textContent = story.summary || "内容の説明は読み取れませんでした。";
  card.appendChild(summary);

  if (story.postedAgo) {
    const posted = document.createElement("div");
    posted.className = "info-chip-row";
    posted.innerHTML = `<span class="info-chip">🕒 ${escapeHtml(story.postedAgo)}</span>`;
    card.appendChild(posted);
  }

  if (story.mentions && story.mentions.length) {
    const block = document.createElement("div");
    block.className = "block";
    block.innerHTML = `<span class="block-label">MENTIONS</span>`;
    const row = document.createElement("div");
    row.className = "info-chip-row";
    story.mentions.forEach((mention) => {
      const link = document.createElement("a");
      link.className = "mention-link";
      link.href = mention.profileUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `@${mention.username}`;
      row.appendChild(link);
    });
    block.appendChild(row);
    card.appendChild(block);
  }

  if (story.visibleText && story.visibleText.length) {
    const block = document.createElement("div");
    block.className = "block";
    block.innerHTML = `<span class="block-label">見えるテキスト</span>`;
    const row = document.createElement("div");
    row.className = "info-chip-row";
    story.visibleText.forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "info-chip";
      chip.textContent = text;
      row.appendChild(chip);
    });
    block.appendChild(row);
    card.appendChild(block);
  }

  body.appendChild(card);
}

function bindSettings() {
  $("#toggle-pin").addEventListener("click", () => {
    const hidden = elements.appPin.type === "password";
    elements.appPin.type = hidden ? "text" : "password";
    $("#toggle-pin").textContent = hidden ? "隠す" : "表示";
  });
  $("#save-pin").addEventListener("click", () => {
    const pin = elements.appPin.value.trim();
    if (pin.length < 8) return toast("PINは8文字以上にしてください");
    localStorage.setItem(STORAGE.pin, pin);
    toast("PINを保存しました");
    if (state.shot) showScreen("upload");
  });
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  return Promise.resolve();
}

let toastTimer;
function toast(message, duration = 2400) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

init();
