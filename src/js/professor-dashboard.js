const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const moonOption = document.querySelector('.theme-option.moon');
const sunOption = document.querySelector('.theme-option.sun');
const modeIcon = document.getElementById('modeIcon');
const modeText = document.getElementById('modeText');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
const sidebarContent = document.getElementById('professorSidebarContent');
const addTopicButton = document.getElementById('addTopicButton');
let dashboardData = { topics: [], assignments: [], specializations: [] };
let editingTopicId = null;

function setTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);
  moonOption?.classList.toggle('active', isDark);
  sunOption?.classList.toggle('active', !isDark);
  if (modeIcon) modeIcon.textContent = isDark ? 'Dark' : 'Light';
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

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

function findToolbar(title) {
  return Array.from(document.querySelectorAll('.section-toolbar')).find((toolbar) =>
    toolbar.querySelector('.section-title-main')?.textContent?.trim() === title
  );
}

function groupedSpecializations() {
  const groups = new Map();
  for (const specialization of dashboardData.specializations || []) {
    const faculty = specialization.faculty || { id: 'none', name: 'Unassigned faculty' };
    if (!groups.has(faculty.id)) groups.set(faculty.id, { faculty, specializations: [] });
    groups.get(faculty.id).specializations.push(specialization);
  }
  return Array.from(groups.values());
}

function renderSidebar() {
  if (!sidebarContent) return;
  const groups = groupedSpecializations();
  sidebarContent.innerHTML = groups.length
    ? groups
        .map(
          (group) => `
            <section class="faculty-group">
              <h2 class="faculty-title">${escapeHtml(group.faculty.name)}</h2>
              ${group.specializations
                .map((specialization) => {
                  const id = `spec-${specialization.id}-${slug(specialization.name)}`;
                  return `
                    <a href="#${id}" class="sidebar-link">
                      <span class="sidebar-link-icon">#</span>
                      <span class="sidebar-link-text">${escapeHtml(specialization.name)}</span>
                    </a>
                  `;
                })
                .join('')}
            </section>
          `
        )
        .join('')
    : '<section class="faculty-group"><h2 class="faculty-title">No specialisations assigned</h2></section>';

  sidebarContent.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', () => body.classList.remove('mobile-sidebar-open'));
  });
}

function setDevelopmentStats() {
  document.querySelectorAll('.stat-card').forEach((card) => {
    const label = card.querySelector('.stat-label');
    const number = card.querySelector('.stat-number');
    if (label) label.textContent = 'In development';
    if (number) number.textContent = '-';
  });
}

function ensureTopicForm() {
  let form = document.getElementById('topicFormPanel');
  if (form) return form;

  const toolbar = findToolbar('My Theses');
  form = document.createElement('section');
  form.className = 'panel';
  form.id = 'topicFormPanel';
  form.style.display = 'none';
  form.innerHTML = `
    <div class="panel-head">
      <div class="panel-title-wrap">
        <span class="panel-icon">+</span>
        <h2 class="panel-title" id="topicFormTitle">Add Thesis</h2>
      </div>
    </div>
    <form id="topicForm" style="display:grid; gap:12px; padding:18px;">
      <label>
        <span class="stat-label">Specialisation</span>
        <select id="topicSpecialization" class="control" required></select>
      </label>
      <label>
        <span class="stat-label">Title</span>
        <input id="topicTitle" class="control" type="text" required />
      </label>
      <label>
        <span class="stat-label">Description</span>
        <textarea id="topicDescription" class="control" rows="4" required></textarea>
      </label>
      <div class="row-actions">
        <button class="small-btn" type="button" id="topicFormCancel">Cancel</button>
        <button class="small-btn" type="submit">Save thesis</button>
      </div>
    </form>
  `;
  toolbar?.after(form);
  form.querySelector('#topicFormCancel')?.addEventListener('click', closeTopicForm);
  form.querySelector('#topicForm')?.addEventListener('submit', saveTopic);
  return form;
}

function openTopicForm(topic) {
  const form = ensureTopicForm();
  const specializationSelect = form.querySelector('#topicSpecialization');
  specializationSelect.innerHTML = (dashboardData.specializations || [])
    .map((item) => `<option value="${item.id}">${escapeHtml(item.faculty?.name || 'Faculty')} / ${escapeHtml(item.name)}</option>`)
    .join('');

  if (!dashboardData.specializations?.length) {
    alert('No specialisations are assigned to this professor.');
    return;
  }

  editingTopicId = topic?.id ?? null;
  form.querySelector('#topicFormTitle').textContent = editingTopicId ? 'Edit Thesis' : 'Add Thesis';
  form.querySelector('#topicTitle').value = topic?.title || '';
  form.querySelector('#topicDescription').value = topic?.description || '';
  specializationSelect.value = String(topic?.specialization?.id || dashboardData.specializations[0].id);
  specializationSelect.disabled = Boolean(editingTopicId);
  form.style.display = 'block';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeTopicForm() {
  const form = document.getElementById('topicFormPanel');
  editingTopicId = null;
  if (form) form.style.display = 'none';
}

async function saveTopic(event) {
  event.preventDefault();
  const title = document.getElementById('topicTitle').value.trim();
  const description = document.getElementById('topicDescription').value.trim();
  const specializationId = Number(document.getElementById('topicSpecialization').value);
  const method = editingTopicId ? 'PATCH' : 'POST';
  const url = editingTopicId ? `/api/professor/topics/${editingTopicId}` : '/api/professor/topics';
  const payload = editingTopicId ? { title, description } : { title, description, specializationId };

  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    alert(data.error || 'Could not save thesis.');
    return;
  }

  closeTopicForm();
  await loadDashboard();
  await loadNotifications();
}

async function updateTopicStatus(topicId, status) {
  const response = await fetch(`/api/professor/topics/${topicId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) alert(data.error || 'Could not update thesis.');
  await loadDashboard();
  await loadNotifications();
}

function topicRowsForSpecialization(specializationId) {
  const rows = dashboardData.topics.filter((topic) => topic.specialization?.id === specializationId);
  if (!rows.length) {
    return '<article class="thesis-row"><div><h3 class="thesis-title">No theses for this specialisation yet</h3></div></article>';
  }

  return rows
    .map(
      (topic) => `
        <article class="thesis-row">
          <div>
            <h3 class="thesis-title">${escapeHtml(topic.title)}</h3>
            <p class="thesis-desc">${escapeHtml(topic.description || 'No description provided.')}</p>
          </div>
          <span class="status-pill ${topic.status === 'available' ? 'available' : 'full'}">${escapeHtml(topic.status)}</span>
          <div class="row-actions">
            ${
              topic.status !== 'reserved'
                ? `<button class="small-btn" type="button" data-edit-topic="${topic.id}">Edit</button>
                   <button class="small-btn danger" type="button" data-topic-status="${topic.status === 'inactive' ? 'available' : 'inactive'}" data-topic-id="${topic.id}">
                     ${topic.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
                   </button>`
                : '<span class="stat-label">Locked</span>'
            }
          </div>
        </article>
      `
    )
    .join('');
}

function renderTheses() {
  document.querySelectorAll('.faculty-block[data-runtime-topics="true"]').forEach((block) => block.remove());
  ensureTopicForm();
  const groups = groupedSpecializations();
  const afterNode = document.getElementById('topicFormPanel') || findToolbar('My Theses');

  let insertAfter = afterNode;
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'faculty-block';
    section.dataset.runtimeTopics = 'true';
    section.innerHTML = `
      <button class="faculty-block-head collapsible-trigger" type="button">
        <span class="faculty-title-left">
          <span>${escapeHtml(group.faculty.name)}</span>
        </span>
        <span class="collapse-arrow">Open</span>
      </button>
      <div class="collapsible-content">
        ${group.specializations
          .map((specialization) => {
            const id = `spec-${specialization.id}-${slug(specialization.name)}`;
            return `
              <section class="specialisation-block open" id="${id}">
                <button class="specialisation-head collapsible-trigger" type="button">
                  <span class="specialisation-name">
                    <span>${escapeHtml(specialization.name)}</span>
                  </span>
                  <span class="collapse-arrow">Open</span>
                </button>
                <div class="thesis-list collapsible-content">
                  ${topicRowsForSpecialization(specialization.id)}
                </div>
              </section>
            `;
          })
          .join('')}
      </div>
    `;
    insertAfter?.after(section);
    insertAfter = section;
  }

  if (!groups.length) {
    const empty = document.createElement('section');
    empty.className = 'faculty-block';
    empty.dataset.runtimeTopics = 'true';
    empty.innerHTML = '<div class="thesis-list collapsible-content"><article class="thesis-row"><div><h3 class="thesis-title">No specialisations assigned</h3></div></article></div>';
    insertAfter?.after(empty);
  }

  document.querySelectorAll('[data-edit-topic]').forEach((button) => {
    button.addEventListener('click', () => {
      const topic = dashboardData.topics.find((item) => String(item.id) === button.dataset.editTopic);
      if (topic) openTopicForm(topic);
    });
  });
  document.querySelectorAll('[data-topic-status]').forEach((button) => {
    button.addEventListener('click', () => updateTopicStatus(Number(button.dataset.topicId), button.dataset.topicStatus));
  });
  document.querySelectorAll('.faculty-block > .collapsible-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => trigger.closest('.faculty-block')?.classList.toggle('closed'));
  });
  document.querySelectorAll('.specialisation-block > .collapsible-trigger').forEach((trigger) => {
    trigger.addEventListener('click', () => trigger.closest('.specialisation-block')?.classList.toggle('closed'));
  });
}

function renderStudents() {
  const studentsGrid = document.querySelector('.students-grid');
  if (!studentsGrid) return;

  studentsGrid.innerHTML = dashboardData.assignments?.length
    ? dashboardData.assignments
        .map(
          (assignment) => `
            <article class="student-card">
              <div class="student-head">
                <span class="avatar">${escapeHtml((assignment.student?.name || '?').slice(0, 2).toUpperCase())}</span>
                <div>
                  <h3 class="student-name">${escapeHtml(assignment.student?.name || 'Unknown student')}</h3>
                  <p class="student-topic">${escapeHtml(assignment.title)}</p>
                </div>
              </div>
              <div class="student-meta">
                <p><strong>Type:</strong> ${assignment.topic?.origin === 'student_proposal' ? 'Custom Thesis' : 'Claimed Thesis'}</p>
                <p><strong>Specialisation:</strong> ${escapeHtml(assignment.specialization || '')}</p>
                <p><strong>Status:</strong> <span style="color: var(--green); font-weight: 950;">Approved</span></p>
              </div>
              <button class="message-btn" type="button">In development</button>
            </article>
          `
        )
        .join('')
    : '<p class="page-subtitle">No accepted students yet.</p>';
}

function renderDashboard(data) {
  dashboardData = {
    topics: data.topics || [],
    assignments: data.assignments || [],
    specializations: data.specializations || []
  };
  renderSidebar();
  renderTheses();
  renderStudents();
}

function renderNotifications(items) {
  const list = document.querySelector('.notifications-list');
  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = String(items.length);
  if (!list) return;

  list.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="notification-row">
              <span class="mini-icon accent">!</span>
              <div>
                <p class="row-title">${escapeHtml(item.title)}</p>
                <p class="row-subtitle">${escapeHtml(item.message)}</p>
              </div>
              <p class="row-time">${new Date(item.createdAt).toLocaleString()}</p>
              <button class="small-btn" type="button" data-delete-notification="${item.id}">Remove</button>
            </article>
          `
        )
        .join('')
    : '<article class="notification-row"><span class="mini-icon accent">i</span><div><p class="row-title">No notifications</p></div></article>';

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

async function loadDashboard() {
  const response = await fetch('/api/professor/dashboard');
  const data = await response.json().catch(() => ({ topics: [], assignments: [], specializations: [] }));
  if (!response.ok) {
    alert(data.error || 'Could not load professor dashboard.');
    return;
  }
  renderDashboard(data);
}

addTopicButton?.addEventListener('click', async () => {
  if (!dashboardData.specializations?.length) {
    await loadDashboard();
  }
  openTopicForm(null);
});
themeToggle?.addEventListener('click', () => setTheme(body.classList.contains('dark') ? 'light' : 'dark'));
mobileMenuBtn?.addEventListener('click', () => body.classList.toggle('mobile-sidebar-open'));
collapseSidebarBtn?.addEventListener('click', () => {
  if (window.innerWidth <= 900) {
    body.classList.remove('mobile-sidebar-open');
    return;
  }
  body.classList.toggle('sidebar-collapsed');
});
document.addEventListener('click', (event) => {
  const clickedInsideSidebar = event.target.closest('.sidebar');
  const clickedMenuButton = event.target.closest('#mobileMenuBtn');
  if (!clickedInsideSidebar && !clickedMenuButton && window.innerWidth <= 900) {
    body.classList.remove('mobile-sidebar-open');
  }
});

setTheme(localStorage.getItem('professorInterfaceTheme') || 'light');
setDevelopmentStats();
ensureTopicForm();
window.portalAuthReady?.then(async () => {
  await loadDashboard();
  await loadNotifications();
});
