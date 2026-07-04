document.addEventListener('DOMContentLoaded', async () => {
  const body = document.body;
  const expectedRole = body.dataset.profileRole;
  const themeKey = body.dataset.themeKey || 'studentInterfaceTheme';
  const redirectByRole = {
    student: '/dashboard.html',
    professor: '/professor-dashboard.html',
    secretary: '/secretary-dashboard.html'
  };

  const themeToggle = document.getElementById('themeToggle');
  const moonOption = document.querySelector('.theme-option.moon');
  const sunOption = document.querySelector('.theme-option.sun');
  const modeIcon = document.getElementById('modeIcon');
  const modeText = document.getElementById('modeText');
  const darkChoice = document.getElementById('darkChoice');
  const lightChoice = document.getElementById('lightChoice');
  const editButtons = document.querySelectorAll('[data-edit-section]');
  const editableControls = [
    document.getElementById('fullName'),
    document.getElementById('bio'),
    document.getElementById('officeLocation'),
    document.getElementById('workingHours')
  ].filter(Boolean);
  const cancelBtn = document.getElementById('cancelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const profileCard = document.getElementById('profileCard');
  const photoInput = document.getElementById('photoInput');
  const changePhotoBtn = document.getElementById('changePhotoBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  let selectedImage = null;
  const originalValues = {};

  function setTheme(theme) {
    const isDark = theme === 'dark';
    body.classList.toggle('dark', isDark);
    moonOption?.classList.toggle('active', isDark);
    sunOption?.classList.toggle('active', !isDark);
    darkChoice?.classList.toggle('active', isDark);
    lightChoice?.classList.toggle('active', !isDark);

    if (modeIcon) modeIcon.textContent = isDark ? 'M' : 'S';
    if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';

    localStorage.setItem(themeKey, theme);
  }

  function setControlValue(id, value) {
    const control = document.getElementById(id);
    if (control) control.value = value ?? '';
  }

  function rememberEditableValues() {
    editableControls.forEach((control) => {
      originalValues[control.id] = control.value;
    });
  }

  function disableEditing() {
    profileCard?.classList.remove('editing');
    editableControls.forEach((control) => {
      control.disabled = true;
    });
  }

  function enableEditing(section) {
    profileCard?.classList.add('editing');
    const controls = Array.from(section.querySelectorAll('#fullName, #bio, #officeLocation, #workingHours'));

    controls.forEach((control) => {
      control.disabled = false;
    });

    controls[0]?.focus();
  }

  function showToast(message, isError = false) {
    if (toastText) toastText.textContent = message;
    toast?.classList.toggle('error', isError);
    toast?.classList.add('show');

    setTimeout(() => {
      toast?.classList.remove('show');
    }, 3200);
  }

  function initialsFromName(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '--';
  }

  function renderProfessorAssignments(data) {
    const facultyList = document.getElementById('facultyList');
    const specialisationList = document.getElementById('specialisationList');
    const specialisationCount = document.getElementById('specialisationCount');

    if (facultyList) {
      facultyList.innerHTML = '';
      const faculties = data.faculties || [];

      if (!faculties.length) {
        const item = document.createElement('li');
        item.textContent = 'No faculty assignments yet.';
        facultyList.append(item);
      } else {
        faculties.forEach((faculty) => {
          const item = document.createElement('li');
          item.textContent = faculty.name;
          facultyList.append(item);
        });
      }
    }

    if (specialisationList) {
      specialisationList.innerHTML = '';
      const specializations = data.specializations || [];

      if (!specializations.length) {
        const empty = document.createElement('p');
        empty.className = 'profile-text';
        empty.textContent = 'No specialisation assignments yet.';
        specialisationList.append(empty);
      } else {
        specializations.forEach((specialization, index) => {
          const card = document.createElement('article');
          card.className = `specialisation-card${index === 0 ? ' active' : ''}`;

          const icon = document.createElement('span');
          icon.className = 'specialisation-icon';
          icon.textContent = specialization.name
            .split(/\s+/)
            .map((word) => word[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          const titleWrap = document.createElement('div');
          const title = document.createElement('h3');
          title.className = 'specialisation-title';
          title.textContent = specialization.name;
          titleWrap.append(title);

          card.append(icon, titleWrap);
          specialisationList.append(card);
        });
      }

      if (specialisationCount) {
        const count = (data.specializations || []).length;
        specialisationCount.textContent = `${count} specialisation${count === 1 ? '' : 's'}`;
      }
    }
  }

  function renderProfileImage(image) {
    const imageNode = document.getElementById('profileImage');
    const initials = document.getElementById('profileInitials');
    if (!imageNode) return;

    if (image) {
      imageNode.src = image;
      imageNode.hidden = false;
      if (initials) initials.hidden = true;
    } else {
      imageNode.removeAttribute('src');
      imageNode.hidden = true;
      if (initials) initials.hidden = false;
    }
  }

  function populateProfile(data) {
    setControlValue('fullName', data.user.name);
    setControlValue('email', data.user.email);
    setControlValue('teams', data.user.email);
    setControlValue('bio', data.user.bio);
    setControlValue('role', data.user.role === 'secretary' ? 'Secretary' : data.user.role);
    setControlValue('officeLocation', data.user.officeLocation || '');
    setControlValue('workingHours', data.user.workingHours || '');
    selectedImage = data.user.image || '';

    const initials = document.getElementById('profileInitials');
    if (initials) initials.textContent = initialsFromName(data.user.name);
    renderProfileImage(selectedImage);

    if (data.user.role === 'student' || data.user.role === 'secretary') {
      setControlValue('faculty', data.faculty?.name || '');
      setControlValue('specialisation', data.specialization?.name || '');
    } else if (data.user.role === 'professor') {
      renderProfessorAssignments(data);
    }

    rememberEditableValues();
    disableEditing();
  }

  async function loadProfile() {
    const response = await fetch('/profile');
    if (!response.ok) {
      window.location.href = '/login.html';
      return;
    }

    const data = await response.json();
    if (expectedRole && data.user.role !== expectedRole) {
      window.location.href = redirectByRole[data.user.role] || '/login.html';
      return;
    }

    populateProfile(data);
  }

  themeToggle?.addEventListener('click', () => {
    setTheme(body.classList.contains('dark') ? 'light' : 'dark');
  });

  darkChoice?.addEventListener('click', () => setTheme('dark'));
  lightChoice?.addEventListener('click', () => setTheme('light'));

  editButtons.forEach((button) => {
    button.addEventListener('click', () => {
      enableEditing(button.closest('.profile-section') || document);
    });
  });

  cancelBtn?.addEventListener('click', () => {
    Object.entries(originalValues).forEach(([id, value]) => {
      setControlValue(id, value);
    });

    disableEditing();
  });

  saveBtn?.addEventListener('click', async () => {
    const name = document.getElementById('fullName')?.value.trim() || '';
    const bio = document.getElementById('bio')?.value.trim() || '';
    const officeLocation = document.getElementById('officeLocation')?.value.trim();
    const workingHours = document.getElementById('workingHours')?.value.trim();

    if (!name) {
      showToast('Full name is required.', true);
      return;
    }

    const payload = { name, bio };
    if (officeLocation !== undefined) payload.officeLocation = officeLocation;
    if (workingHours !== undefined) payload.workingHours = workingHours;
    if (selectedImage !== null) payload.image = selectedImage;

    const response = await fetch('/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Profile could not be saved.', true);
      return;
    }

    populateProfile(data);
    showToast('Your profile changes were saved.');
  });

  document.querySelectorAll('.office-edit').forEach((button) => {
    button.addEventListener('click', () => {
      showToast('Office hours editing is not connected yet.');
    });
  });

  function openPhotoPicker() {
    photoInput?.click();
  }

  changePhotoBtn?.addEventListener('click', openPhotoPicker);
  cameraBtn?.addEventListener('click', openPhotoPicker);
  photoInput?.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      showToast('Use a PNG or JPEG image.', true);
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      selectedImage = String(reader.result || '');
      renderProfileImage(selectedImage);
      showToast('Profile photo selected. Save changes to keep it.');
    });
    reader.readAsDataURL(file);
  });

  setTheme(localStorage.getItem(themeKey) || 'light');
  await loadProfile();
});
