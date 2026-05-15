const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const moonOption = document.querySelector('.theme-option.moon');
const sunOption = document.querySelector('.theme-option.sun');
const modeIcon = document.getElementById('modeIcon');
const modeText = document.getElementById('modeText');
const darkChoice = document.getElementById('darkChoice');
const lightChoice = document.getElementById('lightChoice');

function setTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);
  moonOption?.classList.toggle('active', isDark);
  sunOption?.classList.toggle('active', !isDark);
  darkChoice?.classList.toggle('active', isDark);
  lightChoice?.classList.toggle('active', !isDark);
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

function setValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || 'Not recorded';
}

async function loadProfile() {
  const response = await fetch('/api/profile');
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.user) return;

  const user = data.user;
  const facultyNames = user.professorFaculties?.map((faculty) => faculty.name).join(', ') || 'No faculties assigned';
  const specializations = user.professorSpecializations || [];

  setValue('fullName', user.name);
  setValue('bio', 'Professor account information is managed by the academic system.');
  setValue('department', facultyNames);
  setValue('teams', user.email);

  const countPill = document.querySelector('.section-title-wrap .day-pill');
  if (countPill) countPill.textContent = `${specializations.length} specialisations`;

  const row = document.querySelector('.specialisation-row');
  if (row) {
    row.innerHTML = specializations.length
      ? specializations
          .map(
            (item) => `
              <article class="specialisation-card active">
                <span class="specialisation-icon">#</span>
                <div>
                  <h3 class="specialisation-title">${escapeHtml(item.name)}</h3>
                  <p class="specialisation-desc">${escapeHtml(item.faculty?.name || 'Faculty not assigned')}</p>
                </div>
              </article>
            `
          )
          .join('')
      : '<p class="section-text">No specialisations assigned yet.</p>';
  }
}

document
  .querySelectorAll('[data-edit-section], .edit-btn, .office-edit, .profile-footer, .camera-btn, .change-photo-btn')
  .forEach((element) => element.remove());
document.querySelectorAll('.control, .textarea').forEach((control) => {
  control.disabled = true;
  control.classList.add('locked');
});

themeToggle?.addEventListener('click', () => setTheme(body.classList.contains('dark') ? 'light' : 'dark'));
darkChoice?.addEventListener('click', () => setTheme('dark'));
lightChoice?.addEventListener('click', () => setTheme('light'));

setTheme(localStorage.getItem('professorInterfaceTheme') || 'light');
window.portalAuthReady?.then(() => loadProfile());
