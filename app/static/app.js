const el = id => document.getElementById(id);
const storage = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
};
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
  el("fire-stage").dataset.fireState = scene;
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
}
el("message-input").addEventListener("input",resizeComposer);
const state = { name: "", socket: null, joined: false, ready: false, timer: null,
  retry: 0, messages: new Map(), hasMore: false, pending: null, pendingTimer: null, historyVersion: 0 };

function ready(value, label) {
  state.ready = value;
  el("connection-status").textContent = label;
  el("status-dot").classList.toggle("offline",!value);
  el("status-dot").parentElement.setAttribute("aria-label",label);
  el("send-button").disabled = !value || !!state.pending;
  el("join-button").disabled = state.joined && !value;
  if (!value) el("online-count").textContent = "";
}
function clearPending() {
  clearTimeout(state.pendingTimer);
  state.pending = null;
  el("send-label").textContent = "Send";
  el("send-button").disabled = !state.ready;
}
function roomError(message) { el("room-error").textContent = message; }
function messageNode(message) {
  const mine = message.client_id === clientId;
  const item = document.createElement("article"); item.className = "message" + (mine ? " mine" : "");
  const content = document.createElement("div"); content.className = "message-content";
  const meta = document.createElement("div"); meta.className = "message-meta";
  const name = document.createElement("strong"); name.textContent = message.name + (mine ? " · you" : "");
  const time = document.createElement("time"), date = new Date(message.created_at);
  time.dateTime = message.created_at; time.title = date.toLocaleString();
  time.textContent = date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  const body = document.createElement("div"); body.className = "bubble"; body.textContent = message.body;
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
      if (state.pending && message.client_id === clientId && message.body === state.pending.body) {
        if (el("message-input").value === state.pending.draft) el("message-input").value = "";
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
el("message-form").addEventListener("submit",event => {
  event.preventDefault();
  const input=el("message-input"), body=input.value.trim();
  if (!body || !state.ready || state.pending || state.socket?.readyState!==WebSocket.OPEN) return;
  state.pending={body,draft:input.value}; el("send-button").disabled=true;
  el("send-label").textContent="Sending…"; roomError("");
  try { state.socket.send(JSON.stringify({type:"message",body})); }
  catch { clearPending(); roomError("Message could not be sent. Your draft is kept."); return; }
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
