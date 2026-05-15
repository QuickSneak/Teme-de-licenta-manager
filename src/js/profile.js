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
  localStorage.setItem('studentInterfaceTheme', theme);
}

function setValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || 'Not recorded';
}

function cohortFromEmail(email) {
  const match = email?.match(/[a-z]+(\d{2})@uab\.ro$/i);
  return match ? `20${match[1]} cohort` : 'Not recorded';
}

async function loadProfile() {
  const response = await fetch('/api/profile');
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.user) return;

  const user = data.user;
  setValue('fullName', user.name);
  setValue('email', user.email);
  setValue('teams', user.email);
  setValue('faculty', user.faculty?.name);
  setValue('specialisation', user.specialization?.name);
  setValue('year', cohortFromEmail(user.email));
  setValue('groupNumber', 'Managed by secretary');
  setValue('bio', 'Student account information is managed by the academic system.');
}

document.querySelectorAll('[data-edit-section], .profile-footer').forEach((element) => element.remove());
document.querySelectorAll('.control, .textarea').forEach((control) => {
  control.disabled = true;
  control.classList.add('locked');
});

themeToggle?.addEventListener('click', () => setTheme(body.classList.contains('dark') ? 'light' : 'dark'));
darkChoice?.addEventListener('click', () => setTheme('dark'));
lightChoice?.addEventListener('click', () => setTheme('light'));

setTheme(localStorage.getItem('studentInterfaceTheme') || 'light');
window.portalAuthReady?.then(() => loadProfile());
