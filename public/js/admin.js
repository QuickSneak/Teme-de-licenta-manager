document.addEventListener('DOMContentLoaded', () => {
  const body = document.body;
  const loginModal = document.getElementById('loginModal');
  const adminPanel = document.getElementById('adminPanel');
  const loginForm = document.getElementById('adminLoginForm');
  const loginMessage = document.getElementById('loginMessage');
  const adminName = document.getElementById('adminName');
  const adminEmailLabel = document.getElementById('adminEmailLabel');
  const logoutButton = document.getElementById('adminLogoutButton');
  const createForm = document.getElementById('createSecretaryForm');
  const createMessage = document.getElementById('createMessage');
  const facultySelect = document.getElementById('secretaryFaculty');
  const secretaryList = document.getElementById('secretaryList');

  let adminData = null;

  function setTheme() {
    const savedTheme =
      localStorage.getItem('academicPortalTheme') ||
      localStorage.getItem('studentInterfaceTheme') ||
      localStorage.getItem('professorInterfaceTheme') ||
      localStorage.getItem('secretaryInterfaceTheme') ||
      'light';
    body.classList.toggle('dark', savedTheme === 'dark');
  }

  function setMessage(element, message) {
    element.textContent = message;
  }

  function showLogin(message) {
    loginModal.classList.add('open');
    adminPanel.hidden = true;
    if (message) setMessage(loginMessage, message);
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminEmail').focus();
  }

  function showAdmin(user) {
    loginModal.classList.remove('open');
    adminPanel.hidden = false;
    adminName.textContent = user.name || 'Admin';
    adminEmailLabel.textContent = user.email || '';
  }

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  async function apiFetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        }
      });
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(data.error || 'Request failed.');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The request timed out. Refresh the page and try again.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function renderFacultyOptions(faculties) {
    facultySelect.innerHTML = '';
    const openFaculties = faculties.filter((faculty) => !faculty.secretary);

    if (!openFaculties.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'All faculties already have secretaries';
      facultySelect.append(option);
      facultySelect.disabled = true;
      return;
    }

    facultySelect.disabled = false;
    openFaculties.forEach((faculty) => {
      const option = document.createElement('option');
      option.value = String(faculty.id);
      option.textContent = faculty.name;
      facultySelect.append(option);
    });
  }

  function buildInput(labelText, value, type = 'text') {
    const label = document.createElement('label');
    label.className = 'field';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'label';
    labelSpan.textContent = labelText;

    const input = document.createElement('input');
    input.className = 'control';
    input.type = type;
    input.value = value || '';
    if (labelText === 'Full name') input.maxLength = 120;
    if (type === 'password') input.minLength = 8;

    label.append(labelSpan, input);
    return { label, input };
  }

  function renderSecretaryList(faculties) {
    secretaryList.innerHTML = '';

    if (!faculties.length) {
      const empty = document.createElement('p');
      empty.className = 'profile-text';
      empty.textContent = 'No faculties are configured yet.';
      secretaryList.append(empty);
      return;
    }

    faculties.forEach((faculty) => {
      const card = document.createElement('article');
      card.className = 'proposal-card';

      const head = document.createElement('div');
      head.className = 'section-head';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'section-title-wrap';
      const marker = document.createElement('span');
      marker.className = 'section-number';
      marker.textContent = 'F';
      const title = document.createElement('h3');
      title.className = 'section-title';
      title.textContent = faculty.name;
      titleWrap.append(marker, title);
      head.append(titleWrap);

      if (!faculty.secretary) {
        const empty = document.createElement('p');
        empty.className = 'profile-text';
        empty.textContent = 'No secretary account has been created for this faculty.';
        card.append(head, empty);
        secretaryList.append(card);
        return;
      }

      const form = document.createElement('form');
      form.className = 'form-grid';
      form.dataset.secretaryId = faculty.secretary.id;

      const nameField = buildInput('Full name', faculty.secretary.name);
      const emailField = buildInput('Email', faculty.secretary.email, 'email');
      const passwordField = buildInput('New password', '', 'password');
      passwordField.input.placeholder = 'Leave blank to keep current password';

      const status = document.createElement('p');
      status.className = 'profile-text field full';
      status.textContent = faculty.secretary.emailVerified ? 'Email is verified.' : 'Email is not verified.';

      const footer = document.createElement('div');
      footer.className = 'form-footer field full';
      const message = document.createElement('p');
      message.className = 'profile-text';
      message.textContent = 'Changes keep the account verified. Password changes revoke active secretary sessions.';
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.type = 'submit';
      button.textContent = 'Save Changes';
      footer.append(message, button);

      form.append(nameField.label, emailField.label, passwordField.label, status, footer);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        button.disabled = true;
        message.textContent = 'Saving...';

        try {
          const payload = {
            name: nameField.input.value.trim(),
            email: emailField.input.value.trim()
          };
          if (passwordField.input.value.trim()) {
            payload.password = passwordField.input.value.trim();
          }

          adminData = await apiFetch(`/api/admin/secretaries/${faculty.secretary.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
          renderAdminData(adminData);
          setMessage(createMessage, 'Secretary account updated.');
        } catch (error) {
          message.textContent = error.message;
          button.disabled = false;
        }
      });

      card.append(head, form);
      secretaryList.append(card);
    });
  }

  function renderAdminData(data) {
    renderFacultyOptions(data.faculties || []);
    renderSecretaryList(data.faculties || []);
  }

  async function loadAdminData() {
    adminData = await apiFetch('/api/admin/secretaries');
    renderAdminData(adminData);
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(loginMessage, 'Signing in...');

    try {
      await apiFetch('/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('adminEmail').value.trim(),
          password: document.getElementById('adminPassword').value
        })
      });
      const me = await apiFetch('/me');
      if (me.user?.role !== 'admin') {
        throw new Error('Sign in with an admin account.');
      }
      showAdmin(me.user);
      loadAdminData().catch((error) => {
        secretaryList.innerHTML = '';
        const message = document.createElement('p');
        message.className = 'profile-text';
        message.textContent = error.message;
        secretaryList.append(message);
      });
    } catch (error) {
      showLogin(error.message);
    }
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setMessage(createMessage, 'Creating account...');

    try {
      adminData = await apiFetch('/api/admin/secretaries', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('secretaryName').value.trim(),
          email: document.getElementById('secretaryEmail').value.trim(),
          password: document.getElementById('secretaryPassword').value,
          facultyId: Number(facultySelect.value)
        })
      });
      createForm.reset();
      renderAdminData(adminData);
      setMessage(createMessage, 'Secretary account created.');
    } catch (error) {
      setMessage(createMessage, error.message);
    }
  });

  logoutButton.addEventListener('click', async () => {
    showLogin('Signed out.');
    await fetch('/logout', { method: 'POST' }).catch(() => null);
  });

  async function boot() {
    setTheme();

    try {
      const me = await apiFetch('/me');
      if (me.user?.role !== 'admin') {
        showLogin('Sign in with an admin account.');
        return;
      }

      showAdmin(me.user);
      await loadAdminData();
    } catch {
      showLogin('Sign in with an admin account.');
    }
  }

  boot();
});
