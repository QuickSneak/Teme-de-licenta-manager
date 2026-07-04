document.addEventListener('DOMContentLoaded', () => {
  const requestForm = document.getElementById('requestResetForm');
  const setPasswordForm = document.getElementById('setPasswordForm');
  const message = document.getElementById('message');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (params.get('error')) {
    message.textContent = 'The reset link is invalid or expired.';
  }

  if (token) {
    requestForm.hidden = true;
    setPasswordForm.hidden = false;
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const response = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('resetEmail').value.trim(),
        redirectTo: '/reset-password.html'
      })
    });

    const data = await response.json().catch(() => ({}));
    message.textContent = data.message || 'If this email exists, check your inbox for the reset link.';
  });

  setPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmNewPassword) {
      message.textContent = 'Passwords do not match.';
      return;
    }

    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      message.textContent = data.message || data.error || 'Password reset failed.';
      return;
    }

    window.location.href = '/login.html?reset=1';
  });
});
