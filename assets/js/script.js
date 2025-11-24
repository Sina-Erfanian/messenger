import { firebaseConfig } from "./config.js";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

async function hashPassword(password) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return hashHex;
  } catch (error) {
    console.error("Error hashing password:", error);
    return password;
  }
}

let currentUser = null;
let currentChat = null;
let chatsListener = null;
let messagesListener = null;
let replyToMessage = null;
let editingMessage = null;
let messageCacheById = {};

function setLoadingState(target, isLoading) {
  if (!target) return;
  if (isLoading) {
    if (!target.dataset.originalHtml) {
      target.dataset.originalHtml = target.innerHTML;
    }
    const text =
      typeof target.dataset.loadingText === "string"
        ? target.dataset.loadingText
        : "";
    const label = text
      ? `<span class="loading-label">${text}</span>`
      : "";
    target.innerHTML = `<span class="loading-content"><span class="loading-spinner"></span>${label}</span>`;
    target.classList.add("is-loading");
    if ("disabled" in target) target.disabled = true;
  } else {
    if ("disabled" in target) target.disabled = false;
    if (target.dataset.originalHtml) {
      target.innerHTML = target.dataset.originalHtml;
      delete target.dataset.originalHtml;
    }
    target.classList.remove("is-loading");
  }
}

function showLoading(container, text) {
  if (!container) return;
  const label = text ? `<span class="loading-label">${text}</span>` : "";
  container.innerHTML = `<div class="loading-state"><span class="loading-spinner"></span>${label}</div>`;
}

auth.onAuthStateChanged(async (user) => {
  if (user) {
    const userDoc = await db.collection("users").doc(user.uid).get();
    if (userDoc.exists) {
      currentUser = { ...user, ...userDoc.data() };
      await db.collection("users").doc(user.uid).update({
        isOnline: true,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      });
      showMainApp();
    }
  } else {
    currentUser = null;
    showLogin();
  }
});

function showLogin() {
  document.getElementById("authContainer").classList.remove("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("signupPage").classList.add("hidden");
  document.getElementById("mainApp").classList.add("hidden");
}

function showSignup() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("signupPage").classList.remove("hidden");
}

function showMainApp() {
  document.getElementById("authContainer").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
  document.getElementById("sidebarAvatar").textContent =
    currentUser.displayName[0].toUpperCase();
  document.getElementById("sidebarName").textContent = currentUser.displayName;
  loadChats();
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const btn = document.getElementById("loginBtn");
  const errorDiv = document.getElementById("loginError");

  errorDiv.innerHTML = "";
  setLoadingState(btn, true);

  try {
    const hashedPassword = await hashPassword(password);
    await auth.signInWithEmailAndPassword(email, hashedPassword);
  } catch (error) {
    errorDiv.innerHTML =
      '<div class="error-message">' + mapAuthErrorToFa(error) + "</div>";
  } finally {
    setLoadingState(btn, false);
  }
});

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const displayName = document.getElementById("signupDisplayName").value;
  const username = document
    .getElementById("signupUsername")
    .value.toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  const btn = document.getElementById("signupBtn");
  const errorDiv = document.getElementById("signupError");

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    errorDiv.innerHTML =
      '<div class="error-message">' + passwordValidation.message + "</div>";
    return;
  }

  errorDiv.innerHTML = "";
  setLoadingState(btn, true);

  let signupSuccess = false;

  try {
    const usernameQuery = await db
      .collection("users")
      .where("username", "==", username)
      .get();
    if (!usernameQuery.empty) {
      throw new Error("نام کاربری قبلاً استفاده شده است");
    }

    const hashedPassword = await hashPassword(password);

    const userCredential = await auth.createUserWithEmailAndPassword(
      email,
      hashedPassword
    );
    const user = userCredential.user;

    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      email: email,
      username: username,
      displayName: displayName,
      photoURL: "",
      isOnline: true,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    await user.updateProfile({ displayName: displayName });
    signupSuccess = true;
  } catch (error) {
    errorDiv.innerHTML =
      '<div class="error-message">' + mapAuthErrorToFa(error) + "</div>";
  } finally {
    setLoadingState(btn, false);
    if (signupSuccess) {
      e.target.reset();
      updateStrength("");
    }
  }
});

function mapAuthErrorToFa(error) {
  const code = (error && error.code) || "";
  const message = (error && error.message) || "";
  const map = {
    "auth/invalid-email": "ایمیل معتبر نیست",
    "auth/user-disabled": "حساب کاربری شما غیرفعال شده است",
    "auth/user-not-found": "کاربری با این ایمیل یافت نشد",
    "auth/wrong-password": "رمز عبور نادرست است",
    "auth/email-already-in-use": "این ایمیل قبلا ثبت شده است",
    "auth/weak-password": "رمز عبور انتخابی ضعیف است",
    "auth/too-many-requests": "درخواست‌های زیاد. بعداً تلاش کنید",
    "auth/network-request-failed":
      "مشکل در ارتباط با سرور. اینترنت خود را بررسی کنید",
  };
  if (map[code]) return map[code];
  if (message && message.includes("نام کاربری")) return message;
  return "خطایی رخ داد. لطفاً دوباره تلاش کنید";
}

async function logout(trigger) {
  const source =
    trigger && trigger instanceof HTMLElement ? trigger : null;
  if (source) setLoadingState(source, true);
  try {
    if (currentUser) {
      await db.collection("users").doc(currentUser.uid).update({
        isOnline: false,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
    await auth.signOut();
  } catch (error) {
    console.error("Error during logout:", error);
  } finally {
    if (source) setLoadingState(source, false);
    closeSettings();
  }
}

function loadChats() {
  if (chatsListener) chatsListener();
  showLoading(document.getElementById("chatList"), "در حال بارگذاری...");

  chatsListener = db
    .collection("chats")
    .where("participants", "array-contains", currentUser.uid)
    .onSnapshot((snapshot) => {
      const chatListEl = document.getElementById("chatList");
      chatListEl.innerHTML = "";

      if (snapshot.empty) {
        chatListEl.innerHTML =
          '<div class="empty-chats"><div class="empty-icon">💬</div><p>هنوز چتی ندارید</p><button class="btn-start-chat" onclick="showSearchModal()">شروع چت جدید</button></div>';
        return;
      }

      const chats = [];
      snapshot.forEach((doc) => {
        chats.push({ id: doc.id, ...doc.data() });
      });

      chats.sort((a, b) => {
        const timeA = a.lastMessageTime ? a.lastMessageTime.toMillis() : 0;
        const timeB = b.lastMessageTime ? b.lastMessageTime.toMillis() : 0;
        return timeB - timeA;
      });

      chats.forEach((chat) => {
        const otherUserId = chat.participants.find(
          (id) => id !== currentUser.uid
        );
        const otherUserData = chat.participantsData[otherUserId];
        if (!otherUserData) return;

        const chatItem = document.createElement("div");
        chatItem.className =
          "chat-item" +
          (currentChat && currentChat.id === chat.id ? " active" : "");
        chatItem.onclick = function () {
          openChat(chat);
        };

        const timeStr = chat.lastMessageTime
          ? formatTime(chat.lastMessageTime.toDate())
          : "";
        const onlineIndicator = otherUserData.isOnline
          ? '<div class="online-indicator"></div>'
          : "";

        chatItem.innerHTML =
          '<div class="chat-avatar">' +
          otherUserData.displayName[0].toUpperCase() +
          onlineIndicator +
          '</div><div class="chat-info"><div class="chat-name">' +
          escapeHtml(otherUserData.displayName) +
          '</div><div class="chat-last-message">' +
          escapeHtml(chat.lastMessage || "شروع گفتگو") +
          '</div></div><div class="chat-time">' +
          timeStr +
          "</div>";

        chatListEl.appendChild(chatItem);
      });
    });
}

function openChat(chat) {
  currentChat = chat;
  const chatArea = document.getElementById("chatArea");
  const otherUserId = chat.participants.find((id) => id !== currentUser.uid);
  const otherUserData = chat.participantsData[otherUserId];

  const onlineIndicator = otherUserData.isOnline
    ? '<div class="online-indicator"></div>'
    : "";
  const statusText = otherUserData.isOnline ? "آنلاین" : "آفلاین";

  chatArea.innerHTML =
    '<div class="chat-header"><button class="back-btn" onclick="closeChatMobile()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg></button><div class="chat-avatar">' +
    otherUserData.displayName[0].toUpperCase() +
    onlineIndicator +
    '</div><div class="chat-header-info"><div class="chat-header-name">' +
    escapeHtml(otherUserData.displayName) +
    '</div><div class="chat-header-status"><span id="typingStatus" class="typing-indicator hidden"><span class="typing-dots"><span></span><span></span><span></span></span> در حال تایپ...</span> ' +
    statusText +
    '</div></div></div><div class="chat-messages" id="chatMessages"></div><div class="message-input-wrapper"><div id="replyPreview" class="reply-preview hidden"></div><div class="input-container"><button class="attach-btn" onclick="document.getElementById(\'fileInput\').click()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg></button><input type="file" id="fileInput" style="display:none" onchange="handleFileSelect(event)"><button class="emoji-btn" id="emojiBtn">😊</button><textarea class="message-input" id="messageInput" placeholder="پیام خود را بنویسید..." rows="1"></textarea><button class="send-btn" onclick="sendMessage()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg></button></div><div id="emojiPanel" class="emoji-panel"></div></div>';

  const messageInput = document.getElementById("messageInput");
  messageInput.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
    notifyTyping(true);
    debounceStopTyping();
  });

  messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  loadMessages(chat.id);
  loadChats();

  if (window.innerWidth <= 768) {
    const chatAreaEl = document.getElementById("chatArea");
    chatAreaEl.classList.add("active");
    document.getElementById("sidebar").classList.add("hidden");
  }

  setupEmojiPicker();
  subscribeTyping(otherUserId, chat.id);
}

function loadMessages(chatId) {
  if (messagesListener) messagesListener();
  showLoading(document.getElementById("chatMessages"), "");

  messagesListener = db
    .collection("chats")
    .doc(chatId)
    .collection("messages")
    .orderBy("timestamp", "asc")
    .onSnapshot((snapshot) => {
      const messagesEl = document.getElementById("chatMessages");
      if (!messagesEl) return;

      messagesEl.innerHTML = "";
      messageCacheById = {};

      snapshot.forEach((doc) => {
        const message = { id: doc.id, ...doc.data() };
        messageCacheById[message.id] = message;
        const messageEl = createMessageElement(message);
        messagesEl.appendChild(messageEl);

        if (message.senderId !== currentUser.uid && !message.read) {
          db.collection("chats")
            .doc(chatId)
            .collection("messages")
            .doc(doc.id)
            .update({
              read: true,
            });
        }
      });

      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
}

function linkify(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return escapeHtml(text).replace(urlRegex, function (url) {
    return (
      '<a href="' +
      url +
      '" target="_blank" rel="noopener" style="color:#4FC3F7; text-decoration:underline;">' +
      url +
      "</a>"
    );
  });
}

function createMessageElement(message) {
  const isOwn = message.senderId === currentUser.uid;
  const messageDiv = document.createElement("div");
  messageDiv.className = "message" + (isOwn ? " own" : "");
  messageDiv.dataset.messageId = message.id;

  let replyHtml = "";
  if (message.replyTo) {
    replyHtml =
      '<div class="message-reply-to"><strong>پاسخ به:</strong><br>' +
      escapeHtml(message.replyTo.text) +
      "</div>";
  }

  const timeStr = message.timestamp
    ? formatTime(message.timestamp.toDate())
    : "";
  const editedStr = message.edited
    ? '<div class="message-edited">ویرایش شده</div>'
    : "";
  const statusTicks = isOwn
    ? '<span class="message-status">' + (message.read ? "✔✔" : "✔") + "</span>"
    : "";

  const actions =
    '<div class="message-actions">' +
    (!isOwn
      ? '<button class="action-btn" onclick="replyTo(\'' +
        message.id +
        "')\">پاسخ</button>"
      : "") +
    (isOwn
      ? '<button class="action-btn" onclick="editMessage(\'' +
        message.id +
        "')\">ویرایش</button>"
      : "") +
    (isOwn
      ? '<button class="action-btn danger" onclick="deleteMessage(\'' +
        message.id +
        "')\">حذف</button>"
      : "") +
    '<button class="action-btn" onclick="copyMessage(\'' +
    message.id +
    "')\">کپی</button>" +
    "</div>";

  let contentHtml = "";
  if (message.type === "file" && message.fileURL) {
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(message.fileName || "");
    if (isImage) {
      contentHtml =
        '<div class="message-text"><img src="' +
        message.fileURL +
        '" alt="' +
        escapeHtml(message.fileName || "") +
        '" style="max-width:240px;border-radius:8px;display:block;"/><div style="margin-top:6px;">' +
        escapeHtml(message.fileName || "") +
        "</div></div>";
    } else {
      contentHtml =
        '<div class="message-text"><a href="' +
        message.fileURL +
        '" target="_blank" rel="noopener" style="color:#4FC3F7;">' +
        escapeHtml(message.fileName || "دانلود فایل") +
        "</a></div>";
    }
  } else {
    contentHtml =
      '<div class="message-text">' + linkify(message.text || "") + "</div>";
  }

  messageDiv.innerHTML =
    '<div class="message-bubble">' +
    actions +
    replyHtml +
    contentHtml +
    editedStr +
    '<div class="message-time">' +
    statusTicks +
    timeStr +
    "</div></div>";

  return messageDiv;
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();

  if (!text || !currentChat) return;

  input.value = "";
  input.style.height = "auto";
  const emojiPanelEl = document.getElementById("emojiPanel");
  if (emojiPanelEl) emojiPanelEl.style.display = "none";
  notifyTyping(false);

  if (editingMessage) {
    await db
      .collection("chats")
      .doc(currentChat.id)
      .collection("messages")
      .doc(editingMessage)
      .update({
        text: text,
        edited: true,
      });
    cancelEdit();
  } else {
    const messageData = {
      text: text,
      senderId: currentUser.uid,
      senderName: currentUser.displayName,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      type: "text",
      edited: false,
      read: false,
    };

    if (replyToMessage) {
      const replied = messageCacheById[replyToMessage];
      messageData.replyTo = replied
        ? { id: replyToMessage, text: replied.text || "" }
        : { id: replyToMessage, text: "" };
    }

    await db
      .collection("chats")
      .doc(currentChat.id)
      .collection("messages")
      .add(messageData);
    await db.collection("chats").doc(currentChat.id).update({
      lastMessage: text,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
    });

    cancelReply();
  }
}

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file || !currentChat) return;

  try {
    const storageRef = storage.ref();
    const fileRef = storageRef.child(
      "files/" + currentChat.id + "/" + Date.now() + "_" + file.name
    );
    await fileRef.put(file);
    const fileURL = await fileRef.getDownloadURL();

    await db
      .collection("chats")
      .doc(currentChat.id)
      .collection("messages")
      .add({
        text: "فایل ارسال شد",
        senderId: currentUser.uid,
        senderName: currentUser.displayName,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        type: "file",
        fileName: file.name,
        fileURL: fileURL,
        edited: false,
        read: false,
      });

    await db.collection("chats").doc(currentChat.id).update({
      lastMessage: "فایل ارسال شد",
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    alert("خطا در آپلود فایل");
  }
}

function setupEmojiPicker() {
  const panel = document.getElementById("emojiPanel");
  const btn = document.getElementById("emojiBtn");
  const textarea = document.getElementById("messageInput");
  const emojis = [
    "😀",
    "😁",
    "😂",
    "🤣",
    "😊",
    "😍",
    "🤩",
    "😘",
    "😅",
    "😉",
    "🙂",
    "🤔",
    "😐",
    "😴",
    "😮",
    "😢",
    "😭",
    "😡",
    "👍",
    "👎",
    "👏",
    "🙏",
    "🔥",
    "❤️",
    "💙",
    "💚",
    "💛",
    "💜",
    "✨",
    "🎉",
    "✅",
    "❌",
  ];
  panel.innerHTML = emojis
    .map((e) => '<button type="button">' + e + "</button>")
    .join("");
  panel.style.display = "none";
  btn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "grid" ? "none" : "grid";
  });
  panel.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      const emo = e.target.textContent;
      textarea.value += emo;
      textarea.dispatchEvent(new Event("input"));
    }
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== btn) {
      panel.style.display = "none";
    }
  });
}

let typingTimeout = null;
function notifyTyping(isTyping) {
  if (!currentChat) return;
  db.collection("chats")
    .doc(currentChat.id)
    .collection("meta")
    .doc(currentUser.uid)
    .set(
      {
        typing: !!isTyping,
        ts: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}
function debounceStopTyping() {
  if (typingTimeout) clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => notifyTyping(false), 1500);
}
let unsubscribeTyping = null;
function subscribeTyping(otherUserId, chatId) {
  if (unsubscribeTyping) {
    unsubscribeTyping();
    unsubscribeTyping = null;
  }
  unsubscribeTyping = db
    .collection("chats")
    .doc(chatId)
    .collection("meta")
    .doc(otherUserId)
    .onSnapshot((doc) => {
      const data = doc.data() || {};
      const el = document.getElementById("typingStatus");
      if (!el) return;
      if (data.typing) el.classList.remove("hidden");
      else el.classList.add("hidden");
    });
}

function replyTo(messageId) {
  replyToMessage = messageId;
  const replyPreview = document.getElementById("replyPreview");
  replyPreview.innerHTML =
    '<div class="reply-info"><div class="reply-label">پاسخ به پیام</div></div><button class="reply-close" onclick="cancelReply()">×</button>';
  replyPreview.classList.remove("hidden");
}

function cancelReply() {
  replyToMessage = null;
  document.getElementById("replyPreview").classList.add("hidden");
}

function editMessage(messageId) {
  editingMessage = messageId;
  db.collection("chats")
    .doc(currentChat.id)
    .collection("messages")
    .doc(messageId)
    .get()
    .then((doc) => {
      const message = doc.data();
      document.getElementById("messageInput").value = message.text;
      const replyPreview = document.getElementById("replyPreview");
      replyPreview.innerHTML =
        '<div class="reply-info"><div class="reply-label">ویرایش پیام</div></div><button class="reply-close" onclick="cancelEdit()">×</button>';
      replyPreview.classList.remove("hidden");
    });
}

function cancelEdit() {
  editingMessage = null;
  document.getElementById("replyPreview").classList.add("hidden");
  document.getElementById("messageInput").value = "";
}

async function deleteMessage(messageId) {
  if (!confirm("آیا مطمئن هستید؟")) return;
  await db
    .collection("chats")
    .doc(currentChat.id)
    .collection("messages")
    .doc(messageId)
    .delete();
}

function copyMessage(messageId) {
  const msg = messageCacheById[messageId];
  const text = msg && msg.text ? msg.text : "";
  if (!text) return;
  navigator.clipboard.writeText(text);
}

function showSearchModal() {
  document.getElementById("searchModal").classList.remove("hidden");
}

function closeSearchModal() {
  document.getElementById("searchModal").classList.add("hidden");
}

async function searchUser() {
  const username = document
    .getElementById("searchUsername")
    .value.toLowerCase()
    .trim();
  const resultsEl = document.getElementById("searchResults");

  if (!username) return;

  showLoading(resultsEl, "در حال جستجو...");

  const snapshot = await db
    .collection("users")
    .where("username", "==", username)
    .get();

  resultsEl.innerHTML = "";
  if (snapshot.empty) {
    resultsEl.innerHTML =
      '<p style="text-align:center;color:var(--text-secondary);padding:20px;">کاربری یافت نشد</p>';
    return;
  }

  snapshot.forEach((doc) => {
    const user = doc.data();
    if (user.uid === currentUser.uid) return;

    const userResult = document.createElement("div");
    userResult.className = "user-result";
    userResult.onclick = function () {
      startChat(user);
    };
    userResult.innerHTML =
      '<div class="user-avatar">' +
      user.displayName[0].toUpperCase() +
      '</div><div class="user-result-info"><h3>' +
      escapeHtml(user.displayName) +
      "</h3><p>@" +
      user.username +
      "</p></div>";
    resultsEl.appendChild(userResult);
  });
}

async function startChat(otherUser) {
  const existingChats = await db
    .collection("chats")
    .where("participants", "array-contains", currentUser.uid)
    .get();

  let existingChat = null;
  existingChats.forEach((doc) => {
    const chat = doc.data();
    if (chat.participants.includes(otherUser.uid)) {
      existingChat = { id: doc.id, ...chat };
    }
  });

  if (existingChat) {
    closeSearchModal();
    openChat(existingChat);
    return;
  }

  const chatRef = await db.collection("chats").add({
    participants: [currentUser.uid, otherUser.uid],
    participantsData: {
      [currentUser.uid]: {
        displayName: currentUser.displayName,
        username: currentUser.username,
        isOnline: true,
      },
      [otherUser.uid]: {
        displayName: otherUser.displayName,
        username: otherUser.username,
        isOnline: otherUser.isOnline,
      },
    },
    lastMessage: "",
    lastMessageTime: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });

  const newChat = {
    id: chatRef.id,
    participants: [currentUser.uid, otherUser.uid],
    participantsData: {
      [currentUser.uid]: {
        displayName: currentUser.displayName,
        username: currentUser.username,
        isOnline: true,
      },
      [otherUser.uid]: {
        displayName: otherUser.displayName,
        username: otherUser.username,
        isOnline: otherUser.isOnline,
      },
    },
  };

  closeSearchModal();
  openChat(newChat);
}

function showSettings() {
  document.getElementById("settingsModal").classList.remove("hidden");
  document.getElementById("profileAvatar").textContent =
    currentUser.displayName[0].toUpperCase();
  document.getElementById("profileName").textContent = currentUser.displayName;
  document.getElementById("profileUsername").textContent =
    "@" + currentUser.username;
}

function closeSettings() {
  document.getElementById("settingsModal").classList.add("hidden");
}

function showSidebar() {
  document.getElementById("sidebar").classList.remove("hidden");
}

function closeChatMobile() {
  if (window.innerWidth <= 768) {
    const chatAreaEl = document.getElementById("chatArea");
    chatAreaEl.classList.remove("active");
    document.getElementById("sidebar").classList.remove("hidden");
  }
}

function formatTime(date) {
  if (!date) return "";
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "الان";
  if (diff < 3600000) return Math.floor(diff / 60000) + " دقیقه";
  if (diff < 86400000)
    return date.toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  return date.toLocaleDateString("fa-IR", { month: "short", day: "numeric" });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

document.getElementById("searchUsername").addEventListener("keypress", (e) => {
  if (e.key === "Enter") searchUser();
});

function validatePassword(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push("رمز عبور باید حداقل ۸ کاراکتر باشد");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("رمز عبور باید حداقل یک حرف بزرگ داشته باشد");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("رمز عبور باید حداقل یک حرف کوچک داشته باشد");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("رمز عبور باید حداقل یک عدد داشته باشد");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("رمز عبور باید حداقل یک کاراکتر خاص (!@#$%^&*...) داشته باشد");
  }

  return {
    isValid: errors.length === 0,
    message: errors.join(". "),
  };
}

const signupPasswordEl = document.getElementById("signupPassword");
const strengthBarFill = document.getElementById("strengthBarFill");
const strengthText = document.getElementById("strengthText");
const genBtn = document.getElementById("genPasswordBtn");

function scorePassword(pw) {
  let score = 0;
  if (!pw) return 0;

  const lengthScore = Math.min(30, pw.length >= 8 ? 30 : pw.length * 3);
  score += lengthScore;

  if (/[a-z]/.test(pw)) score += 15;
  if (/[A-Z]/.test(pw)) score += 15;
  if (/[0-9]/.test(pw)) score += 15;
  if (/[^A-Za-z0-9]/.test(pw)) score += 25;

  return Math.min(100, score);
}

function strengthLabel(score) {
  if (score < 30) return { text: "ضعیف", color: "#e53935", width: "30%" };
  if (score < 60) return { text: "متوسط", color: "#fbc02d", width: "60%" };
  if (score < 85) return { text: "خوب", color: "#ff9800", width: "85%" };
  return { text: "قوی", color: "#43a047", width: "100%" };
}

function updateStrength(pw) {
  if (strengthBarFill && strengthText) {
    if (!pw) {
      strengthBarFill.style.width = "0%";
      strengthBarFill.style.background = "transparent";
      strengthText.textContent = "";
    } else {
      const score = scorePassword(pw);
      const s = strengthLabel(score);
      strengthBarFill.style.width = s.width;
      strengthBarFill.style.background = s.color;
      strengthText.textContent = "قدرت رمز: " + s.text;
    }
  }

  const reqs = {
    length: pw.length >= 8,
    uppercase: /[A-Z]/.test(pw),
    lowercase: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };

  Object.keys(reqs).forEach((key) => {
    const el = document.getElementById(`req-${key}`);
    if (el) {
      const checkmark = el.querySelector(".checkmark");
      if (checkmark) {
        checkmark.textContent = reqs[key] ? "✓" : "✗";
        checkmark.style.color = reqs[key] ? "#43a047" : "#e53935";
        el.style.color = reqs[key] ? "#43a047" : "#666";
      }
    }
  });
}

if (signupPasswordEl) {
  signupPasswordEl.addEventListener("input", (e) =>
    updateStrength(e.target.value)
  );
}
if (genBtn) {
  genBtn.addEventListener("click", () => {
    const generated = generateStrongPassword();
    signupPasswordEl.value = generated;
    updateStrength(generated);
  });
}

function generateStrongPassword() {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const special = "!@#$%^&*()-_=+[]{};:,.<>?";
  const allChars = lowercase + uppercase + numbers + special;
  const length = 16;
  let pw = "";

  pw += lowercase[Math.floor(Math.random() * lowercase.length)];
  pw += uppercase[Math.floor(Math.random() * uppercase.length)];
  pw += numbers[Math.floor(Math.random() * numbers.length)];
  pw += special[Math.floor(Math.random() * special.length)];

  const cryptoObj = window.crypto || window.msCrypto;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const arr = new Uint32Array(length - 4);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < length - 4; i++) {
      pw += allChars[arr[i] % allChars.length];
    }
  } else {
    for (let i = 0; i < length - 4; i++) {
      pw += allChars[Math.floor(Math.random() * allChars.length)];
    }
  }

  return pw.split("").sort(() => Math.random() - 0.5).join("");
}

window.showSignup = showSignup;
window.showLogin = showLogin;
window.showSettings = showSettings;
window.showSearchModal = showSearchModal;
window.closeSearchModal = closeSearchModal;
window.searchUser = searchUser;
window.closeSettings = closeSettings;
window.logout = logout;
window.showSidebar = showSidebar;
window.closeChatMobile = closeChatMobile;
window.replyTo = replyTo;
window.cancelReply = cancelReply;
window.editMessage = editMessage;
window.cancelEdit = cancelEdit;
window.deleteMessage = deleteMessage;
window.copyMessage = copyMessage;
window.sendMessage = sendMessage;
window.handleFileSelect = handleFileSelect;
