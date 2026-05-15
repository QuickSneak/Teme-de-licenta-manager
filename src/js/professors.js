const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const moonOption = document.querySelector('.theme-option.moon');
const sunOption = document.querySelector('.theme-option.sun');
const modeIcon = document.getElementById('modeIcon');
const modeText = document.getElementById('modeText');
const collapseBtn = document.getElementById('collapseBtn');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const professorList = document.querySelector('.prof-list');
const professorStack = document.querySelector('.professors-stack');
document.querySelector('.notifications-card')?.remove();

function setTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);
  moonOption?.classList.toggle('active', isDark);
  sunOption?.classList.toggle('active', !isDark);
  if (modeIcon) modeIcon.textContent = isDark ? 'Moon' : 'Sun';
  if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
  localStorage.setItem('studentInterfaceTheme', theme);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function claimTopic(topicId, button) {
  button.disabled = true;
  button.textContent = 'Sending...';

  const response = await fetch('/api/student/topic-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topicId })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    button.disabled = false;
    button.textContent = 'Claim topic';
    alert(data.error || 'Could not submit topic claim.');
    return;
  }

  button.textContent = 'Pending';
  await loadProfessors();
}

function bindProfessorInteractions() {
  document.querySelectorAll('.professor-header').forEach((header) => {
    header.addEventListener('click', () => {
      const card = header.closest('.professor-card');
      document.querySelectorAll('.professor-card').forEach((item) => {
        if (item !== card) item.classList.remove('open');
      });
      card?.classList.toggle('open');

      const professorId = card?.dataset.professorCard;
      document.querySelectorAll('.prof-link').forEach((link) => {
        link.classList.toggle('active', link.dataset.professor === professorId);
      });
    });
  });

  document.querySelectorAll('.prof-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const targetCard = document.querySelector(`[data-professor-card="${link.dataset.professor}"]`);
      document.querySelectorAll('.prof-link').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.professor-card').forEach((card) => card.classList.remove('open'));
      link.classList.add('active');
      targetCard?.classList.add('open');
      targetCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      body.classList.remove('mobile-sidebar-open');
    });
  });

  document.querySelectorAll('[data-claim-topic]').forEach((button) => {
    button.addEventListener('click', () => claimTopic(Number(button.dataset.claimTopic), button));
  });
}

async function loadProfessors() {
  const response = await fetch('/api/student/professors');
  const data = await response.json().catch(() => ({ professors: [] }));
  const professors = data.professors || [];

  if (!professors.length) {
    professorList.innerHTML = '<span class="prof-link active">No professors available</span>';
    professorStack.innerHTML = '<p class="page-subtitle">No topics are available for your specialization yet.</p>';
    return;
  }

  professorList.innerHTML = professors
    .map(
      (professor, index) => `
        <a href="#" class="prof-link ${index === 0 ? 'active' : ''}" data-professor="${escapeHtml(professor.id)}">
          <span>${escapeHtml(professor.name)}</span>
          <span class="arrow">›</span>
        </a>
      `
    )
    .join('');

  professorStack.innerHTML = professors
    .map((professor, index) => {
      const availableCount = professor.topics.filter((topic) => topic.status === 'available').length;
      const topicsHtml = professor.topics.length
        ? professor.topics
            .map(
              (topic) => `
                <article class="topic-card">
                  <h3>${escapeHtml(topic.title)}</h3>
                  <p>${escapeHtml(topic.description || 'No description provided.')}</p>
                  <div class="topic-footer">
                    <span class="status ${topic.status === 'available' ? 'available' : 'full'}">${escapeHtml(topic.status)}</span>
                    <span class="spots">${topic.status === 'available' ? 'Open' : 'Reserved'}</span>
                  </div>
                  <button class="details-btn" data-claim-topic="${topic.id}" ${topic.status !== 'available' ? 'disabled' : ''}>
                    ${topic.status === 'available' ? 'Claim topic' : 'Unavailable'}
                  </button>
                </article>
              `
            )
            .join('')
        : '<p class="page-subtitle">This professor has no active topics for your specialization.</p>';

      return `
        <article class="professor-card ${index === 0 ? 'open' : ''}" data-professor-card="${escapeHtml(professor.id)}">
          <button class="professor-header">
            <span class="avatar">●</span>
            <span>
              <span class="professor-name">${escapeHtml(professor.name)}</span>
              <span class="professor-meta">${professor.topics.length} theses | ${availableCount} available</span>
            </span>
            <span class="chevron">⌄</span>
          </button>
          <div class="topics">${topicsHtml}</div>
        </article>
      `;
    })
    .join('');

  bindProfessorInteractions();
}

themeToggle?.addEventListener('click', () => {
  setTheme(body.classList.contains('dark') ? 'light' : 'dark');
});

collapseBtn?.addEventListener('click', () => {
  if (window.innerWidth <= 820) {
    body.classList.remove('mobile-sidebar-open');
    return;
  }
  body.classList.toggle('sidebar-collapsed');
});

mobileMenuBtn?.addEventListener('click', () => {
  body.classList.toggle('mobile-sidebar-open');
});

document.addEventListener('click', (event) => {
  const clickedInsideSidebar = event.target.closest('.sidebar');
  const clickedMenuButton = event.target.closest('#mobileMenuBtn');
  if (!clickedInsideSidebar && !clickedMenuButton && window.innerWidth <= 820) {
    body.classList.remove('mobile-sidebar-open');
  }
});

setTheme(localStorage.getItem('studentInterfaceTheme') || 'light');
window.portalAuthReady?.then(() => loadProfessors());
