document.addEventListener('DOMContentLoaded', async () => {
  const body = document.body;
  const themeKey = body.dataset.themeKey || 'secretaryInterfaceTheme';
  const state = { professors: [], specializations: [], faculty: null, editingId: null };

  const themeToggle = document.getElementById('themeToggle');
  const moonOption = document.querySelector('.theme-option.moon');
  const sunOption = document.querySelector('.theme-option.sun');
  const modeIcon = document.getElementById('modeIcon');
  const modeText = document.getElementById('modeText');
  const facultyName = document.getElementById('facultyName');
  const totalCount = document.getElementById('totalCount');
  const hiddenCount = document.getElementById('hiddenCount');
  const professorList = document.getElementById('professorList');
  const searchInput = document.getElementById('searchInput');
  const titleFilter = document.getElementById('titleFilter');
  const specializationFilter = document.getElementById('specializationFilter');
  const modal = document.getElementById('professorModal');
  const viewModal = document.getElementById('viewModal');
  const viewBody = document.getElementById('viewBody');
  const viewTitle = document.getElementById('viewTitle');
  const viewSubtitle = document.getElementById('viewSubtitle');
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toastText');

  function setTheme(theme) {
    const isDark = theme === 'dark';
    body.classList.toggle('dark', isDark);
    moonOption?.classList.toggle('active', isDark);
    sunOption?.classList.toggle('active', !isDark);
    if (modeIcon) modeIcon.textContent = isDark ? 'M' : 'S';
    if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
    localStorage.setItem(themeKey, theme);
  }

  function showToast(message, isError = false) {
    if (toastText) toastText.textContent = message;
    toast?.classList.toggle('error', isError);
    toast?.classList.add('show');
    setTimeout(() => toast?.classList.remove('show'), 3200);
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'P';
  }

  function fullName(professor) {
    return [professor.academicTitle, professor.name].filter(Boolean).join(' ');
  }

  function setOptions(select, values, firstLabel) {
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = firstLabel;
    select.append(all);
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value.id ?? value);
      option.textContent = value.name ?? value;
      select.append(option);
    });
  }

  function fillFilters() {
    const titles = Array.from(new Set(state.professors.map((professor) => professor.academicTitle).filter(Boolean))).sort();
    setOptions(titleFilter, titles, 'All titles');
    setOptions(specializationFilter, state.specializations, 'All specialisations');
  }

  function renderSpecializationChecks(selectedIds = []) {
    const wrap = document.getElementById('specializationChecks');
    wrap.innerHTML = '';
    state.specializations.forEach((specialization) => {
      const label = document.createElement('label');
      label.className = 'checkbox-line';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = specialization.id;
      input.checked = selectedIds.includes(specialization.id);
      const text = document.createElement('span');
      text.textContent = specialization.name;
      label.append(input, text);
      wrap.append(label);
    });
  }

  function professorMatches(professor) {
    const query = searchInput.value.trim().toLowerCase();
    const title = titleFilter.value;
    const specializationId = specializationFilter.value;
    const searchable = `${fullName(professor)} ${professor.email}`.toLowerCase();
    const matchesSearch = !query || searchable.includes(query);
    const matchesTitle = title === 'all' || professor.academicTitle === title;
    const matchesSpecialization =
      specializationId === 'all' ||
      professor.specializations.some((specialization) => String(specialization.id) === specializationId);
    return matchesSearch && matchesTitle && matchesSpecialization;
  }

  function renderProfessors() {
    totalCount.textContent = String(state.professors.length);
    hiddenCount.textContent = String(state.professors.filter((professor) => professor.isHidden).length);
    professorList.innerHTML = '';

    const filtered = state.professors.filter(professorMatches);
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'profile-text panel-card p-5';
      empty.textContent = 'No professor records match the selected filters.';
      professorList.append(empty);
      return;
    }

    filtered.forEach((professor) => {
      const card = document.createElement('article');
      card.className = 'secretary-prof-card';

      const head = document.createElement('div');
      head.className = 'secretary-prof-head';
      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.textContent = initials(professor.name);
      const main = document.createElement('div');
      const name = document.createElement('h2');
      name.className = 'professor-name';
      name.textContent = fullName(professor);
      const meta = document.createElement('p');
      meta.className = 'professor-meta';
      meta.textContent = professor.email;
      main.append(name, meta);
      const status = document.createElement('span');
      status.className = `status-pill ${professor.isHidden ? 'withdrawn' : 'approved'}`;
      status.textContent = professor.isHidden ? 'Hidden' : 'Visible';
      head.append(avatar, main, status);

      const details = document.createElement('div');
      details.className = 'secretary-prof-details';
      [
        ['Specialisations', professor.specializations.map((item) => item.name).join(', ') || 'None assigned'],
        ['Office', professor.officeLocation || 'Not set'],
        ['Working Hours', professor.workingHours || 'Not set']
      ].forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'secretary-detail';
        const strong = document.createElement('strong');
        strong.textContent = label;
        const text = document.createElement('span');
        text.textContent = value;
        item.append(strong, text);
        details.append(item);
      });

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      [
        ['View', 'view'],
        ['Edit', 'edit'],
        [professor.isHidden ? 'Unhide' : 'Hide', 'toggle']
      ].forEach(([label, action]) => {
        const button = document.createElement('button');
        button.className = action === 'toggle' ? 'small-btn danger' : 'small-btn';
        button.type = 'button';
        button.textContent = label;
        button.dataset.action = action;
        button.dataset.id = professor.id;
        actions.append(button);
      });

      card.append(head, details, actions);
      professorList.append(card);
    });
  }

  function openProfessorModal(mode, professor = null) {
    state.editingId = professor?.id ?? null;
    document.getElementById('modalTitle').textContent = mode === 'edit' ? 'Edit Professor' : 'Add Professor';
    document.getElementById('formName').value = professor?.name ?? '';
    document.getElementById('formEmail').value = professor?.email ?? '';
    document.getElementById('formPassword').value = '';
    document.getElementById('formPassword').closest('.field').hidden = mode === 'edit';
    document.getElementById('formTitle').value = professor?.academicTitle ?? '';
    document.getElementById('formOffice').value = professor?.officeLocation ?? '';
    document.getElementById('formHours').value = professor?.workingHours ?? '';
    document.getElementById('formBio').value = professor?.bio ?? '';
    document.getElementById('formHidden').checked = professor?.isHidden ?? false;
    renderSpecializationChecks(professor?.specializations.map((item) => item.id) ?? []);
    modal.classList.add('open');
  }

  function closeProfessorModal() {
    modal.classList.remove('open');
    state.editingId = null;
  }

  function openViewModal(professor) {
    viewTitle.textContent = fullName(professor);
    viewSubtitle.textContent = professor.email;
    viewBody.innerHTML = '';
    [
      ['Bio', professor.bio || 'No bio has been added.'],
      ['Specialisations', professor.specializations.map((item) => item.name).join(', ') || 'None assigned'],
      ['Office Location', professor.officeLocation || 'Not set'],
      ['Working Hours', professor.workingHours || 'Not set'],
      ['Visibility', professor.isHidden ? 'Hidden from student-facing lists' : 'Visible']
    ].forEach(([label, value]) => {
      const section = document.createElement('section');
      section.className = 'modal-section';
      const title = document.createElement('h3');
      title.textContent = label;
      const text = document.createElement('p');
      text.textContent = value;
      section.append(title, text);
      viewBody.append(section);
    });
    viewModal.classList.add('open');
  }

  function formPayload() {
    return {
      name: document.getElementById('formName').value.trim(),
      email: document.getElementById('formEmail').value.trim(),
      password: document.getElementById('formPassword').value,
      academicTitle: document.getElementById('formTitle').value.trim(),
      officeLocation: document.getElementById('formOffice').value.trim(),
      workingHours: document.getElementById('formHours').value.trim(),
      bio: document.getElementById('formBio').value.trim(),
      isHidden: document.getElementById('formHidden').checked,
      specializationIds: Array.from(document.querySelectorAll('#specializationChecks input:checked')).map((input) =>
        Number(input.value)
      )
    };
  }

  async function saveProfessor() {
    const payload = formPayload();
    if (!payload.name || !payload.email || (!state.editingId && !payload.password)) {
      showToast('Name, email, and initial password are required.', true);
      return;
    }

    const url = state.editingId ? `/api/secretary/professors/${state.editingId}` : '/api/secretary/professors';
    if (state.editingId) delete payload.password;

    const response = await fetch(url, {
      method: state.editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Professor could not be saved.', true);
      return;
    }

    applyData(data);
    closeProfessorModal();
    showToast('Professor record saved.');
  }

  async function toggleProfessor(professor) {
    const response = await fetch(`/api/secretary/professors/${professor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isHidden: !professor.isHidden })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data.error || 'Visibility could not be updated.', true);
      return;
    }
    applyData(data);
  }

  function applyData(data) {
    state.professors = data.professors || [];
    state.specializations = data.specializations || [];
    state.faculty = data.faculty || null;
    facultyName.textContent = state.faculty?.name || 'Faculty unavailable';
    fillFilters();
    renderProfessors();
  }

  async function loadData() {
    const response = await fetch('/api/secretary/professors');
    if (!response.ok) {
      window.location.href = '/login.html';
      return;
    }
    applyData(await response.json());
  }

  themeToggle?.addEventListener('click', () => setTheme(body.classList.contains('dark') ? 'light' : 'dark'));
  [searchInput, titleFilter, specializationFilter].forEach((control) => {
    control.addEventListener('input', renderProfessors);
    control.addEventListener('change', renderProfessors);
  });
  document.getElementById('addProfessorBtn').addEventListener('click', () => openProfessorModal('add'));
  document.getElementById('closeModal').addEventListener('click', closeProfessorModal);
  document.getElementById('cancelModal').addEventListener('click', closeProfessorModal);
  document.getElementById('saveProfessor').addEventListener('click', saveProfessor);
  document.getElementById('closeViewModal').addEventListener('click', () => viewModal.classList.remove('open'));

  professorList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const professor = state.professors.find((item) => item.id === button.dataset.id);
    if (!professor) return;
    if (button.dataset.action === 'view') openViewModal(professor);
    if (button.dataset.action === 'edit') openProfessorModal('edit', professor);
    if (button.dataset.action === 'toggle') toggleProfessor(professor);
  });

  setTheme(localStorage.getItem(themeKey) || 'light');
  await loadData();
});
