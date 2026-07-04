document.addEventListener('DOMContentLoaded', async () => {
  const body = document.body;
  const themeKey = body.dataset.themeKey || 'secretaryInterfaceTheme';
  const state = { topics: [], professors: [], specializations: [] };

  const themeToggle = document.getElementById('themeToggle');
  const moonOption = document.querySelector('.theme-option.moon');
  const sunOption = document.querySelector('.theme-option.sun');
  const modeIcon = document.getElementById('modeIcon');
  const modeText = document.getElementById('modeText');
  const tableBody = document.getElementById('thesisTableBody');
  const searchInput = document.getElementById('searchInput');
  const specializationFilter = document.getElementById('specializationFilter');
  const typeFilter = document.getElementById('typeFilter');
  const statusFilter = document.getElementById('statusFilter');
  const professorFilter = document.getElementById('professorFilter');

  function setTheme(theme) {
    const isDark = theme === 'dark';
    body.classList.toggle('dark', isDark);
    moonOption?.classList.toggle('active', isDark);
    sunOption?.classList.toggle('active', !isDark);
    if (modeIcon) modeIcon.textContent = isDark ? 'M' : 'S';
    if (modeText) modeText.textContent = isDark ? 'DARK MODE' : 'LIGHT MODE';
    localStorage.setItem(themeKey, theme);
  }

  function setNumber(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? 0);
  }

  function addOptions(select, rows, label, getValue = (row) => row.id, getText = (row) => row.name) {
    select.innerHTML = '';
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = label;
    select.append(all);
    rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = String(getValue(row));
      option.textContent = getText(row);
      select.append(option);
    });
  }

  function formatOrigin(origin) {
    return origin === 'student_proposal' ? 'Student proposed' : 'Professor made';
  }

  function statusClass(status) {
    if (status === 'available') return 'available';
    if (status === 'reserved') return 'pending';
    return 'withdrawn';
  }

  function filteredTopics() {
    const query = searchInput.value.trim().toLowerCase();
    return state.topics.filter((topic) => {
      const matchesSearch =
        !query || `${topic.title} ${topic.professorName}`.toLowerCase().includes(query);
      const matchesSpecialization =
        specializationFilter.value === 'all' || String(topic.specializationId) === specializationFilter.value;
      const matchesType = typeFilter.value === 'all' || topic.origin === typeFilter.value;
      const matchesStatus = statusFilter.value === 'all' || topic.status === statusFilter.value;
      const matchesProfessor = professorFilter.value === 'all' || topic.professorId === professorFilter.value;
      return matchesSearch && matchesSpecialization && matchesType && matchesStatus && matchesProfessor;
    });
  }

  function renderTable() {
    tableBody.innerHTML = '';
    const rows = filteredTopics();
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'empty-row';
      cell.colSpan = 5;
      cell.textContent = 'No thesis records match the selected filters.';
      row.append(cell);
      tableBody.append(row);
      return;
    }

    rows.forEach((topic) => {
      const row = document.createElement('tr');
      [topic.title, formatOrigin(topic.origin), topic.professorName, topic.specialization, topic.status].forEach((value, index) => {
        const cell = document.createElement('td');
        if (index === 1) {
          const pill = document.createElement('span');
          pill.className = `status-pill ${topic.origin === 'student_proposal' ? 'pending' : 'approved'}`;
          pill.textContent = value;
          cell.append(pill);
        } else if (index === 4) {
          const pill = document.createElement('span');
          pill.className = `status-pill ${statusClass(topic.status)}`;
          pill.textContent = value;
          cell.append(pill);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      });
      tableBody.append(row);
    });
  }

  function applyData(data) {
    document.getElementById('facultyName').textContent = data.faculty?.name || 'Faculty unavailable';
    state.topics = data.topics || [];
    state.professors = data.professors || [];
    state.specializations = data.specializations || [];

    Object.entries(data.summary || {}).forEach(([key, value]) => setNumber(key, value));
    addOptions(specializationFilter, state.specializations, 'All');
    addOptions(professorFilter, state.professors, 'All', (professor) => professor.id, (professor) => professor.name);
    renderTable();
  }

  async function loadData() {
    const response = await fetch('/api/secretary/statistics');
    if (!response.ok) {
      window.location.href = '/login.html';
      return;
    }
    applyData(await response.json());
  }

  themeToggle?.addEventListener('click', () => setTheme(body.classList.contains('dark') ? 'light' : 'dark'));
  [searchInput, specializationFilter, typeFilter, statusFilter, professorFilter].forEach((filter) => {
    filter.addEventListener('input', renderTable);
    filter.addEventListener('change', renderTable);
  });

  setTheme(localStorage.getItem(themeKey) || 'light');
  await loadData();
});
