// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const contactInput = document.getElementById('contact-input');
const contactValue = document.getElementById('contact-value');
const contactDropdown = document.getElementById('contact-dropdown');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const searchBtn = document.getElementById('search-btn');
const emailBtn = document.getElementById('email-btn');
const resultsCount = document.getElementById('results-count');
const resultsContainer = document.getElementById('results-container');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const pageInfo = document.getElementById('page-info');
const loading = document.getElementById('loading');

// State
let conversations = [];
let currentPage = 1;
let totalPages = 1;
let totalResults = 0;
const pageSize = 50;
let selectedIndex = -1;

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

async function searchMessages(remoteJid, searchText, page = 1, sortOrder = 'desc') {
  try {
    showLoading(true);
    const params = new URLSearchParams({
      page: page.toString(),
      limit: pageSize.toString(),
      sortOrder: sortOrder,
    });

    if (remoteJid) {
      params.append('remoteJid', remoteJid);
    }
    if (searchText) {
      params.append('search', searchText);
    }

    const response = await fetch(`/api/messages?${params}`);
    const data = await response.json();
    showLoading(false);
    return data;
  } catch (error) {
    console.error('Error searching messages:', error);
    showLoading(false);
    return { success: false, data: [], pagination: { total: 0, totalPages: 0 } };
  }
}

async function sendConversationEmail() {
  const remoteJid = contactValue.value;
  const searchText = searchInput.value.trim();

  if (!remoteJid) {
    alert('Please select a contact first');
    return;
  }

  if (!confirm('Send this conversation to the configured email?')) {
    return;
  }

  try {
    showLoading(true);
    emailBtn.disabled = true;
    emailBtn.textContent = 'Sending...';

    const response = await fetch('/api/send-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remoteJid, searchText: searchText || undefined }),
    });

    const data = await response.json();
    showLoading(false);

    if (data.success) {
      alert(data.message);
    } else {
      alert('Error: ' + (data.error || 'Failed to send email'));
    }
  } catch (error) {
    console.error('Error sending email:', error);
    showLoading(false);
    alert('Error sending email');
  } finally {
    emailBtn.disabled = !contactValue.value;
    emailBtn.textContent = 'Send Email';
  }
}

// UI Functions
function updateStatus(status) {
  statusBadge.className = `status-badge ${status}`;
  const statusLabels = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    qr_ready: 'Scan QR',
    connected: 'Connected',
  };
  statusText.textContent = statusLabels[status] || status;
}

// Autocomplete functions
function filterConversations(query) {
  if (!query) {
    return conversations;
  }
  const lowerQuery = query.toLowerCase();
  return conversations.filter(conv => {
    const number = conv.remote_jid.split('@')[0];
    const name = (conv.sender_name || '').toLowerCase();
    return number.includes(lowerQuery) || name.includes(lowerQuery);
  });
}

function renderDropdown(filtered) {
  let html = `
    <div class="autocomplete-item all-contacts" data-value="">
      All contacts
    </div>
  `;

  filtered.forEach((conv, index) => {
    const number = formatJid(conv.remote_jid);
    const name = conv.sender_name || number;
    html += `
      <div class="autocomplete-item" data-value="${escapeHtml(conv.remote_jid)}" data-index="${index}">
        <div class="contact-name">${escapeHtml(name)}</div>
        <div class="contact-number">${number}</div>
      </div>
    `;
  });

  contactDropdown.innerHTML = html;
  contactDropdown.classList.remove('hidden');
  selectedIndex = -1;

  // Add click handlers
  contactDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      selectContact(item.dataset.value, item);
    });
  });
}

function selectContact(value, item) {
  contactValue.value = value;
  if (value) {
    const conv = conversations.find(c => c.remote_jid === value);
    if (conv) {
      const name = conv.sender_name || formatJid(conv.remote_jid);
      contactInput.value = `${name} (${formatJid(conv.remote_jid)})`;
    }
    emailBtn.disabled = false;
  } else {
    contactInput.value = '';
    emailBtn.disabled = true;
  }
  hideDropdown();
  performSearch(1);
}

function hideDropdown() {
  contactDropdown.classList.add('hidden');
  selectedIndex = -1;
}

function showDropdown() {
  const query = contactInput.value.trim();
  const filtered = filterConversations(query);
  renderDropdown(filtered);
}

function navigateDropdown(direction) {
  const items = contactDropdown.querySelectorAll('.autocomplete-item');
  if (items.length === 0) return;

  // Remove previous selection
  items.forEach(item => item.classList.remove('selected'));

  if (direction === 'down') {
    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
  } else {
    selectedIndex = Math.max(selectedIndex - 1, -1);
  }

  if (selectedIndex >= 0) {
    items[selectedIndex].classList.add('selected');
    items[selectedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function selectCurrentItem() {
  const items = contactDropdown.querySelectorAll('.autocomplete-item');
  if (selectedIndex >= 0 && selectedIndex < items.length) {
    const item = items[selectedIndex];
    selectContact(item.dataset.value, item);
  }
}

// Results rendering
function renderResults(messages, searchText) {
  if (messages.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-results">
        <div class="empty-icon">📭</div>
        <p>No messages found</p>
      </div>
    `;
    return;
  }

  const tableHtml = `
    <table class="messages-table">
      <thead>
        <tr>
          <th class="col-id">ID</th>
          <th class="col-timestamp">Timestamp</th>
          <th class="col-contact">Contact</th>
          <th class="col-sender">Sender</th>
          <th class="col-direction">Dir</th>
          <th class="col-type">Type</th>
          <th class="col-content">Content</th>
        </tr>
      </thead>
      <tbody>
        ${messages.map(msg => renderMessageRow(msg, searchText)).join('')}
      </tbody>
    </table>
  `;

  resultsContainer.innerHTML = tableHtml;
}

function renderMessageRow(msg, searchText) {
  const content = escapeHtml(msg.content || '[No content]');
  const highlightedContent = searchText
    ? highlightText(content, searchText)
    : content;

  return `
    <tr>
      <td class="col-id">${msg.id}</td>
      <td class="col-timestamp">${formatDateTime(msg.timestamp)}</td>
      <td class="col-contact">${formatJid(msg.remote_jid)}</td>
      <td class="col-sender">${escapeHtml(msg.sender_name || '-')}</td>
      <td class="col-direction">
        <span class="direction-${msg.is_from_me ? 'out' : 'in'}">
          ${msg.is_from_me ? 'OUT' : 'IN'}
        </span>
      </td>
      <td class="col-type">
        <span class="type-badge ${msg.message_type}">${msg.message_type}</span>
      </td>
      <td class="col-content">${highlightedContent}</td>
    </tr>
  `;
}

function updatePagination() {
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function updateResultsCount() {
  const remoteJid = contactValue.value;
  const searchText = searchInput.value.trim();

  if (totalResults === 0) {
    resultsCount.textContent = 'No messages found';
  } else {
    let text = `${totalResults} message${totalResults !== 1 ? 's' : ''} found`;
    if (remoteJid) {
      text += ` for ${formatJid(remoteJid)}`;
    }
    if (searchText) {
      text += ` matching "${searchText}"`;
    }
    resultsCount.textContent = text;
  }
}

function showLoading(show) {
  loading.classList.toggle('hidden', !show);
}

// Search function
async function performSearch(page = 1) {
  const remoteJid = contactValue.value;
  const searchText = searchInput.value.trim();
  const sortOrder = sortSelect.value;

  // Require at least a contact or search text
  if (!remoteJid && !searchText) {
    resultsContainer.innerHTML = `
      <div class="empty-results">
        <div class="empty-icon">🔍</div>
        <p>Select a contact to see messages or enter a search term</p>
      </div>
    `;
    resultsCount.textContent = 'Select a contact or enter a search term';
    return;
  }

  const result = await searchMessages(remoteJid, searchText, page, sortOrder);

  if (result.success) {
    currentPage = result.pagination.page;
    totalPages = result.pagination.totalPages;
    totalResults = result.pagination.total;

    renderResults(result.data, searchText);
    updatePagination();
    updateResultsCount();
  } else {
    resultsContainer.innerHTML = `
      <div class="empty-results">
        <div class="empty-icon">⚠️</div>
        <p>Error loading messages</p>
      </div>
    `;
  }
}

// Helper functions
function formatJid(jid) {
  if (!jid) return 'Unknown';
  return jid.split('@')[0];
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function highlightText(text, searchTerm) {
  if (!searchTerm) return text;
  const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
  return text.replace(regex, '<span class="highlight">$1</span>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Event Listeners
contactInput.addEventListener('input', () => {
  showDropdown();
});

contactInput.addEventListener('focus', () => {
  showDropdown();
});

contactInput.addEventListener('keydown', (e) => {
  if (contactDropdown.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      showDropdown();
      e.preventDefault();
    }
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      navigateDropdown('down');
      e.preventDefault();
      break;
    case 'ArrowUp':
      navigateDropdown('up');
      e.preventDefault();
      break;
    case 'Enter':
      if (selectedIndex >= 0) {
        selectCurrentItem();
        e.preventDefault();
      }
      break;
    case 'Escape':
      hideDropdown();
      break;
  }
});

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!contactInput.contains(e.target) && !contactDropdown.contains(e.target)) {
    hideDropdown();
  }
});

searchBtn.addEventListener('click', () => {
  currentPage = 1;
  performSearch(1);
});

sortSelect.addEventListener('change', () => {
  currentPage = 1;
  performSearch(1);
});

emailBtn.addEventListener('click', sendConversationEmail);

searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    currentPage = 1;
    performSearch(1);
  }
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    performSearch(currentPage - 1);
  }
});

nextBtn.addEventListener('click', () => {
  if (currentPage < totalPages) {
    performSearch(currentPage + 1);
  }
});

// Initialize
async function initialize() {
  // Get status
  const status = await fetchStatus();
  updateStatus(status);

  // Load conversations for autocomplete
  conversations = await fetchConversations();

  // Poll status
  setInterval(async () => {
    const status = await fetchStatus();
    updateStatus(status);
  }, 5000);
}

document.addEventListener('DOMContentLoaded', initialize);
