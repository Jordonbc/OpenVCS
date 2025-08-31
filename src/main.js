// src/main.js — OpenVCS frontend using Rust commands to open prompt windows

const { invoke } = window.__TAURI__.core;

/*────────────────── DOM REFERENCES ──────────────────*/
const sidebar      = document.getElementById('sidebar');
const hamburger    = document.getElementById('hamburger');
const navItems     = document.querySelectorAll('.nav-item');
const sectionTitle = document.getElementById('section-title');

const sections = {
  projects: document.getElementById('section-projects'),
  settings: document.getElementById('section-settings'),
  about:    document.getElementById('section-about')
};

const projectList = document.getElementById('project-list');
const addBtn      = document.getElementById('add-btn');
const cloneBtn    = document.getElementById('clone-btn');
const searchBtn   = document.getElementById('search-btn');

/*────────────────── APP STATE ──────────────────*/
let currentSection = 'projects';
let projects       = []; // { name, path }

/*──────────────── SIDEBAR & NAV ─────────────────*/
function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
}

function setSection(section) {
  if (section === currentSection) return;
  navItems.forEach(btn =>
      btn.classList.toggle('active', btn.dataset.section === section)
  );
  Object.entries(sections).forEach(([key, el]) =>
      el.classList.toggle('hidden', key !== section)
  );
  currentSection = section;
  sectionTitle.textContent = section.charAt(0).toUpperCase() + section.slice(1);
}

document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => setSection(btn.dataset.section))
);

/*────────── PROJECT LIST RENDERING ──────────*/
function renderProjects() {
  projectList.innerHTML = '';
  if (!projects.length) {
    projectList.innerHTML = '<p>No projects yet. Click <strong>Add</strong>.</p>';
    return;
  }
  projects.forEach((p, idx) => {
    const li = document.createElement('li');
    li.className = 'project-card';
    li.innerHTML = `
      <span class="project-title">${p.name}</span>
      <span class="project-path">${p.path}</span>
    `;
    li.onclick = () => selectProject(idx);
    projectList.appendChild(li);
  });
}

function selectProject(idx) {
  [...projectList.children].forEach((el, i) =>
      el.classList.toggle('selected', i === idx)
  );
  // TODO: navigate to repo details
}

/*───────── OPEN PROMPT WINDOWS via Rust commands ─────────*/
async function openPromptWindow(mode) {
  if (mode === 'add') {
    await invoke('open_add_prompt');
  } else {
    await invoke('open_clone_prompt');
  }
}

addBtn  .addEventListener('click', () => openPromptWindow('add'));
cloneBtn.addEventListener('click', () => openPromptWindow('clone'));
searchBtn.addEventListener('click', () => alert('Search coming soon'));

/*───────── HANDLE PROMPT RESULTS via events ─────────*/
window.__TAURI__.event.listen('prompt-submitted', event => {
  const { mode, value } = event.payload;
  if (!value) return;
  if (mode === 'add') addProject(value);
  else cloneProject(value);
});

/*───────── PROJECT ACTIONS ─────────*/
function addProject(name) {
  const path = `/projects/${name}`;
  projects.push({ name, path });
  renderProjects();
}

function cloneProject(url) {
  const name = url.split('/').pop().replace(/\.git$/, '');
  const path = `/projects/${name}`;
  projects.push({ name, path });
  renderProjects();
}

/*───────── INITIALIZE ─────────*/
hamburger.addEventListener('click', toggleSidebar);
renderProjects();
