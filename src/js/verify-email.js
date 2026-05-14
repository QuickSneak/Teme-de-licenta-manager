document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('verifyEmailForm');
  const message = document.getElementById('message');
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');

  if (email) {
    document.getElementById('verifyEmail').value = email;
    message.textContent = 'This account is not verified. You can resend the verification email.';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const response = await fetch('/api/auth/send-verification-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('verifyEmail').value.trim(),
        callbackURL: '/login.html?verified=1'
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      message.textContent = data.message || data.error || 'Could not send verification email.';
      return;
    }

    message.textContent = 'If this account exists and is not verified, check your inbox.';
  });
});
