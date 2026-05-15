const body = document.body;
const themeToggle = document.getElementById('themeToggle');
const moonOption = document.querySelector('.theme-option.moon');
const sunOption = document.querySelector('.theme-option.sun');
const modeIcon = document.getElementById('modeIcon');
const modeText = document.getElementById('modeText');
const proposalForm = document.getElementById('proposalForm');
const cancelBtn = document.getElementById('cancelBtn');
const toast = document.getElementById('toast');

function setTheme(theme) {
  const isDark = theme === 'dark';
  body.classList.toggle('dark', isDark);
  moonOption?.classList.toggle('active', isDark);
  sunOption?.classList.toggle('active', !isDark);
  if (modeIcon) modeIcon.textContent = isDark ? 'Moon' : 'Sun';
  if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
  localStorage.setItem('studentInterfaceTheme', theme);
}

function validateField(fieldName, isValid) {
  document.querySelector(`[data-field="${fieldName}"]`)?.classList.toggle('error', !isValid);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setupSelects() {
  const selects = document.querySelectorAll('.select-like');

  selects.forEach((select) => {
    const value = select.querySelector('.select-value');
    const options = select.querySelectorAll('.dropdown button');

    select.addEventListener('click', (event) => {
      event.stopPropagation();
      selects.forEach((otherSelect) => {
        if (otherSelect !== select) otherSelect.classList.remove('open');
      });
      select.classList.toggle('open');
    });

    options.forEach((option) => {
      option.addEventListener('click', (event) => {
        event.stopPropagation();
        value.textContent = option.textContent.trim();
        value.dataset.selected = option.dataset.value;
        select.classList.remove('open');
        select.closest('.field')?.classList.remove('error');
      });
    });
  });
}

async function populateChoices() {
  const session = await window.portalAuthReady;
  const professorsResponse = await fetch('/api/student/professors');
  const professorsData = await professorsResponse.json().catch(() => ({ professors: [] }));

  const specializationValue = document.querySelector('[data-select="specialisation"] .select-value');
  const specializationDropdown = document.querySelector('[data-select="specialisation"] .dropdown');
  const professorDropdown = document.querySelector('[data-select="professor"] .dropdown');

  if (specializationValue && session?.user?.specialty) {
    specializationValue.textContent = session.user.specialty;
    specializationValue.dataset.selected = session.user.specialty;
  }

  if (specializationDropdown && session?.user?.specialty) {
    specializationDropdown.innerHTML = `<button type="button" data-value="${escapeHtml(session.user.specialty)}">${escapeHtml(session.user.specialty)}</button>`;
  }

  if (professorDropdown) {
    professorDropdown.innerHTML = (professorsData.professors || [])
      .map((professor) => `<button type="button" data-value="${escapeHtml(professor.id)}">${escapeHtml(professor.name)}</button>`)
      .join('');
  }

  setupSelects();
}

function showToast(message) {
  if (!toast) return;
  const text = toast.querySelector('.toast-text');
  if (text && message) text.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3400);
}

themeToggle?.addEventListener('click', () => {
  setTheme(body.classList.contains('dark') ? 'light' : 'dark');
});

document.addEventListener('click', () => {
  document.querySelectorAll('.select-like').forEach((select) => select.classList.remove('open'));
});

document.querySelectorAll('.tag-remove').forEach((button) => {
  button.addEventListener('click', () => button.closest('.tag')?.remove());
});

proposalForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = document.getElementById('title').value.trim();
  const brief = document.getElementById('brief').value.trim();
  const fullProposal = document.getElementById('fullProposal').value.trim();
  const description = [brief, fullProposal].filter(Boolean).join('\n\n');
  const specialisation = document.querySelector('[data-select="specialisation"] .select-value')?.dataset.selected;
  const professorId = document.querySelector('[data-select="professor"] .select-value')?.dataset.selected;

  validateField('title', title.length > 0);
  validateField('specialisation', Boolean(specialisation));
  validateField('professor', Boolean(professorId));
  validateField('brief', brief.length > 0);
  validateField('fullProposal', fullProposal.length > 0);

  if (!title || !specialisation || !professorId || !brief || !fullProposal) return;

  const submitButton = proposalForm.querySelector('[type="submit"]');
  submitButton.disabled = true;

  const response = await fetch('/api/student/custom-proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ professorId, title, description })
  });
  const data = await response.json().catch(() => ({}));

  submitButton.disabled = false;

  if (!response.ok) {
    alert(data.error || 'Could not submit proposal.');
    return;
  }

  proposalForm.reset();
  showToast('Your custom thesis proposal was saved for professor review.');
});

cancelBtn?.addEventListener('click', () => {
  proposalForm?.reset();
  document.querySelectorAll('.field.error').forEach((field) => field.classList.remove('error'));
  document.querySelectorAll('.select-value').forEach((value) => delete value.dataset.selected);
});

setTheme(localStorage.getItem('studentInterfaceTheme') || 'light');
populateChoices();
