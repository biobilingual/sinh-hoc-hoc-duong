(() => {
  const API = 'https://rglsppkyxubpmbebdobe.supabase.co/functions/v1/biobilingual-api/api/my-results';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const authToken = () => {
    try {
      const auth = JSON.parse(localStorage.getItem('bioedu_google_auth') || 'null');
      return auth?.token && Date.parse(auth.expiresAt) > Date.now() ? auth.token : '';
    } catch { return ''; }
  };
  const currentStudentId = () => {
    try {
      const profile = JSON.parse(localStorage.getItem('bioedu_student_profile') || 'null');
      return String(localStorage.getItem('bioedu_student_id') || profile?.id || profile?.email || '').trim().toLowerCase();
    } catch { return ''; }
  };
  const localResults = () => {
    try {
      const all = JSON.parse(localStorage.getItem('bioedu_results') || '[]');
      const id = currentStudentId();
      return Array.isArray(all) ? all.filter(item => !id || String(item.studentId || item.email || '').trim().toLowerCase() === id) : [];
    } catch { return []; }
  };
  const kindLabel = type => {
    const key = String(type || '').toLowerCase();
    if (key.includes('worksheet')) return 'Phiếu học tập';
    if (key.includes('exam') || key.includes('practice')) return 'Luyện tập';
    return 'Bài làm';
  };
  const dateLabel = value => {
    const date = new Date(value || Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});
  };
  const scoreText = row => {
    const score = Number(row.score || 0);
    const max = Number(row.maxScore || 10) || 10;
    return `${Number.isInteger(score) ? score : score.toFixed(1)}/${Number.isInteger(max) ? max : max.toFixed(1)}`;
  };
  const percentage = row => {
    const score = Number(row.score || 0);
    const max = Number(row.maxScore || 10) || 10;
    return Math.max(0, Math.min(100, Math.round(score * 100 / max)));
  };

  let overlay = null;
  let body = null;
  let openSeq = 0;

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'bioedu-history-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:120;background:rgba(15,23,42,.46);display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
    overlay.innerHTML = `
      <section style="width:min(920px,100%);max-height:min(84vh,760px);display:flex;flex-direction:column;background:#fff;border:1px solid #dbeafe;border-radius:22px;box-shadow:0 28px 80px rgba(15,23,42,.26);overflow:hidden">
        <header style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#eff6ff,#f8fafc)">
          <div><div style="font-size:20px;font-weight:800;color:#0f172a">Lịch sử làm bài</div><div style="font-size:13px;font-weight:600;color:#64748b;margin-top:3px">Attempt History · Kết quả đã được lưu theo tài khoản của bạn</div></div>
          <button id="bioedu-history-close" style="width:38px;height:38px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-size:20px;cursor:pointer">×</button>
        </header>
        <div id="bioedu-history-body" style="padding:18px 20px;overflow:auto;background:#f8fafc;min-height:180px"></div>
      </section>`;
    document.body.appendChild(overlay);
    body = overlay.querySelector('#bioedu-history-body');
    overlay.querySelector('#bioedu-history-close').onclick = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.style.display = 'none'; });
  }

  function renderRows(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      body.innerHTML = '<div style="padding:38px 14px;text-align:center;color:#64748b;font-weight:650">Bạn chưa có bài làm nào được lưu.</div>';
      return;
    }
    body.innerHTML = `<div style="display:grid;gap:12px">${rows.map((row,index) => {
      const wrong = Array.isArray(row.wrongQuestions) ? row.wrongQuestions : [];
      const details = wrong.length ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:13px;font-weight:750;color:#2563eb">Xem ${wrong.length} câu sai</summary><div style="margin-top:8px;display:grid;gap:6px">${wrong.slice(0,30).map(item => `<div style="padding:8px 10px;border-radius:10px;background:#fff1f2;color:#9f1239;font-size:12px;line-height:1.5"><b>Câu ${esc(item.number || '')}</b>${item.prompt ? ` · ${esc(item.prompt)}` : ''}</div>`).join('')}</div></details>` : '<div style="margin-top:8px;font-size:12px;font-weight:700;color:#15803d">Không ghi nhận câu sai.</div>';
      return `<article style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:15px 16px;box-shadow:0 8px 24px rgba(15,23,42,.05)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">
          <div style="min-width:0"><div style="font-size:12px;font-weight:800;color:#2563eb;text-transform:uppercase;letter-spacing:.04em">${esc(kindLabel(row.sourceType || row.kind))}</div><div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:4px;overflow-wrap:anywhere">${esc(row.sourceTitle || row.title || `Bài làm ${index+1}`)}</div><div style="font-size:12px;color:#64748b;margin-top:5px">${esc(dateLabel(row.completedAt))}</div></div>
          <div style="flex:0 0 auto;text-align:right"><div style="font-size:22px;font-weight:900;color:#0f172a">${esc(scoreText(row))}</div><div style="font-size:12px;font-weight:800;color:#64748b">${percentage(row)}%</div></div>
        </div>
        <div style="height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-top:12px"><div style="height:100%;width:${percentage(row)}%;background:#2563eb;border-radius:999px"></div></div>
        ${details}
      </article>`;
    }).join('')}</div>`;
  }

  async function loadHistory() {
    ensureModal();
    overlay.style.display = 'flex';
    body.innerHTML = '<div style="padding:38px 14px;text-align:center;color:#64748b;font-weight:650">Đang tải lịch sử làm bài…</div>';
    const seq = ++openSeq;
    const token = authToken();
    if (token) {
      try {
        const response = await fetch(API, {cache:'no-store', headers:{Authorization:`Bearer ${token}`}});
        if (response.ok) {
          const data = await response.json();
          if (seq === openSeq) renderRows(data.value || []);
          return;
        }
      } catch {}
    }
    if (seq === openSeq) renderRows(localResults());
  }

  function patchHeader() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const help = buttons.find(button => /Trợ giúp\s*\/\s*Help/i.test(button.textContent || ''))
      || buttons.find(button => button.dataset.bioeduHistoryButton === '1');
    if (help) {
      help.dataset.bioeduHistoryButton = '1';
      if (help.textContent !== 'Lịch sử làm bài / Attempt History') {
        help.textContent = 'Lịch sử làm bài / Attempt History';
      }
      help.setAttribute('aria-label', 'Lịch sử làm bài');
      help.onclick = loadHistory;
      const icon = help.parentElement?.querySelector('span');
      if (icon) {
        if (icon.textContent !== '↺') icon.textContent = '↺';
        icon.style.cursor = 'pointer';
        icon.title = 'Lịch sử làm bài';
        icon.setAttribute('role', 'button');
        icon.setAttribute('tabindex', '0');
        icon.onclick = loadHistory;
        icon.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            loadHistory();
          }
        };
      }
    }
    buttons
      .filter(button => /Hỏi Biola\s*\/\s*Ask Biola/i.test(button.textContent || ''))
      .forEach(button => button.remove());
  }

  const observer = new MutationObserver(patchHeader);
  observer.observe(document.documentElement, {childList:true,subtree:true});
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patchHeader);
  else patchHeader();
})();
