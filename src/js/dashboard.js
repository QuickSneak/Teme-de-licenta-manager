document.addEventListener('DOMContentLoaded', async () => {
  const expectedRoleByPath = {
    '/dashboard.html': 'student',
    '/professor-dashboard.html': 'professor',
    '/secretary-dashboard.html': 'secretary'
  };

  async function logout() {
    const response = await fetch('/logout', { method: 'POST' });
    const data = await response.json().catch(() => ({ redirect: '/login.html' }));
    window.location.href = data.redirect || '/login.html';
  }

  const logoutButton = document.getElementById('logoutButton');
  if (logoutButton) logoutButton.addEventListener('click', logout);

  const response = await fetch('/me');
  if (!response.ok) {
    window.location.href = '/login.html';
    return;
  }

  const data = await response.json();
  const expectedRole = expectedRoleByPath[window.location.pathname];

  if (expectedRole && data.user.role !== expectedRole) {
    window.location.href = data.redirect || '/login.html';
    return;
  }

  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const faculty = document.getElementById('faculty');
  const specialty = document.getElementById('specialty');

  if (userName) userName.textContent = data.user.name || '';
  if (userEmail) userEmail.textContent = data.user.email || '';
  if (faculty) faculty.textContent = data.user.faculty || '';
  if (specialty) specialty.textContent = data.user.specialty || '';
});
