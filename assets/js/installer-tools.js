/* Installer Tools + PCB Viewer integration (public)
   - Loads controllers.json
   - Populates Brand + Model dropdowns
   - Shows wiring + notes
   - Links wiring rows to PCB hotspots
*/

const DATA_URL = 'assets/data/controllers.json';

const brandSelect = document.getElementById('brandSelect');
const modelSelect = document.getElementById('modelSelect');

const statusBox = document.getElementById('statusBox');
const wiringBox = document.getElementById('wiringBox');

const wOpen  = document.getElementById('wOpen');
const wClose = document.getElementById('wClose');
const wPed   = document.getElementById('wPed');
const wStop  = document.getElementById('wStop');

const notesBox  = document.getElementById('notesBox');
const notesList = document.getElementById('notesList');

// PCB viewer note panel (optional)
const pcbInfo = document.getElementById('pcbInfo');

let DB = null;

function esc(str){
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function setStatus(text, cls){
  statusBox.style.display = 'block';
  statusBox.classList.remove('known','unknown','notok');
  statusBox.classList.add(cls);
  statusBox.textContent = text;
}

function hideResults(){
  statusBox.style.display = 'none';
  wiringBox.style.display = 'none';
  notesBox.style.display  = 'none';
  if (pcbInfo) pcbInfo.textContent = 'Select a label or a wiring row to see notes.';
  clearHotspotHighlight();
}

function clearHotspotHighlight(){
  document.querySelectorAll('.hotspot').forEach(b => b.classList.remove('is-active'));
}

function highlightHotspot(action){
  clearHotspotHighlight();
  const btn = document.querySelector(`.hotspot[data-action="${action}"]`);
  if (btn) btn.classList.add('is-active');
}

function fmtWiring(w){
  if (!w) return '—';
  const term = w.terminal ?? '—';
  const contact = w.contact ? ` (${w.contact})` : '';
  return `${term}${contact}`;
}

function setPCBNoteFromSelection(brand, model, record){
  if (!pcbInfo) return;
  const wiring = record?.wiring || {};
  const lines = [];
  if (wiring.open)  lines.push(`OPEN relay → ${fmtWiring(wiring.open)}`);
  if (wiring.close) lines.push(`CLOSE relay → ${fmtWiring(wiring.close)}`);
  if (wiring.ped)   lines.push(`PED relay → ${fmtWiring(wiring.ped)}`);
  if (wiring.stop)  lines.push(`STOP relay → ${fmtWiring(wiring.stop)}`);

  const header = `${brand} ${model}`;
  pcbInfo.textContent = lines.length ? `${header}: ${lines.join(' · ')}` : `${header}: No wiring data.`;
}

function renderModelList(brand){
  modelSelect.innerHTML = '<option value="">Model…</option>';
  modelSelect.disabled = true;

  const modelsObj = DB?.[brand];
  if (!modelsObj) return;

  const models = Object.keys(modelsObj).sort((a,b)=>a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  for (const m of models){
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  }
  modelSelect.disabled = false;
}

function renderSelection(brand, model){
  const record = DB?.[brand]?.[model];
  if (!record){
    setStatus('No data for that selection.', 'unknown');
    wiringBox.style.display = 'none';
    notesBox.style.display  = 'none';
    return;
  }

  // Status
  if (record.compatible === true){
    setStatus('Compatible', 'known');
  } else if (record.compatible === false){
    setStatus('Not compatible', 'notok');
  } else {
    setStatus('Unconfirmed', 'unknown');
  }

  // Wiring
  const wiring = record.wiring || {};
  wOpen.textContent  = fmtWiring(wiring.open);
  if (wClose) wClose.textContent = fmtWiring(wiring.close);
  wPed.textContent   = fmtWiring(wiring.ped);
  wStop.textContent  = fmtWiring(wiring.stop);
  wiringBox.style.display = 'block';

  // Notes
  notesList.innerHTML = '';
  const notes = Array.isArray(record.notes) ? record.notes : [];
  if (notes.length){
    for (const n of notes){
      const li = document.createElement('li');
      li.innerHTML = esc(n);
      notesList.appendChild(li);
    }
    notesBox.style.display = 'block';
  } else {
    notesBox.style.display = 'none';
  }

  // PCB summary note + default highlight
  setPCBNoteFromSelection(brand, model, record);
  highlightHotspot('open');
}

function hookupWiringRowClicks(){
  document.querySelectorAll('[data-wiring-action]').forEach(row => {
    const action = row.getAttribute('data-wiring-action');
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

async function init(){
  hideResults();

  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DB = await res.json();

    // Brands
    const brands = Object.keys(DB).sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'}));
    for (const b of brands){
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      brandSelect.appendChild(opt);
    }

    // Hook events
    brandSelect.addEventListener('change', () => {
      const brand = brandSelect.value;
      hideResults();
      modelSelect.value = '';
      if (!brand){
        modelSelect.innerHTML = '<option value="">Model…</option>';
        modelSelect.disabled = true;
        return;
      }
      renderModelList(brand);
    });

    modelSelect.addEventListener('change', () => {
      hideResults();
      const brand = brandSelect.value;
      const model = modelSelect.value;
      if (!brand || !model) return;
      renderSelection(brand, model);
    });

    hookupWiringRowClicks();

  } catch (err){
    console.error(err);
    setStatus(`Data load failed: ${err.message}`, 'notok');
  }
}

// Hotspot click -> show note
(function hookupHotspots(){
  const info = pcbInfo;
  document.querySelectorAll('.hotspot').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      highlightHotspot(btn.getAttribute('data-action') || '');
      if (info){
        const note = btn.getAttribute('data-note') || 'No notes set yet.';
        info.textContent = note;
      }
    });
  });
})();

window.addEventListener('DOMContentLoaded', init);
