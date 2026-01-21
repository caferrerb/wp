// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const qrSection = document.getElementById('qr-section');
const qrImage = document.getElementById('qr-image');
const conversationsList = document.getElementById('conversations-list');
const searchInput = document.getElementById('search-input');
const emptyState = document.getElementById('empty-state');
const chatView = document.getElementById('chat-view');
const chatName = document.getElementById('chat-name');
const chatJid = document.getElementById('chat-jid');
const messageCount = document.getElementById('message-count');
const messagesContainer = document.getElementById('messages-container');
const backBtn = document.getElementById('back-btn');
const exportBtn = document.getElementById('export-btn');
const sendReportBtn = document.getElementById('send-report-btn');
const sidebar = document.getElementById('sidebar');
const loading = document.getElementById('loading');

// State
let conversations = [];
let currentConversation = null;
let currentMessages = [];
let lastTimestamp = 0;
let currentStatus = 'disconnected';
let allowedNumbers = JSON.parse(localStorage.getItem('allowedNumbers') || '[]');
let filterEnabled = JSON.parse(localStorage.getItem('filterEnabled') || 'false');

// Polling intervals
let statusInterval = null;
let qrInterval = null;
let conversationsInterval = null;
let messagesInterval = null;

// API Functions
async function fetchStatus() {
  try {
    const response = await fetch('/api/whatsapp/status');
    const data = await response.json();
    return data.status;
  } catch (error) {
    console.error('Error fetching status:', error);
    return 'disconnected';
  }
}

async function fetchQr() {
  try {
    const response = await fetch('/api/whatsapp/qr');
    const data = await response.json();
    return data.success ? data.qr : null;
  } catch (error) {
    console.error('Error fetching QR:', error);
    return null;
  }
}

async function fetchConversations() {
  try {
    const response = await fetch('/api/conversations');
    const data = await response.json();
    return data.success ? data.data : [];
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return [];
  }
}

async function fetchMessages(remoteJid) {
  try {
    // Request latest 100 messages in DESC order, then reverse to show chronologically
    const response = await fetch(`/api/messages?remoteJid=${encodeURIComponent(remoteJid)}&limit=100&sortOrder=desc`);
    const data = await response.json();
    if (data.success) {
      // Reverse to show oldest first (chat view order)
      return data.data.reverse();
    }
    return [];
  } catch (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
}

async function fetchLatestTimestamp() {
  try {
    const response = await fetch('/api/latest-timestamp');
    const data = await response.json();
    return data.success ? data.timestamp : 0;
  } catch (error) {
    console.error('Error fetching latest timestamp:', error);
    return 0;
  }
}

async function sendReport() {
  try {
    const response = await fetch('/api/send-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeAll: true }),
    });
    const data = await response.json();
    if (data.success) {
      alert('Report sent successfully!');
    } else {
      alert('Error: ' + (data.error || 'Failed to send report'));
    }
  } catch (error) {
    console.error('Error sending report:', error);
    alert('Error sending report');
  }
}

// UI Functions
function updateStatus(status) {
  currentStatus = status;
  statusBadge.className = `status-badge ${status}`;

  const statusLabels = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    qr_ready: 'Scan QR',
    connected: 'Connected',
  };

  statusText.textContent = statusLabels[status] || status;

  if (status === 'qr_ready') {
    qrSection.classList.remove('hidden');
    startQrPolling();
  } else {
    qrSection.classList.add('hidden');
    stopQrPolling();
  }

  if (status === 'connected') {
    loadConversations();
    startConversationsPolling();
  }
}

async function updateQr() {
  const qr = await fetchQr();
  if (qr) {
    qrImage.src = qr;
  }
}

function renderConversations(filter = '') {
  let filtered = conversations;

  // Apply number filter first
  if (filterEnabled && allowedNumbers.length > 0) {
    filtered = filtered.filter(c => isNumberAllowed(c.remote_jid));
  }

  // Then apply search filter
  if (filter) {
    filtered = filtered.filter(c =>
      (c.sender_name || '').toLowerCase().includes(filter.toLowerCase()) ||
      c.remote_jid.includes(filter)
    );
  }

  if (filtered.length === 0) {
    conversationsList.innerHTML = `
      <div class="no-conversations">
        <p>${filter ? 'No conversations found' : 'No messages yet'}</p>
      </div>
    `;
    return;
  }

  conversationsList.innerHTML = filtered.map(conv => {
    const isGroup = conv.is_group;
    const displayName = isGroup
      ? (conv.group_name || 'Group')
      : (conv.sender_name || formatJid(conv.remote_jid));
    const groupId = isGroup ? formatJid(conv.remote_jid) : '';

    return `
      <div class="conversation-item ${currentConversation?.remote_jid === conv.remote_jid ? 'active' : ''}"
           data-jid="${escapeHtml(conv.remote_jid)}">
        <div class="conversation-avatar ${isGroup ? 'group' : ''}">
          <span class="avatar-initials">${getInitials(displayName)}</span>
        </div>
        <div class="conversation-details">
          <div class="conversation-header">
            <span class="conversation-name">
              ${isGroup ? '<span class="group-badge">Group</span> ' : ''}${escapeHtml(displayName)}
            </span>
            <span class="conversation-time">${formatRelativeTime(conv.last_timestamp)}</span>
          </div>
          <div class="conversation-preview">
            <span class="conversation-last-message">${escapeHtml(conv.last_message || '[No content]')}</span>
            <span class="conversation-badge">${conv.unread_count}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', () => {
      const jid = item.dataset.jid;
      const conv = conversations.find(c => c.remote_jid === jid);
      if (conv) {
        openConversation(conv);
      }
    });
  });
}

function openConversation(conv) {
  currentConversation = conv;

  // Update header with appropriate name
  const displayName = conv.is_group
    ? (conv.group_name || 'Group')
    : (conv.sender_name || formatJid(conv.remote_jid));
  chatName.textContent = displayName;
  chatJid.textContent = conv.is_group ? `Group: ${formatJid(conv.remote_jid)}` : formatJid(conv.remote_jid);

  // Show chat view
  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');

  // Mobile: hide sidebar
  if (window.innerWidth <= 768) {
    sidebar.classList.add('hidden-mobile');
  }

  // Mark as active in list
  renderConversations(searchInput.value);

  // Load messages (force scroll to bottom on first load)
  loadMessages(conv.remote_jid, true);
  startMessagesPolling();
}

function closeConversation() {
  currentConversation = null;
  currentMessages = [];

  // Show empty state
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');

  // Mobile: show sidebar
  sidebar.classList.remove('hidden-mobile');

  // Update list
  renderConversations(searchInput.value);

  // Stop messages polling
  stopMessagesPolling();
}

function renderMediaContent(msg) {
  if (!msg.media_path) {
    return '';
  }

  const mediaPath = msg.media_path;
  const type = msg.message_type;

  switch (type) {
    case 'image':
      return `<div class="message-media"><img src="${mediaPath}" alt="Image" class="media-image" onclick="window.open('${mediaPath}', '_blank')"></div>`;
    case 'video':
      return `<div class="message-media"><video src="${mediaPath}" controls class="media-video"></video></div>`;
    case 'audio':
    case 'voice':
      return `<div class="message-media"><audio src="${mediaPath}" controls class="media-audio"></audio></div>`;
    case 'sticker':
      return `<div class="message-media"><img src="${mediaPath}" alt="Sticker" class="media-sticker"></div>`;
    case 'document':
      return `<div class="message-media"><a href="${mediaPath}" target="_blank" class="media-document">Download: ${escapeHtml(msg.content || 'Document')}</a></div>`;
    default:
      return '';
  }
}

function renderMessages(messages, forceScrollToBottom = false) {
  if (messages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-conversations"><p>No messages</p></div>';
    messageCount.textContent = '0 messages';
    return;
  }

  // Check if user is near the bottom before re-rendering
  const scrollThreshold = 100; // pixels from bottom
  const wasNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < scrollThreshold;

  messageCount.textContent = `${messages.length} messages`;

  messagesContainer.innerHTML = messages.map(msg => {
    const isGroup = msg.remote_jid.endsWith('@g.us');
    const chatId = formatJid(msg.remote_jid);
    const senderName = msg.sender_name || 'Unknown';
    // Check if sender_name looks like a phone number or LID
    const senderDisplay = senderName.includes('@') ? formatJid(senderName) : senderName;

    let tooltipInfo;
    if (msg.is_from_me) {
      tooltipInfo = isGroup
        ? `Sent by you\nGroup: ${chatId}`
        : `Sent by you\nTo: ${chatId}`;
    } else if (isGroup) {
      tooltipInfo = `From: ${senderDisplay}\nGroup: ${chatId}\nType: ${msg.message_type}`;
    } else {
      tooltipInfo = `From: ${senderDisplay}\nPhone: ${chatId}\nType: ${msg.message_type}`;
    }

    return `
      <div class="message ${msg.is_from_me ? 'outgoing' : 'incoming'}" title="${escapeHtml(tooltipInfo)}">
        ${currentConversation?.is_group && !msg.is_from_me ? `<div class="message-sender">${escapeHtml(senderDisplay)}</div>` : ''}
        ${renderMediaContent(msg)}
        <div class="message-content">${escapeHtml(msg.content || '[No content]')}</div>
        <div class="message-meta">
          ${msg.message_type !== 'text' ? `<span class="message-type-badge">${msg.message_type}</span>` : ''}
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Only scroll to bottom if forced (first load) or user was already near the bottom
  if (forceScrollToBottom || wasNearBottom) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Data loading functions
async function loadConversations() {
  conversations = await fetchConversations();
  renderConversations(searchInput.value);
}

async function loadMessages(remoteJid, forceScrollToBottom = false) {
  const messages = await fetchMessages(remoteJid);
  currentMessages = messages;
  renderMessages(messages, forceScrollToBottom);
}

// Polling functions
function startStatusPolling() {
  if (statusInterval) return;
  statusInterval = setInterval(async () => {
    const status = await fetchStatus();
    if (status !== currentStatus) {
      updateStatus(status);
    }
  }, 3000);
}

function startQrPolling() {
  if (qrInterval) return;
  updateQr();
  qrInterval = setInterval(updateQr, 5000);
}

function stopQrPolling() {
  if (qrInterval) {
    clearInterval(qrInterval);
    qrInterval = null;
  }
}

function startConversationsPolling() {
  if (conversationsInterval) return;
  conversationsInterval = setInterval(async () => {
    // Check for new messages
    const newTimestamp = await fetchLatestTimestamp();
    if (newTimestamp > lastTimestamp) {
      lastTimestamp = newTimestamp;
      await loadConversations();

      // If viewing a conversation, reload messages
      if (currentConversation) {
        await loadMessages(currentConversation.remote_jid);
      }
    }
  }, 2000); // Poll every 2 seconds
}

function startMessagesPolling() {
  if (messagesInterval) return;
  messagesInterval = setInterval(async () => {
    if (currentConversation) {
      await loadMessages(currentConversation.remote_jid);
    }
  }, 3000);
}

function stopMessagesPolling() {
  if (messagesInterval) {
    clearInterval(messagesInterval);
    messagesInterval = null;
  }
}

// Filter functions
function saveAllowedNumbers() {
  localStorage.setItem('allowedNumbers', JSON.stringify(allowedNumbers));
  localStorage.setItem('filterEnabled', JSON.stringify(filterEnabled));
}

function addAllowedNumber(number) {
  const cleaned = number.replace(/[^0-9]/g, '');
  if (cleaned && !allowedNumbers.includes(cleaned)) {
    allowedNumbers.push(cleaned);
    saveAllowedNumbers();
    renderFilterList();
    renderConversations(searchInput.value);
  }
}

function removeAllowedNumber(number) {
  allowedNumbers = allowedNumbers.filter(n => n !== number);
  saveAllowedNumbers();
  renderFilterList();
  renderConversations(searchInput.value);
}

function toggleFilter() {
  filterEnabled = !filterEnabled;
  saveAllowedNumbers();
  updateFilterToggle();
  renderConversations(searchInput.value);
}

function clearFilter() {
  allowedNumbers = [];
  filterEnabled = false;
  saveAllowedNumbers();
  renderFilterList();
  updateFilterToggle();
  renderConversations(searchInput.value);
}

function updateFilterToggle() {
  const toggleBtn = document.getElementById('filter-toggle');
  if (toggleBtn) {
    toggleBtn.textContent = filterEnabled ? 'Mostrar todos' : 'Aplicar filtro';
    toggleBtn.classList.toggle('active', filterEnabled);
  }
}

function renderFilterList() {
  const filterList = document.getElementById('filter-list');
  if (!filterList) return;

  if (allowedNumbers.length === 0) {
    filterList.innerHTML = '<div class="filter-empty">No hay números filtrados</div>';
    return;
  }

  filterList.innerHTML = allowedNumbers.map(num => `
    <div class="filter-item">
      <span>${num}</span>
      <button class="filter-remove" data-number="${num}">&times;</button>
    </div>
  `).join('');

  // Add event listeners for remove buttons
  filterList.querySelectorAll('.filter-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const number = e.target.dataset.number;
      removeAllowedNumber(number);
    });
  });
}

function isNumberAllowed(jid) {
  if (!filterEnabled || allowedNumbers.length === 0) return true;
  const number = jid.split('@')[0];
  return allowedNumbers.some(allowed => number.includes(allowed) || allowed.includes(number));
}

// Helper functions
function formatJid(jid) {
  if (!jid) return 'Unknown';
  return jid.split('@')[0];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.substring(0, 2).toUpperCase();
}

function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now - date;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return formatTime(timestamp);
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
async function initialize() {
  // Get initial status
  const status = await fetchStatus();
  updateStatus(status);

  // Start status polling
  startStatusPolling();

  // Get initial timestamp
  lastTimestamp = await fetchLatestTimestamp();

  // Load initial conversations if connected
  if (status === 'connected') {
    await loadConversations();
    startConversationsPolling();
  }

  // Event listeners
  searchInput.addEventListener('input', (e) => {
    renderConversations(e.target.value);
  });

  backBtn.addEventListener('click', closeConversation);

  exportBtn.addEventListener('click', () => {
    window.location.href = '/api/export-csv';
  });

  sendReportBtn.addEventListener('click', sendReport);

  // Filter event listeners
  const filterToggle = document.getElementById('filter-toggle');
  if (filterToggle) {
    filterToggle.addEventListener('click', toggleFilter);
  }

  const filterClear = document.getElementById('filter-clear');
  if (filterClear) {
    filterClear.addEventListener('click', clearFilter);
  }

  const filterInput = document.getElementById('filter-input');
  const filterAddBtn = document.getElementById('filter-add-btn');
  if (filterInput && filterAddBtn) {
    filterAddBtn.addEventListener('click', () => {
      addAllowedNumber(filterInput.value);
      filterInput.value = '';
    });
    filterInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addAllowedNumber(filterInput.value);
        filterInput.value = '';
      }
    });
  }

  // Initialize filter UI
  renderFilterList();
  updateFilterToggle();
}

// Start app
document.addEventListener('DOMContentLoaded', initialize);
