import { TEAMS, TUNE } from './constants.js';
import { clamp01 } from './utils.js';

const css = (hex) => '#' + hex.toString(16).padStart(6, '0');

export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="vignette"></div>

      <div id="scoreboard" class="hidden">
        <div class="sb-team" id="sb-a"><span class="sb-poss" id="poss-a">▶</span><span class="sb-abbr"></span><span class="sb-score">0</span></div>
        <div class="sb-mid">
          <div class="sb-clock">3:00</div>
          <div class="sb-period">Q1</div>
          <div class="sb-shot">24</div>
        </div>
        <div class="sb-team right" id="sb-b"><span class="sb-score">0</span><span class="sb-abbr"></span><span class="sb-poss" id="poss-b">◀</span></div>
      </div>

      <div id="meter" class="hidden">
        <div id="meter-perfect"></div>
        <div id="meter-fill"></div>
      </div>
      <div id="grade" class="hidden"></div>
      <div id="toasts"></div>
      <div id="overlay" class="hidden"><div id="overlay-big"></div><div id="overlay-small"></div></div>

      <div id="hint" class="hidden">
        <b>CONTROLS</b>
        <span><i>WASD</i> move</span><span><i>SHIFT</i> sprint</span>
        <span><i>SPACE</i> shoot (hold &amp; release) / jump</span>
        <span><i>E</i> pass / steal</span><span><i>Q</i> switch defender</span>
        <span><i>C</i> camera &nbsp;<i>P</i> pause &nbsp;<i>M</i> mute &nbsp;<i>H</i> hide</span>
      </div>

      <div id="menu">
        <div class="menu-panel">
          <h1>FABLEMAX <span>NBA 3D</span></h1>
          <p class="tagline">5-on-5 arcade basketball · full physics · procedural crowd of thousands</p>
          <div class="menu-row"><label>YOUR TEAM</label><div class="teams" id="pick-user"></div></div>
          <div class="menu-row"><label>OPPONENT</label><div class="teams" id="pick-opp"></div></div>
          <div class="menu-row split">
            <div><label>QUARTER LENGTH</label><div class="opts" id="pick-q">
              <button data-v="1">1 MIN</button><button data-v="2" class="sel">2 MIN</button>
              <button data-v="3">3 MIN</button><button data-v="5">5 MIN</button></div></div>
            <div><label>QUALITY</label><div class="opts" id="pick-gfx">
              <button data-v="low">LOW</button><button data-v="medium">MED</button>
              <button data-v="high" class="sel">HIGH</button></div></div>
          </div>
          <button id="start-btn">TIP-OFF&nbsp;&nbsp;▶</button>
          <p class="menu-controls">WASD move · SHIFT sprint · SPACE shoot (hold &amp; release at the top) · E pass/steal · Q switch · C camera</p>
        </div>
      </div>

      <div id="modal" class="hidden"><div class="menu-panel" id="modal-inner"></div></div>
    `;

    this.$ = (id) => root.querySelector(id);
    this.scoreEls = {
      a: root.querySelector('#sb-a .sb-score'),
      b: root.querySelector('#sb-b .sb-score'),
      abbrA: root.querySelector('#sb-a .sb-abbr'),
      abbrB: root.querySelector('#sb-b .sb-abbr'),
      clock: root.querySelector('.sb-clock'),
      period: root.querySelector('.sb-period'),
      shot: root.querySelector('.sb-shot'),
      possA: this.$('#poss-a'),
      possB: this.$('#poss-b'),
    };
    this._sbCache = '';
    this._overlayTimer = null;
    this._gradeTimer = null;

    this.sel = { user: 0, opp: 1, quarters: 2, quality: 'high' };
    this._buildTeamPickers();
    this._bindOpts('#pick-q', (v) => { this.sel.quarters = Number(v); });
    this._bindOpts('#pick-gfx', (v) => { this.sel.quality = v; });

    this.onStart = null;
    this.$('#start-btn').addEventListener('click', () => {
      if (this.sel.opp === this.sel.user) this.sel.opp = (this.sel.user + 1) % TEAMS.length;
      this.onStart && this.onStart({ ...this.sel });
    });

    this._hintTimer = setTimeout(() => this.$('#hint').classList.add('faded'), 14000);
  }

  _buildTeamPickers() {
    for (const [id, key, other] of [['#pick-user', 'user', 'opp'], ['#pick-opp', 'opp', 'user']]) {
      const holder = this.$(id);
      TEAMS.forEach((t, i) => {
        const b = document.createElement('button');
        b.className = 'team-card' + (this.sel[key] === i ? ' sel' : '');
        b.style.setProperty('--c1', css(t.primary));
        b.style.setProperty('--c2', css(t.secondary));
        b.innerHTML = `<b>${t.id}</b><span>${t.city}</span>`;
        b.addEventListener('click', () => {
          if (this.sel[other] === i) return;
          this.sel[key] = i;
          holder.querySelectorAll('.team-card').forEach((el, j) => el.classList.toggle('sel', j === i));
        });
        holder.appendChild(b);
      });
    }
  }

  _bindOpts(id, cb) {
    const holder = this.$(id);
    holder.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      holder.querySelectorAll('button').forEach((el) => el.classList.toggle('sel', el === b));
      cb(b.dataset.v);
    });
  }

  showMenu() { this.$('#menu').classList.remove('hidden'); this.$('#scoreboard').classList.add('hidden'); this.$('#hint').classList.add('hidden'); }
  hideMenu() {
    this.$('#menu').classList.add('hidden');
    this.$('#scoreboard').classList.remove('hidden');
    this.$('#hint').classList.remove('hidden', 'faded');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this.$('#hint').classList.add('faded'), 14000);
  }
  toggleHint() { this.$('#hint').classList.toggle('faded'); }

  // ------------------------------------------------------------------

  perFrame(game) {
    const s = game.hudState();
    const mm = Math.floor(s.clock / 60), ss = Math.floor(s.clock % 60);
    const key = `${s.scoreA}|${s.scoreB}|${mm}:${ss}|${s.periodLabel}|${Math.ceil(s.shot)}|${s.possession}`;
    if (key !== this._sbCache) {
      this._sbCache = key;
      const e = this.scoreEls;
      e.a.textContent = s.scoreA;
      e.b.textContent = s.scoreB;
      e.abbrA.textContent = s.abbrA;
      e.abbrB.textContent = s.abbrB;
      e.clock.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      e.period.textContent = s.periodLabel;
      e.shot.textContent = Math.max(0, Math.ceil(s.shot));
      e.shot.classList.toggle('danger', s.shot <= 5.2);
      e.possA.style.visibility = s.possession === 0 ? 'visible' : 'hidden';
      e.possB.style.visibility = s.possession === 1 ? 'visible' : 'hidden';
      this.root.querySelector('#sb-a').style.setProperty('--tc', s.colA);
      this.root.querySelector('#sb-b').style.setProperty('--tc', s.colB);
    }

    // Shot meter
    const c = game.controlled;
    const meter = this.$('#meter');
    if (c && c.state === 'windup' && game.userTeam === c.team && !c.aiShot) {
      meter.classList.remove('hidden');
      this.$('#meter-fill').style.height = `${c.meterCharge * 100}%`;
      const perfTop = (1 - (TUNE.METER_PERFECT + TUNE.METER_WINDOW)) * 100;
      const perfH = TUNE.METER_WINDOW * 2 * 100;
      const pe = this.$('#meter-perfect');
      pe.style.top = `${perfTop}%`;
      pe.style.height = `${perfH}%`;
    } else {
      meter.classList.add('hidden');
    }
  }

  showGrade(text) {
    const g = this.$('#grade');
    g.textContent = text;
    g.className = 'grade-' + (text === 'PERFECT!' ? 'perfect' : text === 'GOOD' ? 'good' : 'bad');
    clearTimeout(this._gradeTimer);
    this._gradeTimer = setTimeout(() => g.classList.add('hidden'), 900);
  }

  toast(text, colorNum = 0xffffff) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--tc', css(colorNum));
    t.textContent = text;
    this.$('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2800);
  }

  showOverlay(big, small, dur = 2) {
    const o = this.$('#overlay');
    this.$('#overlay-big').textContent = big;
    this.$('#overlay-small').textContent = small;
    o.classList.remove('hidden');
    clearTimeout(this._overlayTimer);
    this._overlayTimer = setTimeout(() => o.classList.add('hidden'), dur * 1000);
  }

  // ------------------------------------------------------------------
  // Pause / end modals
  // ------------------------------------------------------------------

  boxScore(game) {
    const row = (p) => `<tr><td class="nm">${p.name}<i>${p.roleName}</i></td>
      <td>${p.stats.pts}</td><td>${p.stats.reb}</td><td>${p.stats.ast}</td>
      <td>${p.stats.stl}</td><td>${p.stats.blk}</td><td>${p.stats.fgm}/${p.stats.fga}</td><td>${p.stats.tpm}/${p.stats.tpa}</td></tr>`;
    const table = (t) => {
      const td = game.teamData[t];
      const ps = game.players.filter((p) => p.team === t);
      return `<div class="box"><h3 style="--tc:${css(td.primary)}">${td.city} ${td.name} — ${game.score[t]}</h3>
        <table><thead><tr><th></th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>3PT</th></tr></thead>
        <tbody>${ps.map(row).join('')}</tbody></table></div>`;
    };
    return table(0) + table(1);
  }

  showPause(game, { onResume, onRestart, onMute, muted }) {
    const m = this.$('#modal');
    m.classList.remove('hidden');
    this.$('#modal-inner').innerHTML = `
      <h2>PAUSED</h2>
      <div class="modal-btns">
        <button id="btn-resume">RESUME</button>
        <button id="btn-mute">${muted ? 'UNMUTE' : 'MUTE'} SOUND</button>
        <button id="btn-restart">QUIT TO MENU</button>
      </div>
      <div class="boxes">${this.boxScore(game)}</div>`;
    this.$('#btn-resume').addEventListener('click', onResume);
    this.$('#btn-restart').addEventListener('click', onRestart);
    this.$('#btn-mute').addEventListener('click', (e) => {
      const nowMuted = onMute();
      e.target.textContent = `${nowMuted ? 'UNMUTE' : 'MUTE'} SOUND`;
    });
  }

  hideModal() { this.$('#modal').classList.add('hidden'); }
  get modalOpen() { return !this.$('#modal').classList.contains('hidden'); }

  showEnd(game, { onAgain } = {}) {
    const m = this.$('#modal');
    m.classList.remove('hidden');
    const w = game.score[0] >= game.score[1] ? 0 : 1;
    const td = game.teamData[w];
    let mvp = null;
    for (const p of game.players) {
      const v = p.stats.pts + p.stats.reb * 0.8 + p.stats.ast + p.stats.stl + p.stats.blk;
      if (!mvp || v > mvp.v) mvp = { p, v };
    }
    this.$('#modal-inner').innerHTML = `
      <h2 style="color:${css(td.secondary)}">${td.city.toUpperCase()} WINS!</h2>
      <p class="final">${game.teamData[0].id} ${game.score[0]} — ${game.score[1]} ${game.teamData[1].id}
      &nbsp;·&nbsp; MVP: ${mvp.p.name} (${mvp.p.stats.pts} pts)</p>
      <div class="modal-btns"><button id="btn-again">BACK TO MENU</button></div>
      <div class="boxes">${this.boxScore(game)}</div>`;
    this.$('#btn-again').addEventListener('click', () => { this.hideModal(); onAgain && onAgain(); });
  }
}
