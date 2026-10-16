// Comportamentos da página (trilha de leitura, memória, grafo, virada, mapa, teste, formulários).
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Progresso (0..1) de uma seção alta com conteúdo sticky.
function stickyProgress(section) {
  const r = section.getBoundingClientRect();
  const span = r.height - innerHeight;
  return span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span));
}
const scrollHandlers = [];
let ticking = false;
addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { scrollHandlers.forEach((fn) => fn()); ticking = false; });
}, { passive: true });
addEventListener('resize', () => scrollHandlers.forEach((fn) => fn()));

// Aleatório determinístico e bem distribuído (mulberry32).
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Trilha de leitura no topo. Desktop: um segmento clicável por seção.
// Celular: uma barra contínua + botão que abre a lista de seções (alvo de toque grande).
const hud = document.querySelector('[data-hud]');
if (hud) {
  const track = hud.querySelector('[data-hud-track]');
  const stageEl = hud.querySelector('[data-hud-stage]');
  const menuBtn = hud.querySelector('[data-hud-menu]');
  const menu = hud.querySelector('[data-hud-list]');
  const stages = [...document.querySelectorAll('[data-hero], [data-stage]')];
  const fills = stages.map((s, i) => {
    if (!s.id) s.id = 'secao-' + (i + 1);
    const a = document.createElement('a');
    a.href = '#' + s.id;
    a.setAttribute('aria-label', `Ir para a parte ${i + 1}: ${s.dataset.stageName || ''}`);
    a.innerHTML = '<i><b></b></i>';
    track.appendChild(a);
    if (menu) {
      const li = document.createElement('li');
      const m = document.createElement('a');
      m.href = '#' + s.id;
      m.textContent = `${i + 1}. ${s.dataset.stageName || ''}`;
      m.addEventListener('click', () => { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); });
      li.appendChild(m); menu.appendChild(li);
    }
    return a;
  });
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.focus(); } });
  }
  const total = hud.querySelector('[data-hud-total]');
  scrollHandlers.push(() => {
    const mid = innerHeight * 0.5;
    let idx = 0;
    stages.forEach((s, i) => { if (s.getBoundingClientRect().top < mid) idx = i; });
    stages.forEach((s, i) => {
      let f = i < idx ? 1 : 0;
      if (i === idx) {
        const r = s.getBoundingClientRect();
        f = Math.min(1, Math.max(0, (mid - r.top) / Math.max(1, r.height)));
      }
      fills[i].firstChild.firstChild.style.scale = `${f.toFixed(3)} 1`;
      fills[i].classList.toggle('now', i === idx);
    });
    const name = stages[idx].dataset.stageName;
    stageEl.innerHTML = `<b>${idx + 1}/${stages.length}</b>` + (name ? `<span> · ${name}</span>` : '');
    if (menuBtn) menuBtn.querySelector('span').textContent = `${idx + 1}/${stages.length} · ${name || ''}`;
    if (total) total.style.scale = `${Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)).toFixed(3)} 1`;
  });
  requestAnimationFrame(() => scrollHandlers.forEach((fn) => fn()));
}

// Formulários de lead (sem backend: só confirmação). Com data-segment, pergunta a prova-alvo em 1 clique.
document.querySelectorAll('form[data-lead]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = form.querySelector('input[type="email"]');
    if (email && !email.checkValidity()) { email.reportValidity(); return; }
    const box = document.createElement('div');
    box.className = 'lead-done';
    box.setAttribute('role', 'status');
    const p = document.createElement('p');
    p.textContent = form.dataset.done || 'Pronto. A aula 1 está a caminho do seu e-mail.';
    box.appendChild(p);
    if (form.hasAttribute('data-segment')) {
      const q = document.createElement('p');
      q.className = 'seg-q';
      q.textContent = 'Para qual prova você estuda? (opcional)';
      const row = document.createElement('div');
      row.className = 'seg';
      ['ITA / IME', 'AFA / EN / EFOMM', 'EEAR / EAM', 'Outra'].forEach((label) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = label;
        b.addEventListener('click', () => {
          row.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          q.textContent = `Anotado: ${label}. A aula 1 chega com exemplos dessa prova.`;
        });
        row.appendChild(b);
      });
      box.append(q, row);
    }
    form.replaceWith(box);
  });
});

// Memória que apaga com a rolagem.
// - zona segura de leitura nos primeiros 22%;
// - queda rápida no começo e estabilização (curva de esquecimento, não linha reta);
// - palavras em [data-keep] nunca somem: no fim, o que sobra forma outra frase;
// - data-forget-days="seg,ter,..." mostra o dia da semana no medidor.
document.querySelectorAll('[data-forget-section]').forEach((section) => {
  const chars = [];
  const rnd = seeded(0x9e3779b9);
  const split = (node, keep) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 1) { split(n, keep || n.hasAttribute('data-keep')); return; }
      if (n.nodeType !== 3) return;
      const frag = document.createDocumentFragment();
      n.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(' '); return; }
        const w = document.createElement('span');
        w.style.whiteSpace = 'nowrap';
        w.setAttribute('aria-hidden', 'true');
        [...part].forEach((c) => {
          const s = document.createElement('span');
          s.textContent = c;
          s.style.display = 'inline-block';
          s.style.transition = 'opacity .3s, translate .3s, color .4s';
          s.dataset.t = keep ? '9' : (0.22 + Math.pow(rnd(), 2.2) * 0.72).toFixed(3);
          if (keep) s.className = 'keep';
          w.appendChild(s); chars.push(s);
        });
        frag.append(w);
      });
      n.replaceWith(frag);
    });
  };
  section.querySelectorAll('[data-forget]').forEach((el) => {
    el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    split(el, false);
  });
  const meter = section.querySelector('[data-forget-meter]');
  const day = section.querySelector('[data-forget-day]');
  const names = day && day.closest('[data-forget-days]') ? day.closest('[data-forget-days]').dataset.forgetDays.split(',') : null;
  const update = () => {
    const p = reduceMotion ? 0 : stickyProgress(section);
    let keptN = 0;
    chars.forEach((c) => {
      const gone = p > +c.dataset.t;
      if (!gone) keptN++;
      if (c._gone === gone) return;
      c._gone = gone;
      c.style.opacity = gone ? '0.06' : '1';
      c.style.translate = gone ? '0 6px' : '0 0';
    });
    section.classList.toggle('is-end', p > 0.9);
    const kept = Math.round(100 * keptN / chars.length);
    if (meter) meter.textContent = kept + '%';
    const dp = Math.min(1, Math.max(0, (p - 0.22) / 0.72));
    if (day) {
      if (names) day.textContent = names[Math.round(dp * (names.length - 1))];
      else day.textContent = Math.round(dp * 7);
    }
    section.dispatchEvent(new CustomEvent('forget', { detail: kept }));
  };
  scrollHandlers.push(update); update();
});

// Virada: lousa → cena colorida → círculo com a nova identidade.
document.querySelectorAll('[data-wipe-section]').forEach((section) => {
  const layer = section.querySelector('[data-wipe]');
  const layer2 = section.querySelector('[data-wipe2]');
  const steps = section.querySelectorAll('[data-wipe-step]');
  if (reduceMotion) {
    layer.style.clipPath = 'none';
    steps.forEach((s) => s.classList.add('on'));
    if (layer2) {
      layer2.classList.add('static');
      layer2.removeAttribute('aria-hidden');
      layer2.querySelectorAll('[tabindex="-1"]').forEach((el) => el.removeAttribute('tabindex'));
    }
    return;
  }
  const update = () => {
    const p = stickyProgress(section);
    const a = layer2 ? Math.min(1, p / 0.55) : p;
    layer.style.clipPath = `inset(0 0 0 ${((1 - a) * 100).toFixed(2)}%)`;
    if (layer2) {
      const b = Math.min(1, Math.max(0, (p - 0.62) / 0.3));
      layer2.style.clipPath = `circle(${(b * 150).toFixed(1)}% at 88% 82%)`;
      const open = b >= 0.5;
      layer2.setAttribute('aria-hidden', open ? 'false' : 'true');
      layer2.querySelectorAll('a, button').forEach((el) => (open ? el.removeAttribute('tabindex') : el.setAttribute('tabindex', '-1')));
    }
    steps.forEach((s) => s.classList.toggle('on', p >= +s.dataset.wipeStep));
  };
  scrollHandlers.push(update); update();
});

// Mesa de estudo como grafo: cada material é um nó isolado num campo de pontos a giz.
// Com a rolagem, o nó Spiral aparece no centro e solta linhas até cada cartão;
// uma onda acende o grafo a partir dele. Os cartões ficam no lugar (você mantém seus materiais).
document.querySelectorAll('[data-graph-section]').forEach((section) => {
  const box = section.querySelector('[data-graph]');
  const cards = [...box.querySelectorAll('[data-node]')];
  const hub = box.querySelector('[data-graph-hub]');
  const steps = section.querySelectorAll('[data-graph-step]');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'graph-svg');
  svg.setAttribute('aria-hidden', 'true');
  box.prepend(svg);
  cards.forEach((c) => {
    const [x, y] = c.dataset.node.split(',').map(Number);
    c.style.left = x + '%'; c.style.top = y + '%';
  });

  let bgEdges = [], links = [], maxD = 1;
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.append(n); return n;
  };
  const build = () => {
    const W = box.clientWidth, H = box.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.textContent = '';
    const cx = W / 2, cy = H / 2;
    // campo de fundo: pontos ligados aos vizinhos mais próximos
    const rnd = seeded(7);
    const n = Math.round(Math.min(70, Math.max(34, W * H / 5200)));
    const pts = Array.from({ length: n }, () => [8 + rnd() * (W - 16), 8 + rnd() * (H - 16)]);
    const gBg = el('g', { class: 'g-bg' }, svg);
    bgEdges = [];
    const seen = new Set();
    pts.forEach((a, i) => {
      pts.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2])
        .filter(([j]) => j !== i).sort((u, v) => u[1] - v[1]).slice(0, 2)
        .forEach(([j]) => {
          const key = i < j ? i + '-' + j : j + '-' + i;
          if (seen.has(key)) return; seen.add(key);
          const b = pts[j];
          const line = el('line', { x1: a[0].toFixed(1), y1: a[1].toFixed(1), x2: b[0].toFixed(1), y2: b[1].toFixed(1) }, gBg);
          bgEdges.push({ line, d: Math.hypot((a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy) });
        });
    });
    pts.forEach((a) => el('circle', { cx: a[0].toFixed(1), cy: a[1].toFixed(1), r: 2.2 }, gBg));
    maxD = Math.hypot(cx, cy);
    // ligações do Spiral até cada cartão (curvas leves, como traço de giz)
    const gLink = el('g', { class: 'g-link' }, svg);
    links = cards.map((c, i) => {
      const x = c.offsetLeft, y = c.offsetTop;
      const mx = (cx + x) / 2 + (y - cy) * 0.12, my = (cy + y) / 2 - (x - cx) * 0.12;
      const path = el('path', { d: `M${cx},${cy} Q${mx.toFixed(1)},${my.toFixed(1)} ${x},${y}`, id: 'glink' + i }, gLink);
      const len = path.getTotalLength();
      path.style.strokeDasharray = len; path.style.strokeDashoffset = len;
      let dot = null;
      if (!reduceMotion) {
        dot = el('circle', { r: 4, class: 'g-pulse' }, gLink);
        const m = el('animateMotion', { dur: (2.2 + i * 0.25) + 's', repeatCount: 'indefinite' }, dot);
        el('mpath', { href: '#glink' + i }, m);
      }
      return { path, len, dot, card: c };
    });
  };

  const ease = (k) => k * k * (3 - 2 * k);
  const clamp = (k) => Math.min(1, Math.max(0, k));
  const update = () => {
    const p = reduceMotion ? 1 : stickyProgress(section);
    const h = ease(clamp((p - 0.28) / 0.14));
    hub.style.opacity = h.toFixed(3);
    hub.style.scale = (0.8 + 0.2 * h).toFixed(3);
    links.forEach((l, i) => {
      const e = ease(clamp((p - (0.4 + i * 0.05)) / 0.18));
      l.path.style.strokeDashoffset = (l.len * (1 - e)).toFixed(1);
      l.path.style.opacity = e > 0 ? 1 : 0;
      l.card.classList.toggle('linked', e >= 1);
      if (l.dot) l.dot.style.opacity = e >= 1 ? 1 : 0;
    });
    const R = ease(clamp((p - 0.4) / 0.5)) * maxD;
    bgEdges.forEach((b) => b.line.classList.toggle('lit', b.d < R));
    steps.forEach((s) => s.classList.toggle('on', p >= +s.dataset.graphStep));
  };
  build(); update();
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { build(); update(); }, 150); });
  if (!reduceMotion) scrollHandlers.push(update);
});

// Mascote que anda pelo mapa a velocidade constante (por comprimento de trilha).
document.querySelectorAll('[data-walk-section]').forEach((section) => {
  const walker = section.querySelector('[data-walker]');
  const pts = JSON.parse(walker.dataset.path); // [[x%, y%], ...]
  const aspect = +(walker.dataset.aspect || 1.79);
  const items = section.querySelectorAll('[data-stop]');
  const note = section.querySelector('[data-walk-note]');
  const seg = pts.slice(1).map((q, i) => Math.hypot((q[0] - pts[i][0]) * aspect, q[1] - pts[i][1]));
  const len = seg.reduce((a, b) => a + b, 0);
  let lastDir = 1;
  const update = () => {
    const p = reduceMotion ? 1 : stickyProgress(section);
    let d = Math.min(0.9999, p) * len, i = 0;
    while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
    const t = seg[i] ? d / seg[i] : 0;
    const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
    const y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    walker.style.left = x + '%';
    walker.style.top = y + '%';
    const dx = pts[i + 1][0] - pts[i][0];
    if (Math.abs(dx) > 0.5) lastDir = dx < 0 ? -1 : 1; // evita virar em trechos verticais
    walker.style.scale = `${lastDir} 1`;
    items.forEach((el) => el.classList.toggle('on', p >= +el.dataset.stop));
    if (note) note.classList.toggle('on', p >= 0.95);
  };
  scrollHandlers.push(update); update();
});

// Barra de inscrição fixa (modelos antigos).
const sticky = document.querySelector('[data-sticky-cta]');
if (sticky) {
  const hero = document.querySelector('[data-hero]');
  const final = document.querySelector('[data-final]');
  let heroOut = false, finalIn = false;
  const sync = () => sticky.classList.toggle('show', heroOut && !finalIn);
  new IntersectionObserver(([e]) => { heroOut = !e.isIntersecting; sync(); }).observe(hero);
  new IntersectionObserver(([e]) => { finalIn = e.isIntersecting; sync(); }).observe(final);
}

// Números que contam quando aparecem (zerados antes, para não piscar 23 → 0 → 23).
const counters = document.querySelectorAll('[data-count]');
if (counters.length) {
  if (!reduceMotion) counters.forEach((c) => (c.textContent = '0' + (c.dataset.suffix || '')));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target, end = +el.dataset.count;
    io.unobserve(el);
    if (reduceMotion) { el.textContent = end + (el.dataset.suffix || ''); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + (el.dataset.suffix || '');
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  counters.forEach((c) => io.observe(c));
}

// Revelação simples para elementos marcados.
const reveal = document.querySelectorAll('[data-reveal]');
if (reveal.length) {
  const io2 = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io2.unobserve(e.target); }
  }), { threshold: 0.2 });
  reveal.forEach((el) => io2.observe(el));
}

// Pré-teste de 1 questão (estado acessível: não depende só de cor).
document.querySelectorAll('[data-quiz]').forEach((quiz) => {
  const out = quiz.querySelector('[data-quiz-out]');
  const opts = quiz.querySelectorAll('button[data-opt]');
  opts.forEach((b) => b.addEventListener('click', () => {
    if (quiz.dataset.done) return;
    quiz.dataset.done = '1';
    const right = b.dataset.opt === quiz.dataset.right;
    b.classList.add(right ? 'right' : 'wrong');
    b.setAttribute('aria-pressed', 'true');
    const correct = quiz.querySelector(`button[data-opt="${quiz.dataset.right}"]`);
    correct.classList.add('right');
    correct.insertAdjacentHTML('beforeend', ' <span class="mark">(resposta mais forte)</span>');
    if (!right) b.insertAdjacentHTML('beforeend', ' <span class="mark">(sua escolha)</span>');
    opts.forEach((x) => x.setAttribute('aria-disabled', 'true'));
    out.hidden = false;
    out.querySelector('[data-quiz-verdict]').textContent = right
      ? (quiz.dataset.yes || 'Você escolheu a mais forte.')
      : (quiz.dataset.no || 'Não era a mais forte.');
  }));
});

// Atalho de teste: #at=classe-da-secao:fracao rola até um ponto exato (usado nos prints de revisão).
(() => {
  const m = location.hash.match(/^#at=([\w-]+):([\d.]+)$/);
  if (!m) return;
  document.documentElement.style.scrollBehavior = 'auto';
  const go = () => {
    const s = document.querySelector('.' + m[1]);
    if (!s) return;
    const top = s.getBoundingClientRect().top + scrollY;
    scrollTo(0, top + Math.max(0, s.offsetHeight - innerHeight) * +m[2] + (s.offsetHeight <= innerHeight ? -60 : 0));
    scrollHandlers.forEach((fn) => fn());
  };
  addEventListener('load', () => { go(); setTimeout(go, 300); });
})();

// Mascote guia (modelo M3).
const guide = document.querySelector('[data-guide]');
if (guide) {
  const img = guide.querySelector('img');
  const say = guide.querySelector('[data-guide-say]');
  const io3 = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const el = e.target;
    if (el.dataset.face) img.src = 'img/mascote-' + el.dataset.face + '.webp';
    if (say && el.dataset.say) say.textContent = el.dataset.say;
  }), { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('[data-face]').forEach((el) => io3.observe(el));
}
