const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const moonOption = document.querySelector('.theme-option.moon');
const sunOption = document.querySelector('.theme-option.sun');
const modeIcon = document.getElementById('modeIcon');
const modeText = document.getElementById('modeText');
const proposalModal = document.getElementById('proposalModal');
const modalClose = document.getElementById('modalClose');
const modalTitle = document.getElementById('modalTitle');
const modalSubtitle = document.getElementById('modalSubtitle');
const modalType = document.getElementById('modalType');
const modalDescription = document.getElementById('modalDescription');
let activeDecision = null;

function setTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);
  moonOption?.classList.toggle('active', isDark);
  sunOption?.classList.toggle('active', !isDark);
  if (modeIcon) modeIcon.textContent = isDark ? 'Moon' : 'Sun';
  if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
  localStorage.setItem('professorInterfaceTheme', theme);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function closeModal() {
  proposalModal?.classList.remove('open');
  activeDecision = null;
}

async function decide(action) {
  if (!activeDecision) return;
  const path =
    activeDecision.kind === 'change'
      ? `/api/professor/change-requests/${activeDecision.id}/${action}`
      : `/api/professor/requests/${activeDecision.id}/${action}`;

  const response = await fetch(path, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) alert(data.error || 'Could not save decision.');
  closeModal();
  await loadRequests();
}

function openDecisionModal(item) {
  activeDecision = { id: item.id, kind: item.kind };
  modalTitle.textContent = item.title;
  modalSubtitle.textContent = item.subtitle;
  modalType.textContent = item.typeLabel;
  modalDescription.textContent = item.description || 'No description provided.';
  proposalModal.classList.add('open');
}

function cardHtml(item) {
  return `
    <article class="proposal-card" data-id="${item.id}" data-kind="${item.kind}">
      <div class="student-side">
        <span class="avatar">${escapeHtml((item.studentName || '?').slice(0, 2).toUpperCase())}</span>
        <div>
          <h3 class="student-name">${escapeHtml(item.studentName)}</h3>
          <span class="student-type">${escapeHtml(item.typeLabel)}</span>
        </div>
      </div>
      <div class="proposal-main">
        <h3 class="proposal-title">${escapeHtml(item.title)}</h3>
        <p class="proposal-meta">${escapeHtml(item.subtitle)}</p>
        <p class="proposal-desc">${escapeHtml(item.description)}</p>
      </div>
      <div class="proposal-actions">
        <span class="proposal-time">${escapeHtml(item.status)}</span>
        ${item.status === 'pending' ? '<span class="new-pill">Pending</span>' : ''}
        <button class="small-btn view-proposal-btn" type="button">View full proposal</button>
      </div>
    </article>
  `;
}

async function loadRequests() {
  document.querySelectorAll('.faculty-proposals').forEach((section, index) => {
    if (index > 0) section.remove();
  });
  document.querySelectorAll('.proposal-list').forEach((list, index) => {
    if (index > 0) list.innerHTML = '';
  });
  document.querySelectorAll('.history-card').forEach((card, index) => {
    if (index > 0) card.remove();
  });

  const [requestsResponse, changesResponse] = await Promise.all([
    fetch('/api/professor/requests'),
    fetch('/api/professor/change-requests')
  ]);
  const requestsData = await requestsResponse.json().catch(() => ({ requests: [] }));
  const changesData = await changesResponse.json().catch(() => ({ changeRequests: [] }));

  const requestItems = (requestsData.requests || []).map((request) => ({
    id: request.id,
    kind: 'request',
    status: request.status,
    title: request.title || 'Untitled request',
    description: request.description || '',
    studentName: request.student?.name || 'Unknown student',
    subtitle: `${request.faculty || ''} · ${request.specialization || ''}`,
    typeLabel: request.type === 'custom_proposal' ? 'Custom Proposal' : 'Topic Claim'
  }));

  const changeItems = (changesData.changeRequests || []).map((request) => ({
    id: request.id,
    kind: 'change',
    status: request.status,
    title: request.proposedTitle,
    description: request.proposedDescription || '',
    studentName: request.student?.name || 'Unknown student',
    subtitle: 'Accepted topic change request',
    typeLabel: 'Change Request'
  }));

  const items = [...requestItems, ...changeItems];
  const pending = items.filter((item) => item.status === 'pending');
  const history = items.filter((item) => item.status !== 'pending');
  const firstList = document.querySelector('.proposal-list');
  const summaryNumber = document.querySelector('.summary-number');

  if (summaryNumber) summaryNumber.textContent = String(pending.length);
  const historyHead = document.querySelector('.history-head');
  if (historyHead) historyHead.innerHTML = '<span>✓</span><span>Handled</span>';
  if (firstList) {
    firstList.innerHTML = pending.length
      ? pending.map(cardHtml).join('')
      : '<p class="proposal-desc">No pending requests.</p>';
  }

  document.querySelectorAll('.proposal-card').forEach((card) => {
    card.querySelector('.view-proposal-btn')?.addEventListener('click', () => {
      const item = pending.find(
        (candidate) => String(candidate.id) === card.dataset.id && candidate.kind === card.dataset.kind
      );
      if (item) openDecisionModal(item);
    });
  });

  const historyLists = document.querySelectorAll('.history-list');
  if (historyLists[0]) {
    historyLists[0].innerHTML = history
      .map(
        (item) => `
          <article class="history-row">
            <span class="history-avatar ${item.status === 'accepted' ? 'approved' : 'rejected'}">${escapeHtml(item.studentName.slice(0, 2).toUpperCase())}</span>
            <div>
              <p class="history-name">${escapeHtml(item.studentName)}</p>
              <p class="history-title">${escapeHtml(item.title)}</p>
              <p class="history-meta">${escapeHtml(item.typeLabel)}</p>
            </div>
            <span class="status-pill ${item.status === 'accepted' ? 'approved' : 'rejected'}">${escapeHtml(item.status)}</span>
          </article>
        `
      )
      .join('') || '<p class="proposal-desc">No handled requests yet.</p>';
  }
}

themeToggle?.addEventListener('click', () => {
  setTheme(body.classList.contains('dark') ? 'light' : 'dark');
});

modalClose?.addEventListener('click', closeModal);
proposalModal?.addEventListener('click', (event) => {
  if (event.target === proposalModal) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});
document.querySelector('.refresh-btn')?.addEventListener('click', loadRequests);
document.querySelector('.modal-btn.approve')?.addEventListener('click', () => decide('accept'));
document.querySelector('.modal-btn.reject')?.addEventListener('click', () => decide('reject'));

setTheme(localStorage.getItem('professorInterfaceTheme') || 'light');
window.portalAuthReady?.then(() => loadRequests());
