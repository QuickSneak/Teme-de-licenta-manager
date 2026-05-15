const expectedRoleByPath = {
  '/dashboard.html': 'student',
  '/professors.html': 'student',
  '/propose.html': 'student',
  '/profile.html': 'student',
  '/professor-dashboard.html': 'professor',
  '/professor-proposals.html': 'professor',
  '/professor-profile.html': 'professor',
  '/secretary-dashboard.html': 'secretary'
};

const authStyle = document.createElement('style');
authStyle.textContent = `
  .auth-btn {
    min-width: 82px;
    height: 40px;
    padding: 0 14px;
    border-radius: 10px;
    border: 1px solid var(--border, rgba(17, 24, 39, 0.12));
    background: var(--surface, #fff);
    color: var(--text, #111827);
    font-weight: 850;
    cursor: pointer;
  }
`;
document.head.appendChild(authStyle);

async function portalLogout() {
  const response = await fetch('/logout', { method: 'POST' });
  const data = await response.json().catch(() => ({ redirect: '/login.html' }));
  window.location.href = data.redirect || '/login.html';
}

window.portalAuthReady = (async () => {
  const expectedRole = expectedRoleByPath[window.location.pathname];
  const authButton = document.getElementById('authAction');

  const response = await fetch('/me');
  if (!response.ok) {
    if (authButton) {
      authButton.textContent = 'Login';
      authButton.addEventListener('click', () => {
        window.location.href = '/login.html';
      });
    }

    if (expectedRole) window.location.href = '/login.html';
    return null;
  }

  const data = await response.json();

  if (expectedRole && data.user.role !== expectedRole) {
    window.location.href = data.redirect || '/login.html';
    return data;
  }

  if (authButton) {
    authButton.textContent = 'Logout';
    authButton.addEventListener('click', portalLogout);
  }

  return data;
})();
