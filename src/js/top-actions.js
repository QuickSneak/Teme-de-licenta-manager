(() => {
  async function logout() {
    try {
      const response = await fetch('/logout', { method: 'POST' });
      const data = await response.json().catch(() => ({ redirect: '/login.html' }));
      window.location.href = data.redirect || '/login.html';
    } catch {
      window.location.href = '/login.html';
    }
  }

  document.querySelectorAll('.logout-btn').forEach((button) => {
    button.addEventListener('click', logout);
  });
})();
