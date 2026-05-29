document.addEventListener('DOMContentLoaded', () => {
  const body = document.body;
  const form = document.getElementById('registerForm');
  const roleInput = document.getElementById('role');
  const roleButtons = document.querySelectorAll('.role-btn');
  const themeToggle = document.getElementById('themeToggle');
  const moonOption = document.querySelector('.theme-option.moon');
  const sunOption = document.querySelector('.theme-option.sun');
  const modeIcon = document.getElementById('modeIcon');
  const modeText = document.getElementById('modeText');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');

  function setTheme(theme) {
    const isDark = theme === 'dark';

    body.classList.toggle('dark', isDark);
    moonOption.classList.toggle('active', isDark);
    sunOption.classList.toggle('active', !isDark);

    modeIcon.textContent = isDark ? '\u263e' : '\u2600';
    modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';

    localStorage.setItem('academicPortalTheme', theme);
    localStorage.setItem('studentInterfaceTheme', theme);
    localStorage.setItem('professorInterfaceTheme', theme);
    localStorage.setItem('secretaryInterfaceTheme', theme);
  }

  function showToast(message) {
    toastText.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3600);
  }

  themeToggle.addEventListener('click', () => {
    const nextTheme = body.classList.contains('dark') ? 'light' : 'dark';
    setTheme(nextTheme);
  });

  roleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      roleInput.value = button.dataset.role;

      roleButtons.forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });

  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      const isPassword = input.type === 'password';

      input.type = isPassword ? 'text' : 'password';
      button.textContent = isPassword ? '\u25cc' : '\u25c9';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
      confirmPassword: document.getElementById('confirmPassword').value,
      role: roleInput.value
    };

    const response = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      showToast(data.error || 'Registration failed.');
      return;
    }

    showToast(data.message || 'Check email to verify account.');
    form.reset();
    roleInput.value = 'student';
    roleButtons.forEach((item) => item.classList.toggle('active', item.dataset.role === 'student'));
  });

  const savedTheme =
    localStorage.getItem('academicPortalTheme') ||
    localStorage.getItem('studentInterfaceTheme') ||
    localStorage.getItem('professorInterfaceTheme') ||
    localStorage.getItem('secretaryInterfaceTheme') ||
    'light';

  setTheme(savedTheme);
});
