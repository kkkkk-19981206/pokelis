"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  photos: [],
  previewThumb: "",
  result: null,
  platform: "mercari",
  controller: null,
  activeScreen: "create"
};

const STORAGE = {
  pin: "pokelis_app_pin",
  drafts: "pokelis_drafts_v1"
};

const elements = {
  cameraInput: $("#camera-input"),
  libraryInput: $("#library-input"),
  emptyCamera: $("#empty-camera"),
  photoEditor: $("#photo-editor"),
  photoGrid: $("#photo-grid"),
  photoCount: $("#photo-count"),
  generate: $("#generate"),
  loading: $("#loading"),
  resultFields: $("#result-fields"),
  appPin: $("#app-pin"),
  toast: $("#toast")
};

function init() {
  bindNavigation();
  bindPhotoInputs();
  bindForm();
  bindResult();
  bindSettings();
  elements.appPin.value = localStorage.getItem(STORAGE.pin) || "";
  renderDrafts();
  registerServiceWorker();
}

function bindNavigation() {
  $$("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => showScreen(button.dataset.nav));
  });
}

function showScreen(name) {
  state.activeScreen = name;
  $$(".screen").forEach((screen) => screen.classList.toggle("is-active", screen.id === `screen-${name}`));
  $$(".bottom-nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.nav === name));
  if (name === "drafts") renderDrafts();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindPhotoInputs() {
  $("#take-photo").addEventListener("click", () => elements.cameraInput.click());
  $("#choose-photo").addEventListener("click", () => elements.libraryInput.click());
  $("#add-photo").addEventListener("click", () => elements.libraryInput.click());
  elements.cameraInput.addEventListener("change", (event) => addPhotos(event.target.files));
  elements.libraryInput.addEventListener("change", (event) => addPhotos(event.target.files));
}

async function addPhotos(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  const slots = Math.max(0, 6 - state.photos.length);
  if (!slots) return toast("写真は6枚までです");

  const selected = files.slice(0, slots);
  if (files.length > slots) toast(`写真は6枚まで。先頭の${slots}枚を追加しました`);

  try {
    const processed = await Promise.all(selected.map(compressImage));
    state.photos.push(...processed);
    renderPhotos();
  } catch (error) {
    console.error(error);
    toast("読み込めない写真がありました");
  } finally {
    elements.cameraInput.value = "";
    elements.libraryInput.value = "";
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", .78);
        const thumbScale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
        const thumbCanvas = document.createElement("canvas");
        thumbCanvas.width = Math.max(1, Math.round(image.naturalWidth * thumbScale));
        thumbCanvas.height = Math.max(1, Math.round(image.naturalHeight * thumbScale));
        thumbCanvas.getContext("2d", { alpha: false }).drawImage(image, 0, 0, thumbCanvas.width, thumbCanvas.height);
        resolve({
          id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          dataUrl,
          thumbDataUrl: thumbCanvas.toDataURL("image/jpeg", .72),
          mediaType: "image/jpeg",
          data: dataUrl.split(",")[1]
        });
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotos() {
  const hasPhotos = state.photos.length > 0;
  elements.emptyCamera.hidden = hasPhotos;
  elements.photoEditor.hidden = !hasPhotos;
  elements.photoCount.textContent = String(state.photos.length);
  elements.generate.disabled = !hasPhotos;
  elements.photoGrid.innerHTML = "";

  state.photos.forEach((photo, index) => {
    const tile = document.createElement("div");
    tile.className = "photo-tile";
    tile.innerHTML = `
      <img src="${photo.dataUrl}" alt="商品写真 ${index + 1}">
      ${index === 0 ? '<span class="main-label">メイン</span>' : ""}
      <button class="remove-photo" type="button" aria-label="写真を削除">×</button>
    `;
    tile.querySelector("img").addEventListener("click", () => {
      if (index === 0) return;
      const [chosen] = state.photos.splice(index, 1);
      state.photos.unshift(chosen);
      renderPhotos();
    });
    tile.querySelector(".remove-photo").addEventListener("click", (event) => {
      event.stopPropagation();
      state.photos.splice(index, 1);
      renderPhotos();
    });
    elements.photoGrid.appendChild(tile);
  });
}

function bindForm() {
  $("#price").addEventListener("input", (event) => {
    const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
    event.target.value = digits ? Number(digits).toLocaleString("ja-JP") : "";
  });

  $$(".quick-hints button").forEach((button) => {
    button.addEventListener("click", () => {
      const memo = $("#memo");
      const separator = memo.value && !memo.value.endsWith("\n") ? "\n" : "";
      memo.value += separator + button.dataset.hint;
      memo.focus();
      memo.setSelectionRange(memo.value.length, memo.value.length);
    });
  });

  elements.generate.addEventListener("click", generateListing);
  $("#cancel-generate").addEventListener("click", () => state.controller?.abort());
}

async function generateListing() {
  const pin = localStorage.getItem(STORAGE.pin) || "";
  if (!pin) {
    showScreen("settings");
    elements.appPin.focus();
    return toast("先にアプリPINを設定してください");
  }

  state.controller = new AbortController();
  setLoading(true);

  const price = $("#price").value.replace(/\D/g, "");
  const payload = {
    condition: $("#condition").value,
    desiredPrice: price ? Number(price) : null,
    shipping: $("#shipping").value,
    memo: $("#memo").value.trim(),
    images: state.photos.map(({ mediaType, data }) => ({ mediaType, data }))
  };

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-pin": pin
      },
      body: JSON.stringify(payload),
      signal: state.controller.signal
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error("PINが違います。設定画面で確認してください");
      if (response.status === 429) throw new Error("少し使いすぎたようです。1分ほど待ってください");
      throw new Error(body.error || "出品案を作れませんでした");
    }

    state.result = body;
    state.previewThumb = state.photos[0]?.thumbDataUrl || state.photos[0]?.dataUrl || "";
    state.platform = "mercari";
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

function bindResult() {
  $("#back-to-create").addEventListener("click", () => showScreen("create"));
  $("#new-listing").addEventListener("click", resetListing);
  $("#save-draft").addEventListener("click", saveDraft);
  $("#share-result").addEventListener("click", shareResult);
  $$(".platform-switch button").forEach((button) => {
    button.addEventListener("click", () => {
      state.platform = button.dataset.platform;
      renderResultFields();
    });
  });
}

function renderResult() {
  if (!state.result) return;
  const analysis = state.result.analysis;
  $("#identified-item").textContent = analysis.itemName;
  $("#observation").textContent = analysis.observation;
  $("#confidence").textContent = `読み取り精度 ${analysis.confidence}%`;
  $("#result-thumb").innerHTML = state.previewThumb
    ? `<img src="${state.previewThumb}" alt="商品のメイン写真">`
    : "";
  renderResultFields();
}

function renderResultFields() {
  const listing = state.result?.[state.platform];
  if (!listing) return;
  $$(".platform-switch button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.platform === state.platform);
  });
  elements.resultFields.innerHTML = "";

  addEditableField("商品名", "title", listing.title, 40);
  addEditableField("商品説明", "description", listing.description);
  addEditableField("カテゴリ候補", "category", listing.category);
  addEditableField("ブランド", "brand", listing.brand);
  addEditableField("サイズ・規格", "size", listing.size);

  const priceCard = document.createElement("article");
  priceCard.className = "result-card";
  priceCard.innerHTML = `
    <div class="result-card-head"><label>価格の目安</label></div>
    <div class="price-box">
      <div><small>おすすめ</small><b>${yen(listing.suggestedPrice)}</b></div>
      <div><small>目安の幅</small><b>${yen(listing.priceLow)}〜${yen(listing.priceHigh)}</b></div>
    </div>
  `;
  elements.resultFields.appendChild(priceCard);

  addEditableField("検索キーワード", "keywords", listing.keywords.join("・"));

  if (state.result.analysis.uncertainty) {
    const note = document.createElement("p");
    note.className = "uncertain-note";
    note.textContent = `確認ポイント：${state.result.analysis.uncertainty}`;
    elements.resultFields.appendChild(note);
  }
}

function addEditableField(label, field, value, limit = null) {
  const fragment = $("#field-template").content.cloneNode(true);
  const card = $(".result-card", fragment);
  const textarea = $("textarea", fragment);
  const count = $(".char-count", fragment);
  const copy = $(".copy-button", fragment);
  card.dataset.field = field;
  $("label", fragment).textContent = label;
  textarea.value = value || "";
  textarea.rows = field === "description" ? 10 : Math.max(2, Math.ceil((value || "").length / 28));

  const refreshCount = () => {
    count.textContent = limit ? `${textarea.value.length}/${limit}文字` : `${textarea.value.length}文字`;
    count.style.color = limit && textarea.value.length > limit ? "#c64b3a" : "";
  };
  refreshCount();

  textarea.addEventListener("input", () => {
    const listing = state.result[state.platform];
    listing[field] = field === "keywords"
      ? textarea.value.split(/[・,\s]+/).filter(Boolean)
      : textarea.value;
    refreshCount();
  });

  copy.addEventListener("click", async () => {
    await copyText(textarea.value);
    copy.textContent = "コピー済み";
    copy.classList.add("is-done");
    setTimeout(() => {
      copy.textContent = "コピー";
      copy.classList.remove("is-done");
    }, 1400);
  });
  elements.resultFields.appendChild(fragment);
}

function saveDraft() {
  if (!state.result) return;
  const drafts = getDrafts();
  const id = state.result.id || `${Date.now()}`;
  state.result.id = id;
  const thumb = state.previewThumb;
  const existing = drafts.findIndex((draft) => draft.id === id);
  const draft = { id, savedAt: new Date().toISOString(), result: state.result, thumb };
  if (existing >= 0) drafts.splice(existing, 1, draft);
  else drafts.unshift(draft);
  localStorage.setItem(STORAGE.drafts, JSON.stringify(drafts.slice(0, 30)));
  toast("下書きに保存しました");
}

function getDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE.drafts) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function renderDrafts() {
  const drafts = getDrafts();
  $("#draft-empty").hidden = drafts.length > 0;
  const list = $("#draft-list");
  list.innerHTML = "";
  drafts.forEach((draft) => {
    const item = document.createElement("article");
    item.className = "draft-item";
    const title = draft.result?.mercari?.title || "名称未設定";
    const date = new Date(draft.savedAt).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    item.innerHTML = `
      <div class="draft-image">${draft.thumb ? `<img src="${draft.thumb}" alt="">` : ""}</div>
      <div><h2>${escapeHtml(title)}</h2><p>${date} · ${yen(draft.result?.mercari?.suggestedPrice || 0)}</p></div>
      <button class="delete-draft" type="button" aria-label="下書きを削除">×</button>
      <button class="open-draft" type="button" aria-label="${escapeHtml(title)}を開く"></button>
    `;
    $(".open-draft", item).addEventListener("click", () => {
      state.result = draft.result;
      state.photos = [];
      state.previewThumb = draft.thumb || "";
      state.platform = "mercari";
      renderResult();
      showScreen("result");
    });
    $(".delete-draft", item).addEventListener("click", () => {
      const next = getDrafts().filter((entry) => entry.id !== draft.id);
      localStorage.setItem(STORAGE.drafts, JSON.stringify(next));
      renderDrafts();
      toast("下書きを削除しました");
    });
    list.appendChild(item);
  });
}

function resetListing() {
  state.photos = [];
  state.previewThumb = "";
  state.result = null;
  $("#memo").value = "";
  $("#price").value = "";
  renderPhotos();
  showScreen("create");
}

async function shareResult() {
  if (!state.result) return;
  const listing = state.result[state.platform];
  const text = `${listing.title}\n\n${listing.description}\n\n価格：${yen(listing.suggestedPrice)}\nカテゴリ：${listing.category}\n検索：${listing.keywords.join(" ")}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: listing.title, text });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await copyText(text);
  toast("出品内容をまとめてコピーしました");
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
    if (state.photos.length) showScreen("create");
  });
  $("#clear-data").addEventListener("click", () => {
    if (!confirm("下書きと設定をすべて削除しますか？")) return;
    localStorage.removeItem(STORAGE.pin);
    localStorage.removeItem(STORAGE.drafts);
    elements.appPin.value = "";
    renderDrafts();
    toast("端末内データを削除しました");
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

function yen(number) {
  return `${Number(number || 0).toLocaleString("ja-JP")}円`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/service-worker.js").catch(console.warn);
  }
}

init();
