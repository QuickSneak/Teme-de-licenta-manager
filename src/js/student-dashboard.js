const studentDashboardBody = document.body;
const studentThemeToggle = document.getElementById('themeToggle');
const studentMoonOption = document.querySelector('.theme-option.moon');
const studentSunOption = document.querySelector('.theme-option.sun');
const studentModeIcon = document.getElementById('modeIcon');
const studentModeText = document.getElementById('modeText');

function setStudentTheme(theme) {
  const isDark = theme === 'dark';
  studentDashboardBody.classList.toggle('dark', isDark);
  studentMoonOption?.classList.toggle('active', isDark);
  studentSunOption?.classList.toggle('active', !isDark);
  if (studentModeIcon) studentModeIcon.textContent = isDark ? 'Dark' : 'Light';
  if (studentModeText) studentModeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
  localStorage.setItem('studentInterfaceTheme', theme);
}

function dashboardEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function findPanelList(title) {
  return Array.from(document.querySelectorAll('.panel')).find((panel) =>
    panel.querySelector('.panel-title')?.textContent?.trim() === title
  )?.querySelector('.compact-list');
}

async function loadAssignment() {
  const list = document.getElementById('confirmedTopicList');
  if (!list) return;

  const response = await fetch('/api/student/assignment');
  const data = await response.json().catch(() => ({ assignment: null }));
  const assignment = data.assignment;

  if (!assignment) return;

  list.innerHTML = `
    <article class="data-row">
      <span class="mini-icon green">✓</span>
      <div class="row-main">
        <p class="row-title">${dashboardEscape(assignment.title)}</p>
        <p class="row-subtitle">${dashboardEscape(assignment.professor?.name || '')} · ${dashboardEscape(assignment.specialization || '')}</p>
      </div>
      <span class="status-pill approved">${dashboardEscape(assignment.status)}</span>
      <button class="view-btn" type="button" id="requestChangeBtn">Change</button>
      <button class="view-btn" type="button" id="abandonAssignmentBtn">Abandon</button>
    </article>
  `;

  document.getElementById('abandonAssignmentBtn')?.addEventListener('click', async () => {
    if (!confirm('Abandon this confirmed topic?')) return;
    const abandonResponse = await fetch(`/api/student/assignments/${assignment.id}/abandon`, { method: 'POST' });
    if (!abandonResponse.ok) {
      const error = await abandonResponse.json().catch(() => ({}));
      alert(error.error || 'Could not abandon assignment.');
      return;
    }
    window.location.reload();
  });

  document.getElementById('requestChangeBtn')?.addEventListener('click', async () => {
    const title = prompt('New topic title', assignment.title);
    if (!title) return;
    const description = prompt('New topic details', assignment.description || '') ?? '';
    const changeResponse = await fetch(`/api/student/assignments/${assignment.id}/change-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, description })
    });
    const result = await changeResponse.json().catch(() => ({}));
    alert(changeResponse.ok ? 'Change request sent.' : result.error || 'Could not send change request.');
  });
}

async function loadRequests() {
  const response = await fetch('/api/student/requests');
  const data = await response.json().catch(() => ({ requests: [] }));
  const requests = data.requests || [];
  const claimsList = findPanelList('My Claims');
  const proposalsList = findPanelList('My Proposals');
  const renderRow = (request) => `
    <article class="data-row">
      <span class="mini-icon ${request.status === 'accepted' ? 'green' : request.status === 'rejected' ? 'red' : 'orange'}">•</span>
      <div class="row-main">
        <p class="row-title">${dashboardEscape(request.title || 'Untitled request')}</p>
        <p class="row-subtitle">${dashboardEscape(request.professor?.name || '')}</p>
      </div>
      <span class="status-pill ${request.status === 'accepted' ? 'approved' : request.status === 'rejected' ? 'rejected' : 'pending'}">
        ${dashboardEscape(request.status)}
      </span>
    </article>
  `;

  const claims = requests.filter((request) => request.type === 'topic_claim');
  const proposals = requests.filter((request) => request.type === 'custom_proposal');

  if (claimsList) {
    claimsList.innerHTML = claims.length
      ? claims.map(renderRow).join('')
      : '<article class="data-row"><span class="mini-icon gray">-</span><div class="row-main"><p class="row-title">No topic claims yet</p></div></article>';
  }

  if (proposalsList) {
    proposalsList.innerHTML = proposals.length
      ? proposals.map(renderRow).join('')
      : '<article class="data-row"><span class="mini-icon gray">-</span><div class="row-main"><p class="row-title">No custom proposals yet</p></div></article>';
  }
}

function renderNotifications(items) {
  const list = document.querySelector('.notifications-list');
  const badge = document.querySelector('.badge');
  const notificationCount = document.getElementById('notificationCount');
  if (badge) badge.textContent = String(items.length);
  if (notificationCount) notificationCount.textContent = String(items.length);
  if (!list) return;

  list.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="notification-row">
              <span class="mini-icon blue">!</span>
              <div class="row-main">
                <p class="row-title">${dashboardEscape(item.title)}</p>
                <p class="row-subtitle">${dashboardEscape(item.message)}</p>
              </div>
              <p class="row-time">${new Date(item.createdAt).toLocaleString()}</p>
              <button class="view-btn" type="button" data-delete-notification="${item.id}">Remove</button>
            </article>
          `
        )
        .join('')
    : '<article class="notification-row"><span class="mini-icon gray">i</span><div class="row-main"><p class="row-title">No notifications</p></div></article>';

  list.querySelectorAll('[data-delete-notification]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetch(`/api/notifications/${button.dataset.deleteNotification}`, { method: 'DELETE' });
      await loadNotifications();
    });
  });
}

async function loadNotifications() {
  const response = await fetch('/api/notifications');
  const data = await response.json().catch(() => ({ notifications: [] }));
  if (response.ok) renderNotifications(data.notifications || []);
}

studentThemeToggle?.addEventListener('click', () => {
  setStudentTheme(studentDashboardBody.classList.contains('dark') ? 'light' : 'dark');
});
setStudentTheme(localStorage.getItem('studentInterfaceTheme') || 'light');

window.portalAuthReady?.then(async () => {
  await loadAssignment();
  await loadRequests();
  await loadNotifications();
});
