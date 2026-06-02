(function () {
  const redirectByRole = {
    student: '/dashboard.html',
    professor: '/professor-dashboard.html',
    secretary: '/secretary-dashboard.html'
  };

  async function requireRole(expectedRole) {
    const response = await fetch('/me');
    if (!response.ok) {
      window.location.href = '/login.html';
      return null;
    }

    const data = await response.json();
    if (expectedRole && data.user.role !== expectedRole) {
      window.location.href = data.redirect || redirectByRole[data.user.role] || '/login.html';
      return null;
    }

    return data;
  }

  window.authGuard = {
    requireRole,
    ready: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    const expectedRole = document.body.dataset.requiredRole;
    if (!expectedRole) return;

    window.authGuard.ready = requireRole(expectedRole);
  });
})();
