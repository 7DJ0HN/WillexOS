/* Installer Tools — dropdown wiring lookup + PCB hotspot sync
   Expects:
   - controllers.json in same folder as this HTML (or adjust path below)
   - HTML ids: brandSelect, modelSelect, statusBox, wiringBox, wOpen, wClose, wPed, wStop, notesBox, notesList, pcbInfo
   - Hotspots: .hotspot[data-action="open|close|ped|stop"] on relay hotspots
   - Wiring rows: .wiring-row[data-action="open|close|ped|stop"]
*/

let DB = null;

const brandSelect = document.getElementById('brandSelect');
const modelSelect = document.getElementById('modelSelect');

const statusBox = document.getElementById('statusBox');
const wiringBox = document.getElementById('wiringBox');

const wOpen = document.getElementById('wOpen');
const wClose = document.getElementById('wClose');
const wPed = document.getElementById('wPed');
const wStop = document.getElementById('wStop');

const notesBox = document.getElementById('notesBox');
const notesList = document.getElementById('notesList');

const pcbInfo = document.getElementById('pcbInfo');

function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function setStatus(kind, text){
  if (!statusBox) return;
  statusBox.style.display = 'block';
  statusBox.classList.remove('known', 'unknown', 'notok');
  statusBox.classList.add(kind);
  statusBox.textContent = text;
}

function clearStatus(){
  if (!statusBox) return;
  statusBox.style.display = 'none';
  statusBox.textContent = '';
  statusBox.classList.remove('known', 'unknown', 'notok');
}

function fmtWiring(v){
  // Accept string ("START / COM") or object {terminal:"...", note:"..."}
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'object'){
    const t = v.terminal ?? v.term ?? v.pin ?? '';
    const n = v.note ?? '';
    return (t && n) ? `${t} (${n})` : (t || n || '—');
  }
  return String(v);
}

function highlightHotspot(action){
  // Remove previous highlight
  document.querySelectorAll('.hotspot.is-active').forEach(h => h.classList.remove('is-active'));

  const target = document.querySelector(`.hotspot[data-action="${action}"]`);
  if (target) target.classList.add('is-active');
}

function renderSelection(){
  const b = brandSelect.value;
  const m = modelSelect.value;

  if (!DB || !b || !m){
    wiringBox && (wiringBox.style.display = 'none');
    notesBox && (notesBox.style.display = 'none');
    clearStatus();
    if (pcbInfo) pcbInfo.textContent = 'Select a brand + model to generate exact terminal mapping.';
    return;
  }

  const rec = DB?.[b]?.[m];
  if (!rec){
    setStatus('notok', 'No record found for this selection.');
    wiringBox && (wiringBox.style.display = 'none');
    notesBox && (notesBox.style.display = 'none');
    if (pcbInfo) pcbInfo.textContent = `${b} ${m}: no dataset entry yet.`;
    return;
  }

  // Wiring block
  const wiring = rec.wiring || {};
  if (wiringBox){
    wiringBox.style.display = 'block';
    if (wOpen)  wOpen.textContent  = fmtWiring(wiring.open);
    if (wClose) wClose.textContent = fmtWiring(wiring.close);
    if (wPed)   wPed.textContent   = fmtWiring(wiring.ped);
    if (wStop)  wStop.textContent  = fmtWiring(wiring.stop);
  }

  // Notes list
  const notes = Array.isArray(rec.notes) ? rec.notes : (rec.notes ? [rec.notes] : []);
  if (notesBox && notesList){
    notesList.innerHTML = '';
    if (notes.length){
      notesBox.style.display = 'block';
      notes.forEach(n => {
        const li = document.createElement('li');
        li.innerHTML = escapeHtml(n);
        notesList.appendChild(li);
      });
    } else {
      notesBox.style.display = 'none';
    }
  }

  // Default highlight OPEN when a model is chosen
  highlightHotspot('open');

  if (pcbInfo){
    const openMap = wiring.open ? fmtWiring(wiring.open) : '—';
    pcbInfo.textContent = `${b} ${m}: OPEN relay → ${openMap}`;
  }
}

function populateBrands(){
  if (!DB) return;
  // Clear existing, keep placeholder
  brandSelect.innerHTML = `<option value="">Brand…</option>`;

  Object.keys(DB).sort().forEach(brand => {
    const opt = document.createElement('option');
    opt.value = brand;
    opt.textContent = brand;
    brandSelect.appendChild(opt);
  });
}

function populateModelsForBrand(brand){
  modelSelect.innerHTML = `<option value="">Model…</option>`;
  if (!DB || !brand || !DB[brand]){
    modelSelect.disabled = true;
    return;
  }

  Object.keys(DB[brand]).sort().forEach(model => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    modelSelect.appendChild(opt);
  });

  modelSelect.disabled = false;
}

function hookupWiringRowClicks(){
  // Your HTML uses: <div class="wiring-row" data-action="open|close|ped|stop">
  document.querySelectorAll('.wiring-row[data-action]').forEach(row => {
    const action = row.getAttribute('data-action');

    const handler = () => {
      const b = brandSelect.value;
      const m = modelSelect.value;
      const rec = DB?.[b]?.[m];
      if (!rec) return;

      const wiring = rec.wiring || {};
      const mapping = wiring[action];

      highlightHotspot(action);

      if (pcbInfo){
        if (mapping){
          pcbInfo.textContent = `${b} ${m}: ${action.toUpperCase()} relay → ${fmtWiring(mapping)}`;
        } else {
          pcbInfo.textContent = `${b} ${m}: No ${action.toUpperCase()} mapping in dataset yet.`;
        }
      }
    };

    row.addEventListener('click', handler);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        handler();
      }
    });
  });
}

function hookupHotspotNotes(){
  // Optional: clicking hotspots can update pcbInfo with the hotspot's data-note
  document.querySelectorAll('.hotspot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const note = btn.getAttribute('data-note') || '';
      if (pcbInfo && note) pcbInfo.textContent = note;

      const a = btn.getAttribute('data-action');
      if (a) highlightHotspot(a);
    });
  });
}

async function loadControllers(){
  // Adjust path if needed. If your controllers.json is beside installer-tools.html, use "controllers.json"
  const res = await fetch('/assets/data/controllers.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`controllers.json failed: ${res.status}`);
  return await res.json();
}

(async function init(){
  try{
    DB = await loadControllers();
    populateBrands();
    hookupWiringRowClicks();
    hookupHotspotNotes();

    brandSelect.addEventListener('change', () => {
      populateModelsForBrand(brandSelect.value);
      modelSelect.value = '';
      renderSelection();
    });

    modelSelect.addEventListener('change', () => {
      renderSelection();
    });

    renderSelection();
  } catch (err){
    console.error(err);
    setStatus('notok', 'Failed to load controller database. Check controllers.json path and hosting.');
    if (pcbInfo) pcbInfo.textContent = 'Error: controllers.json could not be loaded.';
  }
})();
// =============================
// Hotspot highlighting + notes
// =============================
(() => {
  const mv = document.getElementById("mv");
  if (!mv) return;

  const pcbInfo = document.getElementById("pcbInfo");

  const ACTION_TO_SLOT = {
    open: "hotspot-open",
    close: "hotspot-close",
    ped: "hotspot-ped",
    stop: "hotspot-stop",
  };

  function setPcbInfo(text) {
    if (!pcbInfo) return;
    pcbInfo.textContent = text || "";
  }

  function clearActive() {
    mv.querySelectorAll(".hotspot.is-active").forEach(b => b.classList.remove("is-active"));
  }

  function activateSlot(slotName, { showNote = true } = {}) {
    if (!slotName) return;

    const btn = mv.querySelector(`.hotspot[slot="${slotName}"]`);
    if (!btn) return;

    clearActive();
    btn.classList.add("is-active");

    if (showNote) {
      const note = btn.getAttribute("data-note") || "";
      if (note) setPcbInfo(note);
    }
  }

  // Hotspot click: highlight + show notes
  mv.querySelectorAll(".hotspot").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const slotName = btn.getAttribute("slot");
      activateSlot(slotName, { showNote: true });
    });
  });

  // Wiring row click: highlight corresponding relay hotspot + show relay notes
  document.querySelectorAll(".wiring-row[data-action]").forEach(row => {
    row.addEventListener("click", () => {
      const action = row.getAttribute("data-action");
      const slotName = ACTION_TO_SLOT[action];
      activateSlot(slotName, { showNote: true });
    });
  });

  // Optional: let your existing mapping code call this if you want
  window.WILLEX_HOTSPOT = {
    activate: (slot) => activateSlot(slot, { showNote: false }),
    clear: clearActive,
  };
})();