const el = id => document.getElementById(id);
const storage = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
};
const themeButtons = [...document.querySelectorAll(".theme-toggle")];
function setTheme(theme, persist=false) {
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=theme==="dark" ? "#080b14" : "#f4f0ff";
  themeButtons.forEach(button => {
    const next=theme==="dark" ? "light" : "dark";
    button.querySelector(".theme-glyph").textContent=theme==="dark" ? "☀" : "☾";
    button.querySelector(".theme-label").textContent=next[0].toUpperCase()+next.slice(1)+" mode";
    button.setAttribute("aria-label","Switch to "+next+" mode");
  });
  if (persist) try { localStorage.setItem("chatter_theme",theme); } catch {}
}
setTheme(document.documentElement.dataset.theme || "dark");
themeButtons.forEach(button => button.addEventListener("click",() => {
  setTheme(document.documentElement.dataset.theme==="dark" ? "light" : "dark",true);
}));
function makeId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
let clientId = storage.get("group_client_id");
if (!/^[0-9a-f-]{36}$/i.test(clientId || "")) clientId = makeId();
storage.set("group_client_id", clientId);
try { localStorage.removeItem("chat_token"); } catch {}
el("display-name").value = storage.get("group_name") || "";
const AVATARS = ["gigachad", "jonah-hill", "roll-safe", "patrick", "handsome-squidward", "sad-frog", "facepalm", "doge"];
const AVATAR_FILES = {
  gigachad: "gigachad.webp", "jonah-hill": "jonah-hill.jpg", "roll-safe": "roll-safe.jpg",
  patrick: "patrick.png", "handsome-squidward": "handsome-squidward.png",
  "sad-frog": "sad-frog.png", facepalm: "facepalm.png", doge: "doge.png",
  orbit: "orbit.svg", bloom: "bloom.svg", pixel: "pixel.svg", comet: "comet.svg",
  sunny: "sunny.svg", wave: "wave.svg", sage: "sage.svg", luna: "luna.svg"
};
const avatarLabel = id => id.split("-").map(part => part[0].toUpperCase() + part.slice(1)).join(" ");
const savedAvatar = storage.get("group_avatar");
let chosenAvatar = AVATARS.includes(savedAvatar) ? savedAvatar : "gigachad";
function avatarNode(id, name = "") {
  const wrapper = document.createElement("span"); wrapper.className = "avatar";
  const img = document.createElement("img");
  img.src = "/static/avatars/" + (AVATAR_FILES[id] || AVATAR_FILES.orbit);
  img.alt = name ? name + "'s avatar" : ""; img.width = 80; img.height = 80;
  wrapper.append(img); return wrapper;
}
function showAvatar(target, avatar) {
  el(target).replaceChildren(avatarNode(avatar).firstChild);
}
function previewProfile() {
  showAvatar("preview-avatar",chosenAvatar);
  el("preview-name").textContent = el("display-name").value.trim() || "The mystery guest";
  el("avatar-name").textContent = avatarLabel(chosenAvatar);
  el("avatar-picker").querySelectorAll("button").forEach(button => {
    button.setAttribute("aria-pressed",String(button.dataset.avatar === chosenAvatar));
  });
}
AVATARS.forEach(id => {
  const button = document.createElement("button");
  button.type = "button"; button.className = "avatar-option"; button.dataset.avatar = id;
  button.setAttribute("aria-label", "Choose " + avatarLabel(id) + " avatar");
  button.title = avatarLabel(id);
  button.append(avatarNode(id).firstChild);
  button.addEventListener("click", () => { chosenAvatar=id; storage.set("group_avatar",id); previewProfile(); });
  el("avatar-picker").append(button);
});
let fireResetTimer = null;
function setFireScene(scene) {
  el("fire-loader").dataset.fireState = scene;
}
function strikeFire() {
  clearTimeout(fireResetTimer);
  if (!el("display-name").value.trim()) {
    setFireScene("idle");
    return;
  }
  setFireScene("strike");
  fireResetTimer = setTimeout(() => {
    if (!state.joined) setFireScene("idle");
  }, 320);
}
el("display-name").addEventListener("input", () => {
  previewProfile();
  strikeFire();
});
previewProfile();
function resizeComposer() {
  const input=el("message-input");
  input.style.height="auto";
  input.style.height=Math.min(input.scrollHeight,130)+"px";
  el("character-count").textContent=input.value.length.toLocaleString()+" / 2,000";
  updateSendState();
}
el("message-input").addEventListener("input",resizeComposer);
const state = { name: "", socket: null, joined: false, ready: false, timer: null,
  retry: 0, messages: new Map(), hasMore: false, pending: null, pendingTimer: null,
  historyVersion: 0, image: null, uploading: false };

function updateSendState() {
  const hasContent=!!el("message-input").value.trim() || !!state.image;
  const blocked=!state.ready || !!state.pending || state.uploading;
  el("send-button").disabled=blocked || !hasContent;
  el("image-button").disabled=blocked;
}

function ready(value, label) {
  state.ready = value;
  el("connection-status").textContent = label;
  el("status-dot").classList.toggle("offline",!value);
  el("status-dot").parentElement.setAttribute("aria-label",label);
  updateSendState();
  el("join-button").disabled = state.joined && !value;
  if (!value) el("online-count").textContent = "";
}
function clearPending() {
  clearTimeout(state.pendingTimer);
  state.pending = null;
  state.uploading = false;
  el("send-label").textContent = "Send";
  updateSendState();
}
function roomError(message) { el("room-error").textContent = message; }

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[),.!?;:\]}]+$/;

function cleanUrlCandidate(value) {
  return value.replace(TRAILING_URL_PUNCTUATION, "");
}

function videoDetails(value) {
  let url;
  try { url = new URL(cleanUrlCandidate(value)); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] || "";
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1] || "";
    }
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return {
      kind: "embed", provider: "YouTube", title: "YouTube video",
      source: url.href, player: `https://www.youtube-nocookie.com/embed/${videoId}`,
    };
  }

  if (host === "drive.google.com") {
    const pathMatch = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/);
    const driveId = pathMatch?.[1] || url.searchParams.get("id") || "";
    if (/^[A-Za-z0-9_-]{10,}$/.test(driveId)) {
      const resourceKey = url.searchParams.get("resourcekey");
      return {
        kind: "embed", provider: "Google Drive", title: "Google Drive video",
        source: url.href, player: `https://drive.google.com/file/d/${driveId}/preview${resourceKey ? `?resourcekey=${encodeURIComponent(resourceKey)}` : ""}`,
      };
    }
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const vimeoId = [...parts].reverse().find(part => /^\d+$/.test(part));
    if (vimeoId) {
      return {
        kind: "embed", provider: "Vimeo", title: "Vimeo video",
        source: url.href, player: `https://player.vimeo.com/video/${vimeoId}`,
      };
    }
  }

  if (host === "instagram.com") {
    const instagramMatch = url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (instagramMatch) {
      return {
        kind: "embed", provider: "Instagram", title: "Instagram post or Reel",
        source: url.href, player: `https://www.instagram.com/p/${instagramMatch[1]}/embed/`, vertical: true,
      };
    }
  }

  if (["tiktok.com", "m.tiktok.com"].includes(host)) {
    const tiktokMatch = url.pathname.match(/\/video\/(\d{10,24})/);
    if (tiktokMatch) {
      return {
        kind: "embed", provider: "TikTok", title: "TikTok video",
        source: url.href, player: `https://www.tiktok.com/player/v1/${tiktokMatch[1]}?autoplay=0`, vertical: true,
      };
    }
  }

  if (["dailymotion.com", "dai.ly"].includes(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const dailymotionId = host === "dai.ly" ? parts[0] : (parts[0] === "video" ? parts[1] : "");
    if (/^[A-Za-z0-9]+$/.test(dailymotionId || "")) {
      return {
        kind: "embed", provider: "Dailymotion", title: "Dailymotion video",
        source: url.href, player: `https://geo.dailymotion.com/player.html?video=${dailymotionId}`,
      };
    }
  }

  if (host === "streamable.com") {
    const streamableId = url.pathname.split("/").filter(Boolean).pop() || "";
    if (/^[A-Za-z0-9]+$/.test(streamableId)) {
      return {
        kind: "embed", provider: "Streamable", title: "Streamable video",
        source: url.href, player: `https://streamable.com/e/${streamableId}`,
      };
    }
  }

  if (/\.(mp4|webm|ogg|ogv)$/i.test(url.pathname)) {
    return {kind: "direct", provider: "Video", title: "Shared video", source: url.href, player: url.href};
  }
  return null;
}

function firstVideoIn(text) {
  return [...text.matchAll(URL_PATTERN)].map(match => videoDetails(match[0])).find(Boolean) || null;
}

function firstUrlIn(text) {
  const match = text.match(URL_PATTERN)?.[0];
  if (!match) return null;
  try {
    const url = new URL(cleanUrlCandidate(match));
    return ['http:', 'https:'].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function appendLinkedText(container, text) {
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = cleanUrlCandidate(match[0]);
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const link = document.createElement("a");
    link.className = "message-link"; link.href = candidate; link.textContent = candidate;
    link.target = "_blank"; link.rel = "noopener noreferrer nofollow";
    container.append(link);
    cursor = match.index + candidate.length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function videoNode(details) {
  const card = document.createElement("div"); card.className = "video-card";
  if (details.vertical) card.classList.add("is-vertical");
  const frame = document.createElement("div"); frame.className = "video-player-wrap";
  if (details.kind === "embed") {
    const player = document.createElement("iframe");
    player.src = details.player; player.title = details.title; player.loading = "lazy";
    player.allow = "fullscreen; picture-in-picture; encrypted-media";
    player.referrerPolicy = "strict-origin-when-cross-origin"; player.allowFullscreen = true;
    frame.append(player);
  } else {
    const player = document.createElement("video");
    player.src = details.player; player.controls = true; player.preload = "metadata";
    player.playsInline = true; player.setAttribute("controlslist", "nodownload");
    frame.append(player);
  }
  const source = document.createElement("a");
  source.className = "video-source-link"; source.href = details.source;
  source.target = "_blank"; source.rel = "noopener noreferrer nofollow";
  source.textContent = `${details.provider} · Open original`;
  card.append(frame, source); return card;
}

function linkFallbackNode(url) {
  const link = document.createElement("a"); link.className = "link-fallback";
  link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer nofollow";
  const host = document.createElement("strong"); host.textContent = url.hostname.replace(/^www\./, "");
  const note = document.createElement("span"); note.textContent = "Preview unavailable · Open link ↗";
  link.append(host, note); return link;
}

function messageNode(message) {
  const mine = message.client_id === clientId;
  const item = document.createElement("article"); item.className = "message" + (mine ? " mine" : "");
  const content = document.createElement("div"); content.className = "message-content";
  const meta = document.createElement("div"); meta.className = "message-meta";
  const name = document.createElement("strong"); name.textContent = message.name + (mine ? " · you" : "");
  const time = document.createElement("time"), date = new Date(message.created_at);
  time.dateTime = message.created_at; time.title = date.toLocaleString();
  time.textContent = date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const body = document.createElement("div"); body.className = "bubble";
  if (message.image_url) {
    body.classList.add("image-bubble");
    const link=document.createElement("a"); link.href=message.image_url;
    link.target="_blank"; link.rel="noopener"; link.title="Open full-size image";
    const image=document.createElement("img"); image.src=message.image_url;
    image.alt="Image shared by "+message.name; image.loading="lazy"; image.decoding="async";
    link.append(image); body.append(link);
  }
  if (message.body) {
    const caption=document.createElement("div"); caption.className="message-caption";
    appendLinkedText(caption,message.body); body.append(caption);
    const video=firstVideoIn(message.body);
    if (video) { body.classList.add("video-bubble"); body.append(videoNode(video)); }
    else {
      const linkedUrl=firstUrlIn(message.body);
      if (linkedUrl) { body.classList.add("link-bubble"); body.append(linkFallbackNode(linkedUrl)); }
    }
  }
  meta.append(name,time); content.append(meta,body);
  item.append(avatarNode(message.avatar,message.name),content); return item;
}
function renderMessages() {
  const messages = [...state.messages.values()].sort((a,b) => a.id-b.id);
  const nodes=[]; let previousDay="";
  for (const message of messages) {
    const date=new Date(message.created_at), day=date.toLocaleDateString();
    if (day!==previousDay) {
      const divider=document.createElement("div"); divider.className="date-divider";
      const today=new Date(), yesterday=new Date(); yesterday.setDate(today.getDate()-1);
      divider.textContent=day===today.toLocaleDateString() ? "Today" :
        day===yesterday.toLocaleDateString() ? "Yesterday" :
        date.toLocaleDateString([], {month:"long",day:"numeric",year:"numeric"});
      nodes.push(divider); previousDay=day;
    }
    nodes.push(messageNode(message));
  }
  el("messages").replaceChildren(...nodes);
  el("empty-state").classList.toggle("hidden", !!messages.length);
  el("load-older").classList.toggle("hidden", !state.hasMore);
}
function bottom() {
  el("message-scroll").scrollTop = el("message-scroll").scrollHeight;
  el("new-messages").classList.add("hidden");
}
el("new-messages").addEventListener("click",bottom);
el("message-scroll").addEventListener("scroll", () => {
  const scroll=el("message-scroll");
  if (scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<70) el("new-messages").classList.add("hidden");
});
function connect() {
  if (!state.joined) return;
  clearTimeout(state.timer);
  ready(false, state.retry ? "Reconnecting…" : "Connecting…");
  const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  state.socket = socket;
  socket.addEventListener("open", () => {
    if (state.socket !== socket) return;
    socket.send(JSON.stringify({type:"join",name:state.name,client_id:clientId,avatar:chosenAvatar}));
  });
  socket.addEventListener("message", event => {
    if (state.socket !== socket) return;
    let payload; try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.type === "welcome") {
      state.retry = 0; state.name = payload.name; clientId = payload.client_id;
      chosenAvatar=payload.avatar || chosenAvatar;
      storage.set("group_avatar",chosenAvatar);
      storage.set("group_name",state.name); storage.set("group_client_id",clientId);
      state.historyVersion++;
      state.messages = new Map(payload.messages.map(m => [m.id,m]));
      state.hasMore = payload.has_more;
      el("join-view").classList.add("hidden"); el("room-view").classList.remove("hidden");
      el("current-name").textContent = state.name;
      el("sidebar-name").textContent = state.name;
      showAvatar("sidebar-avatar",chosenAvatar); showAvatar("composer-avatar",chosenAvatar);
      ready(true,"Live"); renderMessages(); bottom(); resizeComposer();
      if (matchMedia("(min-width: 761px)").matches) el("message-input").focus();
    } else if (payload.type === "presence") {
      el("online-count").textContent = payload.count + " online";
    } else if (payload.type === "message") {
      const message = payload.message;
      const scroll = el("message-scroll");
      const nearBottom = scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight < 100;
      state.messages.set(message.id,message);
      if (state.pending && message.client_id === clientId && message.body === state.pending.body &&
          (message.image_url || null) === state.pending.imageUrl) {
        if (el("message-input").value === state.pending.draft) el("message-input").value = "";
        clearSelectedImage();
        clearPending(); roomError(""); resizeComposer();
      }
      renderMessages();
      if (nearBottom || message.client_id === clientId) bottom();
      else el("new-messages").classList.remove("hidden");
    } else if (payload.type === "error") {
      if (!state.ready) {
        leave(); el("join-error").textContent = payload.message;
      } else { clearPending(); roomError(payload.message); }
    }
  });
  socket.addEventListener("close", event => {
    if (state.socket !== socket || !state.joined) return;
    if (state.pending) {
      clearPending(); roomError("Connection lost before confirmation. Your draft is kept; check the history before sending again.");
    }
    if (event.code === 1008) { leave(); el("join-error").textContent = "Please enter a valid name and join again."; return; }
    ready(false,"Reconnecting…");
    state.timer = setTimeout(connect, Math.min(1000 * 2 ** state.retry++,10000));
    if (!el("join-view").classList.contains("hidden")) {
      el("join-error").textContent = "Cannot connect yet. Retrying…";
      el("join-button").disabled = false;
    }
  });
}
function leave() {
  state.joined = false; state.historyVersion++;
  clearTimeout(state.timer); clearPending();
  const socket = state.socket; state.socket = null; socket?.close();
  ready(false,"Disconnected");
  el("join-button").disabled = false;
  el("room-view").classList.add("hidden"); el("join-view").classList.remove("hidden");
  el("display-name").value = state.name;
  previewProfile();
  el("join-error").textContent = ""; roomError("");
  clearTimeout(fireResetTimer); setFireScene("idle");
  clearSelectedImage();
  el("display-name").focus();
}
el("join-form").addEventListener("submit", event => {
  event.preventDefault();
  const name = el("display-name").value.trim().replace(/\s+/g," ");
  if (!name || name.length>40) { el("join-error").textContent = "Enter a name between 1 and 40 characters."; return; }
  if (state.socket) { const old=state.socket; state.socket=null; old.close(); }
  state.name=name; state.joined=true; state.retry=0;
  el("join-error").textContent=""; roomError("");
  el("join-button").disabled=true;
  clearTimeout(fireResetTimer);
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  setFireScene(reducedMotion ? "lit" : "ignite");
  if (reducedMotion) connect();
  else {
    fireResetTimer=setTimeout(() => setFireScene("lit"),650);
    setTimeout(connect,1200);
  }
});
el("leave-button").addEventListener("click",leave);
function clearSelectedImage() {
  if (state.image?.previewUrl) URL.revokeObjectURL(state.image.previewUrl);
  state.image=null;
  el("image-input").value="";
  el("image-preview").classList.add("hidden");
  el("image-preview-thumb").removeAttribute("src");
  el("image-preview-name").textContent="";
  updateSendState();
}
function showSelectedImage(file) {
  clearSelectedImage();
  const previewUrl=URL.createObjectURL(file);
  state.image={file,previewUrl,uploadedUrl:null};
  el("image-preview-thumb").src=previewUrl;
  el("image-preview-name").textContent=file.name;
  el("image-preview").classList.remove("hidden");
  roomError(""); updateSendState();
}
el("image-button").addEventListener("click",() => el("image-input").click());
el("remove-image").addEventListener("click",clearSelectedImage);
el("image-input").addEventListener("change",event => {
  const file=event.target.files?.[0];
  if (!file) return;
  const allowed=["image/png","image/jpeg","image/webp","image/gif"];
  if (!allowed.includes(file.type)) {
    roomError("Choose a PNG, JPEG, WebP, or GIF image."); el("image-input").value=""; return;
  }
  if (file.size>5*1024*1024) {
    roomError("Images must be 5 MB or smaller."); el("image-input").value=""; return;
  }
  showSelectedImage(file);
});
el("message-form").addEventListener("submit",async event => {
  event.preventDefault();
  const input=el("message-input"), body=input.value.trim();
  if ((!body && !state.image) || !state.ready || state.pending || state.uploading ||
      state.socket?.readyState!==WebSocket.OPEN) return;
  state.uploading=true; updateSendState(); roomError("");
  let imageUrl=state.image?.uploadedUrl || null;
  try {
    if (state.image && !imageUrl) {
      el("send-label").textContent="Uploading…";
      const response=await fetch("/api/uploads",{
        method:"POST", headers:{"Content-Type":state.image.file.type}, body:state.image.file,
      });
      if (!response.ok) {
        let detail="Image upload failed.";
        try { detail=(await response.json()).detail || detail; } catch {}
        throw new Error(detail);
      }
      imageUrl=(await response.json()).image_url;
      state.image.uploadedUrl=imageUrl;
    }
    state.uploading=false;
    state.pending={body,draft:input.value,imageUrl};
    el("send-label").textContent="Sending…"; updateSendState();
    state.socket.send(JSON.stringify({type:"message",body,image_url:imageUrl}));
  }
  catch (error) { clearPending(); roomError(error.message || "Message could not be sent. Your draft is kept."); return; }
  state.pendingTimer=setTimeout(() => {
    if (!state.pending) return;
    clearPending(); roomError("No confirmation received. Your draft is kept; check the history before retrying.");
  },10000);
});
el("message-input").addEventListener("keydown",event => {
  if (event.key==="Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); el("message-form").requestSubmit();
  }
});

const dvdMotion = { x: 30, y: 30, vx: 62, vy: 48, last: 0, color: 0 };
const dvdColors = ["#78fff1", "#d8ff4f", "#ff5fcf", "#9d7cff", "#ff9c46"];
const dvdReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
function animateDvd(time) {
  const saver=el("dvd-saver"), viewport=el("message-scroll");
  if (!dvdReducedMotion && !el("room-view").classList.contains("hidden") && viewport.clientWidth && viewport.clientHeight) {
    const dt=Math.min((time-dvdMotion.last)/1000,.04) || 0;
    const maxX=Math.max(0,viewport.clientWidth-saver.offsetWidth-18);
    const maxY=Math.max(0,viewport.clientHeight-saver.offsetHeight-18);
    dvdMotion.x+=dvdMotion.vx*dt; dvdMotion.y+=dvdMotion.vy*dt;
    let bounced=false;
    if (dvdMotion.x<=9 || dvdMotion.x>=maxX) { dvdMotion.vx*=-1; dvdMotion.x=Math.max(9,Math.min(maxX,dvdMotion.x)); bounced=true; }
    if (dvdMotion.y<=9 || dvdMotion.y>=maxY) { dvdMotion.vy*=-1; dvdMotion.y=Math.max(9,Math.min(maxY,dvdMotion.y)); bounced=true; }
    if (bounced) {
      dvdMotion.color=(dvdMotion.color+1)%dvdColors.length;
      saver.style.setProperty("--dvd-color",dvdColors[dvdMotion.color]);
    }
    saver.style.transform=`translate3d(${dvdMotion.x}px,${viewport.scrollTop+dvdMotion.y}px,0)`;
  }
  dvdMotion.last=time;
  requestAnimationFrame(animateDvd);
}
requestAnimationFrame(animateDvd);
el("load-older").addEventListener("click", async () => {
  if (!state.messages.size || !state.hasMore) return;
  const version=state.historyVersion;
  const first=Math.min(...state.messages.keys());
  const scroll=el("message-scroll"), height=scroll.scrollHeight, top=scroll.scrollTop;
  el("load-older").disabled=true;
  try {
    const response=await fetch("/api/messages?before_id="+first+"&limit=100");
    if (!response.ok) throw new Error("History could not be loaded. Please try again.");
    const data=await response.json();
    if (version!==state.historyVersion || !state.joined) return;
    data.messages.forEach(m => state.messages.set(m.id,m));
    state.hasMore=data.has_more; renderMessages();
    scroll.scrollTop=top+scroll.scrollHeight-height;
  } catch (error) { if (version===state.historyVersion) roomError(error.message); }
  finally { el("load-older").disabled=false; }
});
