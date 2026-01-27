(() => {
  const fileInput = document.getElementById("logFile");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const fileName = document.getElementById("fileName");
  const confidenceChip = document.getElementById("confidenceChip");

  const causesList = document.getElementById("causesList");
  const recsList = document.getElementById("recsList");
  const notesList = document.getElementById("notesList");
  const episodesList = document.getElementById("episodesList");

  const ctx = document.getElementById("timelineChart");
  let chart = null;

  function setMuted(el, isMuted) {
    if (isMuted) el.classList.add("muted");
    else el.classList.remove("muted");
  }

  function pct(x) {
    return (x * 100).toFixed(0) + "%";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[m]));
  }

  function chipConfidence(level, score) {
    confidenceChip.textContent = `Confidence: ${level} (${score.toFixed(2)})`;
    confidenceChip.classList.remove("chip-low", "chip-med", "chip-high", "chip-muted");
    if (level === "HIGH") confidenceChip.classList.add("chip-high");
    else if (level === "MED") confidenceChip.classList.add("chip-med");
    else confidenceChip.classList.add("chip-low");
  }

  function renderCauses(scores) {
    const entries = Object.entries(scores)
      .sort((a,b) => b[1] - a[1]);

    causesList.innerHTML = entries.map(([k,v]) => {
      const nice = k.replaceAll("_", " ");
      return `<div class="row"><span>${escapeHtml(nice)}</span><span class="val">${pct(v)}</span></div>`;
    }).join("");
    setMuted(causesList, false);
  }

  function renderBullets(el, arr) {
    if (!arr || !arr.length) {
      el.textContent = "None";
      setMuted(el, true);
      return;
    }
    el.innerHTML = `<ul>${arr.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
    setMuted(el, false);
  }

  function renderEpisodes(episodes) {
    if (!episodes || !episodes.length) {
      episodesList.textContent = "None detected.";
      setMuted(episodesList, true);
      return;
    }
    episodesList.innerHTML = `<ul>${
      episodes.map(e => `<li><strong>${escapeHtml(e.kind)}</strong> — ${escapeHtml(e.start_ts || "?")} → ${escapeHtml(e.end_ts || "?")} (events=${e.count})</li>`).join("")
    }</ul>`;
    setMuted(episodesList, false);
  }

  function outcomeToY(outcome) {
    // categorical to numeric
    const map = {
      "GOOD_CLOSE": 2,
      "MARGINAL_CLOSE": 1,
      "LATCH_MISS": 0,
      "HARD_FAIL": -1,
      "UNKNOWN": -2
    };
    return map[outcome] ?? -2;
  }

  function yTickLabel(v) {
    const rev = {
      2: "GOOD",
      1: "MARGINAL",
      0: "LATCH MISS",
      "-1": "HARD FAIL",
      "-2": "UNKNOWN"
    };
    return rev[String(v)] ?? "";
  }

  function renderChart(timeline) {
    const points = timeline.map((t, idx) => ({
      x: idx + 1,
      y: outcomeToY(t.outcome),
      dur: t.duration_ms,
      hum: t.hum_near,
      slow: t.slow,
      wet: t.wet,
      ts: t.ts
    }));

    const colors = points.map(p => {
      if (p.y === -1) return "#ff6b6b";     // hard fail
      if (p.y === 0) return "#ffd166";      // latch miss
      if (p.y === 1) return "#8ecae6";      // marginal
      if (p.y === 2) return "#AEF359";      // good
      return "#9FB0C2";
    });

    const data = {
      datasets: [{
        label: "Close attempts",
        data: points,
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
        pointBackgroundColor: colors,
        pointBorderColor: "rgba(255,255,255,0.12)",
        pointBorderWidth: 1,
      }]
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: "Close attempt #", color: "#9FB0C2" },
          ticks: { color: "#9FB0C2" },
          grid: { color: "rgba(255,255,255,0.05)" }
        },
        y: {
          title: { display: true, text: "Outcome", color: "#9FB0C2" },
          ticks: {
            color: "#9FB0C2",
            callback: (v) => yTickLabel(v)
          },
          grid: { color: "rgba(255,255,255,0.05)" },
          suggestedMin: -2,
          suggestedMax: 2
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const p = ctx.raw;
              const hum = (p.hum === null || p.hum === undefined) ? "n/a" : p.hum.toFixed(1) + "%";
              const flags = [
                p.slow ? "SLOW" : null,
                p.wet ? "WET" : null
              ].filter(Boolean).join(" ");
              return `${yTickLabel(p.y)} | dur=${p.dur}ms | hum~${hum} ${flags ? "| " + flags : ""}`;
            }
          }
        },
        legend: { display: false }
      }
    };

    if (chart) chart.destroy();
    chart = new Chart(ctx, { type: "scatter", data, options });
  }

  async function analyze(file) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing…";

    const fd = new FormData();
    fd.append("logfile", file);

    const res = await fetch("/api/bellatron/analyze", { method: "POST", body: fd });
    const data = await res.json();

    analyzeBtn.textContent = "Analyze";
    analyzeBtn.disabled = false;

    if (!data.ok) {
      alert(data.error || "Analyze failed.");
      return;
    }

    const conf = data.diagnosis.confidence;
    chipConfidence(conf.level, conf.score);

    renderCauses(data.diagnosis.scores);
    renderBullets(recsList, data.diagnosis.recommendations);
    renderBullets(notesList, data.diagnosis.notes);
    renderEpisodes(data.diagnosis.episodes);
    renderChart(data.diagnosis.timeline_events);
  }

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    fileName.textContent = f.name;
    analyzeBtn.disabled = false;
  });

  analyzeBtn.addEventListener("click", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    analyze(f).catch(err => {
      console.error(err);
      alert("Unexpected error. See console.");
      analyzeBtn.textContent = "Analyze";
      analyzeBtn.disabled = false;
    });
  });
})();
