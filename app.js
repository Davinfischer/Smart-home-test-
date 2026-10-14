(function () {
  'use strict';

  /* ---------- Helfer ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function $(s) { return document.querySelector(s); }
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      for (var j = 0; j < kids.length; j++) {
        var kid = kids[j];
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return el;
  }
  function fmt(n) {
    var x = Number(n);
    return isNaN(x) ? String(n) : x.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  }
  function toast(msg) {
    var t = $('#toast');
    if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = msg;
    t.setAttribute('data-show', '1');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.removeAttribute('data-show'); }, 3200);
  }

  var ICONS = {
    light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
    switch: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5',
    cover: 'M4 3h16M5 3v12M19 3v12M5 7h14M5 11h14M12 15v6',
    climate: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
    media_player: 'M5 4l14 8-14 8z',
    vacuum: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    sensor: 'M3 12h4l3-8 4 16 3-8h4',
    binary_sensor: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v4M12 16h.01',
    scene: 'M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 16.8 6.4 20.2 8 13.8 3 9.5 9.5 9z'
  };
  function icon(name) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', ICONS[name] || ICONS.sensor);
    s.append(p);
    return s;
  }

  var ORDER = ['light', 'switch', 'cover', 'climate', 'lock', 'media_player', 'vacuum', 'scene', 'sensor', 'binary_sensor'];
  var LABEL = {
    light: 'Lichter', switch: 'Steckdosen und Schalter', cover: 'Rollläden und Tore', climate: 'Heizung und Klima',
    lock: 'Schlösser', media_player: 'Medien', vacuum: 'Saugroboter', scene: 'Szenen',
    sensor: 'Sensoren', binary_sensor: 'Kontakte und Melder'
  };
  var SENSOR_CLASSES = ['temperature', 'humidity', 'power', 'energy', 'illuminance', 'co2', 'pressure'];
  var BIN_CLASSES = ['door', 'window', 'opening', 'garage_door', 'motion', 'occupancy', 'presence', 'smoke', 'moisture'];

  /* ---------- Zustand ---------- */
  var S = {
    mode: null,          // 'demo' | 'ha' | null
    conn: 'off',         // 'off' | 'connecting' | 'ok' | 'bad'
    ent: new Map(),      // entity_id -> {id, state, attr}
    area: new Map(),     // entity_id -> Raumname
    hidden: new Set(),
    room: null,
    q: '',
    drag: false,
    arm: null            // Schloss, das zum Öffnen bestätigt werden muss
  };

  function dom(id) { return id.split('.')[0]; }
  function nameOf(e) { return e.attr.friendly_name || e.id; }

  function shown(e) {
    var d = dom(e.id);
    if (ORDER.indexOf(d) < 0 || S.hidden.has(e.id)) return false;
    if (d === 'sensor') return SENSOR_CLASSES.indexOf(e.attr.device_class) >= 0 && e.attr.unit_of_measurement != null;
    if (d === 'binary_sensor') return BIN_CLASSES.indexOf(e.attr.device_class) >= 0;
    return true;
  }
  function isOn(e) {
    var s = e.state;
    switch (dom(e.id)) {
      case 'light': case 'switch': case 'binary_sensor': return s === 'on';
      case 'cover': return s === 'open' || s === 'opening';
      case 'climate': return s !== 'off' && s !== 'unavailable';
      case 'lock': return s === 'unlocked' || s === 'open';
      case 'media_player': return s === 'playing';
      case 'vacuum': return s === 'cleaning';
      default: return false;
    }
  }
  function statusText(e) {
    var a = e.attr, s = e.state, d = dom(e.id);
    if (s === 'unavailable') return 'Nicht erreichbar';
    if (s === 'unknown') return 'Unbekannt';
    switch (d) {
      case 'light':
        if (s !== 'on') return 'Aus';
        return a.brightness != null ? Math.round(a.brightness / 255 * 100) + ' %' : 'An';
      case 'switch': return s === 'on' ? 'An' : 'Aus';
      case 'cover': {
        var t = { open: 'Offen', closed: 'Geschlossen', opening: 'Öffnet', closing: 'Schließt' }[s] || s;
        return a.current_position != null ? t + ' · ' + a.current_position + ' %' : t;
      }
      case 'climate': {
        var parts = [];
        if (a.current_temperature != null) parts.push(fmt(a.current_temperature) + ' °C');
        if (a.temperature != null && s !== 'off') parts.push('Ziel ' + fmt(a.temperature) + ' °C');
        if (s === 'off') parts.push('Aus');
        return parts.join(' · ') || s;
      }
      case 'lock': return { locked: 'Verriegelt', unlocked: 'Offen', open: 'Offen', locking: 'Verriegelt…', unlocking: 'Öffnet…', jammed: 'Klemmt' }[s] || s;
      case 'media_player': {
        var m = { playing: 'Spielt', paused: 'Pausiert', idle: 'Bereit', off: 'Aus', standby: 'Bereit', on: 'An' }[s] || s;
        return a.media_title && s !== 'off' ? m + ' · ' + a.media_title : m;
      }
      case 'vacuum': return { cleaning: 'Saugt', docked: 'In der Station', returning: 'Fährt zurück', paused: 'Pausiert', idle: 'Bereit', error: 'Fehler' }[s] || s;
      case 'scene': return 'Szene';
      case 'sensor': return fmt(s) + (a.unit_of_measurement ? ' ' + a.unit_of_measurement : '');
      case 'binary_sensor': {
        var on = s === 'on', c = a.device_class;
        if (c === 'door' || c === 'window' || c === 'opening' || c === 'garage_door') return on ? 'Offen' : 'Zu';
        if (c === 'motion' || c === 'occupancy' || c === 'presence') return on ? 'Bewegung' : 'Ruhig';
        if (c === 'smoke') return on ? 'Alarm' : 'In Ordnung';
        if (c === 'moisture') return on ? 'Nass' : 'Trocken';
        return on ? 'An' : 'Aus';
      }
    }
    return s;
  }

  /* ---------- Steuern ---------- */
  function call(domain, service, data, id) {
    if (S.mode === 'demo') { demoCall(domain, service, data || {}, id); return; }
    if (S.mode === 'ha') {
      if (!H.ws || H.ws.readyState !== 1) { toast('Keine Verbindung zu Home Assistant.'); return; }
      hsend({ type: 'call_service', domain: domain, service: service, service_data: data || {}, target: { entity_id: id } }, function (m) {
        if (m && m.success === false) toast('Home Assistant hat den Befehl abgelehnt.');
      });
      return;
    }
    var F = G.funcs.get(id);
    if (!F || S.mode !== 'gira') { toast('Keine Verbindung zum HomeServer.'); return; }
    var puts = giraCommand(F, domain, service, data || {}, S.ent.get(id));
    if (!puts.length) { toast('Dieses Gerät lässt sich so nicht steuern.'); return; }
    gput('/values', { values: puts }).then(function () {
      setTimeout(function () { pollIds([id]).then(schedule).catch(function () {}); }, 400);
    }).catch(function (err) {
      if (err && err.code === 'auth') onGiraError(err, 'session');
      else toast('Der HomeServer hat den Befehl nicht angenommen.');
    });
  }

  function tapAction(e) {
    var d = dom(e.id), id = e.id;
    if (e.state === 'unavailable') return null;
    switch (d) {
      case 'light': case 'switch': return function () { call(d, e.state === 'on' ? 'turn_off' : 'turn_on', {}, id); };
      case 'cover': return function () { call('cover', isOn(e) ? 'close_cover' : 'open_cover', {}, id); };
      case 'media_player': return function () { call('media_player', 'media_play_pause', {}, id); };
      case 'vacuum': return function () { call('vacuum', isOn(e) ? 'return_to_base' : 'start', {}, id); };
      case 'scene': return function () { call('scene', 'turn_on', {}, id); toast('Szene gestartet'); };
    }
    return null;
  }

  function extras(e) {
    var d = dom(e.id), a = e.attr, id = e.id;
    if (e.state === 'unavailable') return null;

    if (d === 'light' && e.state === 'on' && a.brightness != null) {
      var slider = h('input', {
        type: 'range', min: 1, max: 100, step: 1, id: 'r-' + id,
        value: Math.round(a.brightness / 255 * 100), 'aria-label': 'Helligkeit ' + nameOf(e),
        oninput: function () { S.drag = true; },
        onchange: function (ev) { S.drag = false; call('light', 'turn_on', { brightness_pct: Number(ev.target.value) }, id); }
      });
      return slider;
    }
    if (d === 'cover') {
      var kids = [
        h('button', { class: 'mini', onclick: function () { call('cover', 'open_cover', {}, id); } }, 'Auf'),
        h('button', { class: 'mini', onclick: function () { call('cover', 'stop_cover', {}, id); } }, 'Stopp'),
        h('button', { class: 'mini', onclick: function () { call('cover', 'close_cover', {}, id); } }, 'Zu')
      ];
      var out = [h('div', { class: 'row' }, kids)];
      if (a.current_position != null) {
        out.push(h('input', {
          type: 'range', min: 0, max: 100, step: 5, id: 'r-' + id, value: a.current_position,
          'aria-label': 'Position ' + nameOf(e),
          oninput: function () { S.drag = true; },
          onchange: function (ev) { S.drag = false; call('cover', 'set_cover_position', { position: Number(ev.target.value) }, id); }
        }));
      }
      return out;
    }
    if (d === 'climate' && a.temperature != null) {
      var step = a.target_temp_step || 0.5, lo = a.min_temp != null ? a.min_temp : 5, hi = a.max_temp != null ? a.max_temp : 30;
      var setT = function (v) { call('climate', 'set_temperature', { temperature: Math.min(hi, Math.max(lo, v)) }, id); };
      return h('div', { class: 'stepper' },
        h('button', { class: 'mini', 'aria-label': 'Kälter', onclick: function () { setT(a.temperature - step); } }, '−'),
        h('div', { class: 'val' }, fmt(a.temperature) + ' °'),
        h('button', { class: 'mini', 'aria-label': 'Wärmer', onclick: function () { setT(a.temperature + step); } }, '+')
      );
    }
    if (d === 'lock') {
      var locked = e.state === 'locked';
      if (locked) {
        var armed = S.arm === id;
        return h('button', {
          class: 'mini', 'data-warn': armed ? 1 : null,
          onclick: function () {
            if (S.arm === id) { S.arm = null; call('lock', 'unlock', {}, id); return; }
            S.arm = id; schedule();
            setTimeout(function () { if (S.arm === id) { S.arm = null; schedule(); } }, 4000);
          }
        }, armed ? 'Nochmal tippen zum Öffnen' : 'Öffnen');
      }
      return h('button', { class: 'mini', onclick: function () { call('lock', 'lock', {}, id); } }, 'Verriegeln');
    }
    if (d === 'vacuum') {
      return h('div', { class: 'row' },
        h('button', { class: 'mini', onclick: function () { call('vacuum', 'start', {}, id); } }, 'Start'),
        h('button', { class: 'mini', onclick: function () { call('vacuum', 'return_to_base', {}, id); } }, 'Zur Station')
      );
    }
    return null;
  }

  function card(e) {
    var d = dom(e.id), act = tapAction(e), label = nameOf(e);
    var ico = act
      ? h('button', { class: 'ico', onclick: act, 'aria-label': label + ': ' + statusText(e) }, icon(d))
      : h('div', { class: 'ico' }, icon(d));
    return h('article', { class: 'card', 'data-on': isOn(e) ? 1 : null, 'data-off': e.state === 'unavailable' ? 1 : null },
      h('div', { class: 'card-top' }, ico,
        h('div', { class: 'names' }, h('div', { class: 'name' }, label), h('div', { class: 'state' }, statusText(e)))),
      extras(e)
    );
  }

  /* ---------- Anzeige ---------- */
  var main = $('#main');
  var rt = 0;
  function schedule() {
    clearTimeout(rt);
    rt = setTimeout(function () { if (S.drag) { schedule(); return; } render(); }, 120);
  }

  function summary() {
    var all = [...S.ent.values()].filter(shown);
    if (!all.length) return '';
    var lights = all.filter(function (e) { return dom(e.id) === 'light' && e.state === 'on'; }).length;
    var locks = all.filter(function (e) { return dom(e.id) === 'lock'; });
    var open = locks.filter(function (e) { return e.state !== 'locked'; }).length;
    var parts = [lights === 1 ? '1 Licht an' : lights + ' Lichter an'];
    if (locks.length) parts.push(open ? (open === 1 ? '1 Schloss offen' : open + ' Schlösser offen') : 'alles verriegelt');
    var temps = all.filter(function (e) { return dom(e.id) === 'climate' && e.attr.current_temperature != null; });
    if (temps.length) {
      var avg = temps.reduce(function (s, e) { return s + Number(e.attr.current_temperature); }, 0) / temps.length;
      parts.push(fmt(avg) + ' °C innen');
    }
    return parts.join(' · ');
  }

  function setPill() {
    var p = $('#pill'), map = {
      demo: ['Demo', 'demo'], ok: ['Verbunden', 'ok'], connecting: ['Verbinde…', ''], bad: ['Getrennt', 'bad'], off: ['Nicht verbunden', '']
    };
    var k = S.mode === 'demo' ? 'demo' : S.conn;
    p.textContent = map[k][0];
    p.setAttribute('data-s', map[k][1]);
  }

  function sortList(list) {
    return list.sort(function (a, b) {
      var da = ORDER.indexOf(dom(a.id)), db = ORDER.indexOf(dom(b.id));
      return da - db || nameOf(a).localeCompare(nameOf(b), 'de');
    });
  }

  var ALLG = 'Allgemein';
  var ALL = '*alle*';
  function roomOf(e) { return S.area.get(e.id) || ALLG; }
  function emptyBox(title, text, buttons) {
    return h('div', { class: 'empty' }, h('h2', {}, title), h('p', {}, text), buttons);
  }
  function lightsOff(list) {
    list.forEach(function (e) { call('light', 'turn_off', {}, e.id); });
    toast(list.length + (list.length === 1 ? ' Licht ausgeschaltet' : ' Lichter ausgeschaltet'));
  }

  function setAll(list, domain, service, label) {
    list.forEach(function (e) { call(domain, service, {}, e.id); });
    toast(label + ': ' + list.length + (list.length === 1 ? ' Gerät' : ' Geräte'));
  }
  function groupedAll(items) {
    var wrap = h('div', {});
    ORDER.forEach(function (d) {
      var g = items.filter(function (e) { return dom(e.id) === d; });
      if (!g.length) return;
      var ok = g.filter(function (e) { return e.state !== 'unavailable'; });
      var acts = [];
      var btn = function (text, list, service) {
        if (list.length) acts.push(h('button', { class: 'chip', onclick: function () { setAll(list, d, service, text); } }, text));
      };
      if (d === 'light' || d === 'switch') {
        btn('Alle aus', ok.filter(function (e) { return e.state === 'on'; }), 'turn_off');
        btn('Alle an', ok.filter(function (e) { return e.state === 'off'; }), 'turn_on');
      } else if (d === 'cover') {
        btn('Alle auf', ok.filter(function (e) { return e.state !== 'open'; }), 'open_cover');
        btn('Alle zu', ok.filter(function (e) { return e.state !== 'closed'; }), 'close_cover');
      } else if (d === 'lock') {
        btn('Alle verriegeln', ok.filter(function (e) { return e.state === 'unlocked'; }), 'lock');
      }
      wrap.append(h('section', { class: 'sect' },
        h('div', { class: 'sect-head' }, h('h4', {}, LABEL[d] + ' (' + g.length + ')'), acts),
        h('div', { class: 'grid' }, sortList(g).map(card))));
    });
    return wrap;
  }

  function render() {
    setPill();
    $('#summary').textContent = summary();
    var roomsEl = $('#rooms'), dev = $('#devices');
    roomsEl.replaceChildren();
    dev.replaceChildren();

    if (!S.mode) {
      dev.append(emptyBox('Noch nichts verbunden', 'Verbinde deinen HomeServer oder sieh dir zuerst die Demo an.',
        h('div', { class: 'btn-row', style: 'justify-content:center' },
          h('button', { class: 'btn primary', onclick: openSheet }, 'Verbinden'),
          h('button', { class: 'btn', onclick: startDemo }, 'Demo ansehen'))));
      return;
    }

    var all = [...S.ent.values()].filter(shown);
    if (!all.length) {
      dev.append(emptyBox(S.conn === 'connecting' ? 'Lade Geräte…' : 'Keine Geräte gefunden',
        'Sobald der HomeServer Geräte meldet, erscheinen sie hier.', null));
      return;
    }

    var byRoom = new Map();
    all.forEach(function (e) {
      var r = roomOf(e);
      if (!byRoom.has(r)) byRoom.set(r, []);
      byRoom.get(r).push(e);
    });
    var names = [...byRoom.keys()].sort(function (a, b) {
      if (a === ALLG) return -1;
      if (b === ALLG) return 1;
      return a.localeCompare(b, 'de');
    });
    if (!S.room) S.room = LS.get('z_room');
    if (S.room !== ALL && names.indexOf(S.room) < 0) S.room = names[0];

    var q = S.q.trim().toLowerCase();
    names.forEach(function (n) {
      var items = byRoom.get(n);
      var lit = items.some(function (e) { return dom(e.id) === 'light' && e.state === 'on'; });
      roomsEl.append(h('button', {
        class: 'room', 'data-lit': lit ? 1 : null, 'aria-current': (!q && n === S.room) ? 'true' : null,
        onclick: function () {
          S.room = n; S.q = ''; $('#search').value = '';
          LS.set('z_room', n); render(); dev.scrollTop = 0;
        }
      }, h('span', { class: 'rn' }, n), h('span', { class: 'rc' }, items.length + (items.length === 1 ? ' Gerät' : ' Geräte'))));
    });

    var q2 = q;
    $('#btn-all').setAttribute('aria-pressed', (!q2 && S.room === ALL) ? 'true' : 'false');
    if (!q2 && S.room === ALL) {
      dev.append(h('div', { class: 'dev-head' }, h('h3', {}, 'Alle Geräte'), h('span', { class: 'rc' }, all.length + ' Geräte')));
      dev.append(groupedAll(all));
      return;
    }

    var items, title;
    if (q) {
      title = 'Suchergebnisse';
      items = all.filter(function (e) { return (nameOf(e) + ' ' + roomOf(e)).toLowerCase().indexOf(q) >= 0; });
    } else {
      title = S.room;
      items = byRoom.get(S.room).slice();
    }
    if (!items.length) {
      dev.append(emptyBox('Keine Treffer', 'Zu deiner Suche gibt es kein Gerät.', null));
      return;
    }
    var on = items.filter(function (e) { return dom(e.id) === 'light' && e.state === 'on'; });
    dev.append(h('div', { class: 'dev-head' }, h('h3', {}, title),
      on.length ? h('button', { class: 'chip', onclick: function () { lightsOff(on); } }, 'Lichter aus') : null));
    dev.append(h('div', { class: 'grid' }, sortList(items).map(card)));
  }

  /* ---------- Demo ---------- */
  function startDemo() {
    stopAll();
    S.mode = 'demo'; S.conn = 'off';
    LS.set('z_mode', 'demo');
    S.ent.clear(); S.area.clear(); S.hidden.clear();
    var add = function (id, state, attr, area) {
      S.ent.set(id, { id: id, state: state, attr: attr });
      if (area) S.area.set(id, area);
    };
    add('light.decke', 'on', { friendly_name: 'Deckenlicht', brightness: 178 }, 'Wohnzimmer');
    add('light.stehlampe', 'off', { friendly_name: 'Stehlampe', brightness: 120 }, 'Wohnzimmer');
    add('cover.terrasse', 'open', { friendly_name: 'Rollladen Terrasse', current_position: 100 }, 'Wohnzimmer');
    add('climate.wz', 'heat', { friendly_name: 'Heizung', current_temperature: 21.5, temperature: 22, min_temp: 5, max_temp: 30, target_temp_step: 0.5 }, 'Wohnzimmer');
    add('media_player.tv', 'paused', { friendly_name: 'Fernseher', media_title: 'Tagesschau' }, 'Wohnzimmer');
    add('light.kueche', 'on', { friendly_name: 'Küchenlicht', brightness: 255 }, 'Küche');
    add('switch.kaffee', 'off', { friendly_name: 'Kaffeemaschine' }, 'Küche');
    add('sensor.kueche_feuchte', '48', { friendly_name: 'Luftfeuchtigkeit', device_class: 'humidity', unit_of_measurement: '%' }, 'Küche');
    add('light.bett', 'off', { friendly_name: 'Nachttischlampe', brightness: 90 }, 'Schlafzimmer');
    add('cover.sz', 'closed', { friendly_name: 'Rollladen Fenster', current_position: 0 }, 'Schlafzimmer');
    add('climate.sz', 'heat', { friendly_name: 'Heizung', current_temperature: 18.2, temperature: 18, min_temp: 5, max_temp: 30, target_temp_step: 0.5 }, 'Schlafzimmer');
    add('lock.haustuer', 'locked', { friendly_name: 'Haustür' }, 'Flur');
    add('binary_sensor.haustuer', 'off', { friendly_name: 'Haustür Kontakt', device_class: 'door' }, 'Flur');
    add('light.flur', 'on', { friendly_name: 'Flurlicht', brightness: 102 }, 'Flur');
    add('vacuum.robo', 'docked', { friendly_name: 'Saugroboter' }, 'Keller');
    add('switch.waschmaschine', 'on', { friendly_name: 'Waschmaschine' }, 'Keller');
    add('sensor.waschmaschine_leistung', '120', { friendly_name: 'Waschmaschine Leistung', device_class: 'power', unit_of_measurement: 'W' }, 'Keller');
    add('scene.abend', 'scening', { friendly_name: 'Abendstimmung' });
    add('scene.gehen', 'scening', { friendly_name: 'Ich gehe aus dem Haus' });
    closeSheet();
    render();
  }

  function demoCall(domain, service, data, id) {
    var e = S.ent.get(id);
    if (!e) return;
    var set = function (st, patch) { e.state = st; Object.assign(e.attr, patch || {}); schedule(); };
    switch (domain + '.' + service) {
      case 'light.turn_on': set('on', { brightness: data.brightness_pct != null ? Math.round(data.brightness_pct * 2.55) : (e.attr.brightness || 180) }); break;
      case 'light.turn_off': case 'switch.turn_off': set('off'); break;
      case 'switch.turn_on': set('on'); break;
      case 'cover.open_cover': set('open', { current_position: 100 }); break;
      case 'cover.close_cover': set('closed', { current_position: 0 }); break;
      case 'cover.set_cover_position': set(data.position > 0 ? 'open' : 'closed', { current_position: data.position }); break;
      case 'climate.set_temperature': set(e.state, { temperature: data.temperature }); break;
      case 'lock.lock': set('locked'); break;
      case 'lock.unlock': set('unlocked'); break;
      case 'media_player.media_play_pause': set(e.state === 'playing' ? 'paused' : 'playing'); break;
      case 'vacuum.start': set('cleaning'); break;
      case 'vacuum.return_to_base': set('docked'); break;
      default: break;
    }
  }

  /* ---------- Gira HomeServer ---------- */
  var CLIENT_ID = 'de.zuhause.app';
  var G = { base: '', token: '', funcs: new Map(), timer: 0, busy: false, want: false, fail: 0 };

  function formError(msg) {
    var el = $('#form-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }
  function normBase(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }
  function gjson(r) {
    if (r.status === 401 || r.status === 403) { var e = new Error('auth'); e.code = 'auth'; throw e; }
    if (!r.ok) { var e2 = new Error('http'); e2.code = 'http'; e2.status = r.status; throw e2; }
    return r.text().then(function (t) { try { return t ? JSON.parse(t) : {}; } catch (x) { return {}; } });
  }
  function gurl(path) {
    return G.base + '/api/v2' + path + (path.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(G.token);
  }
  function gget(path) { return fetch(gurl(path)).then(gjson); }
  function gput(path, body) {
    return fetch(gurl(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(gjson);
  }

  function giraLogin(base, user, pass) {
    var auth = 'Basic ' + btoa(unescape(encodeURIComponent(user + ':' + pass)));
    return fetch(base + '/api/v2/').then(gjson).then(function () {
      return fetch(base + '/api/v2/clients', {
        method: 'POST',
        headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: CLIENT_ID })
      });
    }).then(gjson).then(function (r) {
      if (!r || !r.token) { var e = new Error('http'); e.code = 'http'; e.status = 0; throw e; }
      return r.token;
    });
  }

  /* Gira-Funktion -> Gerätetyp der App */
  function sensorKind(n) {
    if (/temp/i.test(n)) return { cls: 'temperature', unit: '°C' };
    if (/feucht/i.test(n)) return { cls: 'humidity', unit: '%' };
    if (/helligk|lux/i.test(n)) return { cls: 'illuminance', unit: 'lx' };
    if (/leistung|watt/i.test(n)) return { cls: 'power', unit: 'W' };
    return null;
  }
  function binKind(n) {
    if (/fenster|window/i.test(n)) return 'window';
    if (/t[üu]r|door/i.test(n)) return 'door';
    if (/bewegung|motion/i.test(n)) return 'motion';
    return null;
  }
  function giraMap(f) {
    var T = String(f.functionType || '').replace('de.gira.schema.functions.', '');
    var n = f.displayName || '';
    switch (T) {
      case 'Switch': return { d: /steckdose|stecker|dose|maschine/i.test(n) ? 'switch' : 'light', attr: {} };
      case 'KNX.Light': case 'ColoredLight': case 'TunableLight': return { d: 'light', attr: {} };
      case 'Covering': return { d: 'cover', attr: {} };
      case 'Trigger': case 'Scene': return { d: 'scene', attr: {} };
      case 'KNX.HeatingCooling': case 'SaunaHeating': case 'KNX.FanCoil':
        return { d: 'climate', attr: { min_temp: 5, max_temp: 30, target_temp_step: 0.5 } };
      case 'Audio': case 'Sonos.Audio': return { d: 'media_player', attr: {} };
      case 'TemperatureValue': return { d: 'sensor', attr: { device_class: 'temperature', unit_of_measurement: '°C' } };
      case 'PercentValue': { var k = /feucht/i.test(n) ? sensorKind(n) : null; return k ? { d: 'sensor', attr: { device_class: k.cls, unit_of_measurement: k.unit } } : null; }
      case 'NumericFloatStatus': case 'DecimalValue': { var s = sensorKind(n); return s ? { d: 'sensor', attr: { device_class: s.cls, unit_of_measurement: s.unit } } : null; }
      case 'BinaryStatus': { var b = binKind(n); return b ? { d: 'binary_sensor', attr: { device_class: b } } : null; }
    }
    return null;
  }

  function loadConfig() {
    return gget('/uiconfig?expand=dataPointFlags,parameters,locations').then(function (cfg) {
      var areaOf = {};
      (function walk(list) {
        (list || []).forEach(function (l) {
          (l.functions || []).forEach(function (f) { areaOf[f.uid] = l.displayName; });
          walk(l.locations);
        });
      })(cfg.locations);
      S.ent.clear(); S.area.clear(); S.hidden.clear(); G.funcs.clear();
      (cfg.functions || []).forEach(function (f) {
        var m = giraMap(f);
        if (!m) return;
        var dp = {};
        (f.dataPoints || []).forEach(function (x) { dp[x.name] = x.uid; });
        var id = m.d + '.' + f.uid;
        G.funcs.set(id, { uid: f.uid, dp: dp, params: f.parameters || [] });
        var attr = Object.assign({ friendly_name: f.displayName || f.uid }, m.attr);
        S.ent.set(id, { id: id, state: m.d === 'scene' ? 'scening' : 'unknown', attr: attr });
        if (areaOf[f.uid]) S.area.set(id, areaOf[f.uid]);
      });
    });
  }

  function truthy(v) { return v === 1 || v === '1' || v === true || v === 'true'; }
  function num(v) { var x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? null : x; }

  function applyValues(id, values) {
    var F = G.funcs.get(id), e = S.ent.get(id);
    if (!F || !e) return;
    var name = {}, v = {};
    Object.keys(F.dp).forEach(function (k) { name[F.dp[k]] = k; });
    values.forEach(function (x) { if (name[x.uid]) v[name[x.uid]] = x.value; });
    var d = dom(id), a = e.attr, t;
    if (d === 'light' || d === 'switch') {
      e.state = truthy(v.OnOff) ? 'on' : 'off';
      t = num(v.Brightness);
      if (F.dp.Brightness && t != null) a.brightness = Math.round(t * 2.55); else delete a.brightness;
    } else if (d === 'cover') {
      t = num(v.Position);
      if (F.dp.Position && t != null) {
        t = Math.max(0, Math.min(100, t));
        a.current_position = Math.round(100 - t);
        e.state = t >= 100 ? 'closed' : 'open';
      } else { e.state = 'unknown'; }
    } else if (d === 'climate') {
      a.current_temperature = num(v.Current);
      t = num(v['Set-Point']); if (t != null) a.temperature = t;
      e.state = (F.dp.OnOff && !truthy(v.OnOff)) ? 'off' : 'heat';
    } else if (d === 'media_player') {
      e.state = truthy(v.Play) ? 'playing' : 'paused';
      if (v.Title) a.media_title = v.Title; else delete a.media_title;
    } else if (d === 'sensor') {
      t = num(v[Object.keys(F.dp)[0]]);
      e.state = t == null ? 'unknown' : String(t);
    } else if (d === 'binary_sensor') {
      e.state = truthy(v.Binary) ? 'on' : 'off';
    }
  }

  function pollOne(id) {
    var F = G.funcs.get(id);
    if (!F) return Promise.resolve();
    return gget('/values/' + encodeURIComponent(F.uid)).then(function (r) {
      applyValues(id, r.values || []);
    }).catch(function (err) {
      if (err && err.code === 'auth') throw err;
      G.fail++;
      var e = S.ent.get(id);
      if (e) e.state = 'unavailable';
    });
  }
  function pollIds(ids) {
    var p = Promise.resolve();
    for (var i = 0; i < ids.length; i += 6) {
      (function (chunk) { p = p.then(function () { return Promise.all(chunk.map(pollOne)); }); })(ids.slice(i, i + 6));
    }
    return p;
  }

  /* Nur was gerade sichtbar ist, wird regelmäßig abgefragt */
  function visibleEntities() {
    var all = [...S.ent.values()].filter(shown);
    var q = S.q.trim().toLowerCase();
    if (q) return all.filter(function (e) { return (nameOf(e) + ' ' + roomOf(e)).toLowerCase().indexOf(q) >= 0; });
    if (S.room === ALL) return all;
    return all.filter(function (e) { return roomOf(e) === S.room; });
  }

  function tick() {
    clearTimeout(G.timer);
    if (!G.want || S.mode !== 'gira') return;
    if (document.visibilityState === 'hidden' || G.busy || S.drag) { G.timer = setTimeout(tick, 3000); return; }
    G.busy = true; G.fail = 0;
    var ids = visibleEntities().map(function (e) { return e.id; });
    pollIds(ids).then(function () {
      S.conn = (ids.length && G.fail === ids.length) ? 'bad' : 'ok';
      schedule();
    }).catch(function (err) {
      if (err && err.code === 'auth') onGiraError(err, 'session');
    }).then(function () {
      G.busy = false;
      if (G.want) G.timer = setTimeout(tick, 3000);
    });
  }

  function stopGira() {
    G.want = false;
    clearTimeout(G.timer);
  }

  /* Ein Browser meldet bei jedem Netzwerkfehler dasselbe. Diese Probe unterscheidet die häufigsten Ursachen. */
  function networkHelp(base) {
    base = base || '';
    if (location.protocol === 'https:' && /^http:\/\//i.test(base)) {
      return Promise.resolve('Die Adresse beginnt mit http, diese Seite läuft aber über https. Der Browser blockiert das. Nutze eine Adresse mit https://.');
    }
    var url = base + '/api/v2/';
    // Probe 1: kommt überhaupt eine Antwort an (Netz und Zertifikat in Ordnung)?
    return fetch(url, { mode: 'no-cors' }).then(function () {
      // Probe 2: darf diese Webseite die Antwort auch lesen (CORS)?
      return fetch(url).then(function () {
        return 'Der HomeServer antwortet auf einfache Abfragen, lehnt aber die Anmeldung dieser Webseite ab. Der Browser fragt vor der Anmeldung nach einer Erlaubnis (CORS-Vorabprüfung), und der HomeServer beantwortet sie nicht.';
      }, function () {
        return 'Der HomeServer ist erreichbar und das Zertifikat ist freigegeben, er erlaubt aber keine Zugriffe von dieser Webseite (CORS). Das lässt sich in der App nicht beheben.';
      });
    }, function () {
      return 'Der HomeServer ist nicht erreichbar oder sein Zertifikat wird nicht akzeptiert. Prüfe: 1) Die Adresse stimmt und du bist im selben WLAN. 2) Öffne die Adresse einmal in Safari und bestätige die Zertifikatswarnung.';
    });
  }

  function onGiraError(err, ctx) {
    stopGira();
    S.conn = 'bad';
    var msg;
    if (err && err.code === 'auth') {
      LS.del('z_gtoken');
      msg = ctx === 'session'
        ? 'Die Anmeldung ist abgelaufen. Melde dich bitte neu an.'
        : 'Benutzername oder Passwort stimmen nicht.';
    } else if (err && err.code === 'http') {
      msg = 'Der HomeServer hat mit Fehler ' + (err.status || '') + ' geantwortet. Prüfe, ob die IoT-REST-API (Version 2) am HomeServer aktiv ist und der Benutzer Zugriff hat.';
    } else {
      msg = 'Verbindung wird geprüft…';
      networkHelp(G.base).then(function (t) {
        formError(t + ' (Technische Meldung: ' + ((err && err.name) ? err.name + ': ' : '') + ((err && err.message) || 'keine') + ')');
      });
    }
    formError(msg);
    openSheet();
    render();
  }

  function connectGira(base, token) {
    G.base = base; G.token = token; G.want = true;
    S.mode = 'gira'; S.conn = 'connecting';
    render();
    return loadConfig().then(function () {
      S.conn = 'ok';
      formError('');
      closeSheet();
      render();
      return pollIds([...S.ent.keys()]);
    }).then(function () {
      schedule();
      tick();
    }).catch(function (err) { onGiraError(err, LS.get('z_gtoken') ? 'session' : 'login'); });
  }

  function sceneNumber(F) {
    for (var i = 0; i < F.params.length; i++) {
      var p = F.params[i];
      if (/scene|number|nr/i.test(p.key || '') && num(p.value) != null) return num(p.value);
    }
    return 1;
  }
  function giraCommand(F, domain, service, data, e) {
    var dp = F.dp, out = [];
    var put = function (n, value) { if (dp[n]) out.push({ uid: dp[n], value: value }); };
    switch (domain + '.' + service) {
      case 'light.turn_on': case 'switch.turn_on':
        put('OnOff', 1);
        if (data.brightness_pct != null) put('Brightness', data.brightness_pct);
        break;
      case 'light.turn_off': case 'switch.turn_off': put('OnOff', 0); break;
      case 'cover.open_cover': put('Up-Down', 0); break;
      case 'cover.close_cover': put('Up-Down', 1); break;
      case 'cover.stop_cover': put('Step-Up-Down', 0); break;
      case 'cover.set_cover_position': put('Position', 100 - data.position); break;
      case 'climate.set_temperature': put('Set-Point', data.temperature); break;
      case 'media_player.media_play_pause': put('Play', e && e.state === 'playing' ? 0 : 1); break;
      case 'scene.turn_on':
        if (dp.Trigger) put('Trigger', 1);
        else if (dp.Execute) put('Execute', sceneNumber(F));
        else if (dp.Scene) put('Scene', sceneNumber(F));
        break;
    }
    return out;
  }

  /* ---------- Home Assistant ---------- */
  var H = { ws: null, mid: 1, pending: new Map(), retry: 0, timer: 0, want: false, url: '', token: '' };

  function hsend(obj, cb) {
    if (!H.ws || H.ws.readyState !== 1) return;
    if (obj.type !== 'auth') {
      obj.id = H.mid++;
      if (cb) H.pending.set(obj.id, cb);
    }
    H.ws.send(JSON.stringify(obj));
  }
  function closeHA() {
    H.want = false;
    clearTimeout(H.timer);
    if (H.ws) { H.ws.onclose = null; H.ws.onerror = null; try { H.ws.close(); } catch (e) {} }
    H.ws = null; H.pending.clear();
  }
  function stopAll() { stopGira(); closeHA(); }

  function connectHA(url, token) {
    closeHA();
    H.url = url; H.token = token; H.want = true;
    S.mode = 'ha'; S.conn = 'connecting';
    var wsUrl;
    try {
      var u = new URL(url);
      wsUrl = (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host + u.pathname.replace(/\/+$/, '') + '/api/websocket';
    } catch (e) {
      H.want = false; S.conn = 'bad'; formError('Die Adresse ist ungültig. Beispiel: https://meinhaus.ui.nabu.casa'); openSheet(); render(); return;
    }
    if (location.protocol === 'https:' && wsUrl.indexOf('ws:') === 0) {
      H.want = false; S.conn = 'bad';
      formError('Diese App läuft über https. Eine Adresse mit http blockiert iOS. Nutze eine https-Adresse, zum Beispiel über Home Assistant Cloud.');
      openSheet(); render(); return;
    }
    render();
    var sock = new WebSocket(wsUrl);
    H.ws = sock;
    sock.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'auth_required') hsend({ type: 'auth', access_token: token });
      else if (m.type === 'auth_ok') onHAAuth();
      else if (m.type === 'auth_invalid') {
        H.want = false; S.conn = 'bad';
        formError('Das Token wurde abgelehnt. Erstelle in Home Assistant ein neues langlebiges Zugriffstoken.');
        openSheet(); render();
      } else if (m.type === 'result') {
        var cb = H.pending.get(m.id);
        if (cb) { H.pending.delete(m.id); cb(m); }
      } else if (m.type === 'event' && m.event && m.event.event_type === 'state_changed') {
        var d = m.event.data;
        if (!d.new_state) S.ent.delete(d.entity_id);
        else S.ent.set(d.entity_id, { id: d.entity_id, state: d.new_state.state, attr: d.new_state.attributes || {} });
        schedule();
      }
    };
    sock.onclose = function () {
      if (H.ws !== sock) return;
      S.conn = 'bad';
      render();
      if (H.want) {
        var wait = Math.min(15000, 1000 * Math.pow(2, H.retry++));
        H.timer = setTimeout(function () { if (H.want) connectHA(H.url, H.token); }, wait);
        if (H.retry === 1 && $('#sheet').hidden === false) formError('Keine Verbindung. Prüfe Adresse, https und ob Home Assistant erreichbar ist.');
      }
    };
    sock.onerror = function () {};
  }

  function onHAAuth() {
    S.conn = 'ok'; H.retry = 0; formError('');
    closeSheet();
    var reg = {};
    var build = function () {
      if (!(reg.a && reg.d && reg.e)) return;
      var areaName = {}, devArea = {};
      reg.a.forEach(function (x) { areaName[x.area_id] = x.name; });
      reg.d.forEach(function (x) { if (x.area_id) devArea[x.id] = x.area_id; });
      S.area.clear(); S.hidden.clear();
      reg.e.forEach(function (x) {
        if (x.hidden_by || x.disabled_by) { S.hidden.add(x.entity_id); return; }
        var aid = x.area_id || devArea[x.device_id];
        if (aid && areaName[aid]) S.area.set(x.entity_id, areaName[aid]);
      });
      schedule();
    };
    hsend({ type: 'get_states' }, function (m) {
      S.ent.clear();
      (m.result || []).forEach(function (s) { S.ent.set(s.entity_id, { id: s.entity_id, state: s.state, attr: s.attributes || {} }); });
      render();
    });
    hsend({ type: 'config/area_registry/list' }, function (m) { reg.a = m.success ? m.result : []; build(); });
    hsend({ type: 'config/device_registry/list' }, function (m) { reg.d = m.success ? m.result : []; build(); });
    hsend({ type: 'config/entity_registry/list' }, function (m) { reg.e = m.success ? m.result : []; build(); });
    hsend({ type: 'subscribe_events', event_type: 'state_changed' });
  }

  /* ---------- Einstellungen ---------- */
  var B = LS.get('z_backend') === 'ha' ? 'ha' : 'gira';
  function haUrl() { return LS.get('z_haurl') || LS.get('z_url') || ''; }
  function haToken() { return LS.get('z_hatoken') || LS.get('z_token') || ''; }

  function setBackend(b, keepError) {
    B = b;
    LS.set('z_backend', b);
    $('#bk-gira').setAttribute('aria-selected', b === 'gira' ? 'true' : 'false');
    $('#bk-ha').setAttribute('aria-selected', b === 'ha' ? 'true' : 'false');
    $('#form-gira').hidden = b !== 'gira';
    $('#form-ha').hidden = b !== 'ha';
    $('#help-gira').hidden = b !== 'gira';
    $('#help-ha').hidden = b !== 'ha';
    if (!keepError) formError('');
    $('#set-note').hidden = true;
  }

  function openSheet() {
    if (!$('#in-url').value) $('#in-url').value = LS.get('z_gurl') || '';
    if (!$('#ha-url').value) $('#ha-url').value = haUrl();
    if (!$('#ha-token').value) $('#ha-token').value = haToken();
    $('#btn-forget').hidden = !(LS.get('z_gurl') || LS.get('z_gtoken') || haUrl() || haToken());
    setBackend(S.mode === 'ha' || S.mode === 'gira' ? S.mode : B, true);
    $('#set-note').hidden = true;
    $('#sheet').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    document.body.style.overflow = '';
  }
  function setNote(text) {
    var n = $('#set-note');
    n.textContent = text;
    n.hidden = false;
  }

  $('#btn-settings').addEventListener('click', openSheet);
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', function (ev) { if (ev.target === $('#sheet')) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });
  $('#btn-demo').addEventListener('click', startDemo);
  $('#bk-gira').addEventListener('click', function () { setBackend('gira'); });
  $('#bk-ha').addEventListener('click', function () { setBackend('ha'); });

  $('#btn-connect').addEventListener('click', function () {
    if (B === 'ha') {
      var url = $('#ha-url').value.trim(), tok = $('#ha-token').value.trim();
      if (!url || !tok) { formError('Trage Adresse und Token ein.'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      formError('');
      stopAll();
      S.ent.clear(); S.area.clear();
      LS.set('z_haurl', url); LS.set('z_hatoken', tok); LS.set('z_mode', 'ha');
      connectHA(url, tok);
      return;
    }
    var raw = $('#in-url').value.trim(), user = $('#in-user').value.trim(), pass = $('#in-pass').value;
    if (!raw || !user || !pass) { formError('Trage Adresse, Benutzername und Passwort ein.'); return; }
    var base = normBase(raw), btn = $('#btn-connect');
    G.base = base;
    formError('');
    stopAll();
    S.ent.clear(); S.area.clear();
    LS.del('z_gtoken');
    btn.disabled = true; btn.textContent = 'Verbinde…';
    giraLogin(base, user, pass).then(function (token) {
      LS.set('z_gurl', base); LS.set('z_gtoken', token); LS.set('z_mode', 'gira');
      $('#in-pass').value = '';
      return connectGira(base, token);
    }).catch(function (err) {
      onGiraError(err, 'login');
      S.mode = null; S.conn = 'off'; render();
    }).then(function () { btn.disabled = false; btn.textContent = 'Verbinden'; });
  });

  $('#btn-forget').addEventListener('click', function () {
    var t = LS.get('z_gtoken'), b = LS.get('z_gurl');
    if (t && b) fetch(b + '/api/v2/clients/' + encodeURIComponent(t), { method: 'DELETE' }).catch(function () {});
    stopAll();
    ['z_gurl', 'z_gtoken', 'z_haurl', 'z_hatoken', 'z_url', 'z_token', 'z_mode'].forEach(function (k) { LS.del(k); });
    S.mode = null; S.conn = 'off'; S.ent.clear(); S.area.clear();
    ['in-url', 'in-user', 'in-pass', 'ha-url', 'ha-token'].forEach(function (id) { $('#' + id).value = ''; });
    $('#btn-forget').hidden = true;
    render();
    toast('Zugangsdaten gelöscht.');
  });

  function activeSystem() { return S.mode === 'ha' || S.mode === 'gira' ? S.mode : B; }
  function haPage(path) {
    if (S.mode === 'ha' && H.url) {
      $('#set-note').hidden = true;
      window.open(H.url.replace(/\/+$/, '') + path, '_blank', 'noopener');
    } else {
      setNote(S.mode === 'demo' ? 'In der Demo geht das nicht. Verbinde unten zuerst dein System.' : 'Verbinde unten zuerst Home Assistant.');
    }
  }

  $('#set-devices').addEventListener('click', function () {
    if (S.mode === 'ha') { connectHA(H.url, H.token); toast('Geräte neu geladen.'); return; }
    if (S.mode !== 'gira') { setNote(S.mode === 'demo' ? 'In der Demo geht das nicht. Verbinde unten zuerst dein System.' : 'Verbinde unten zuerst dein System.'); return; }
    $('#set-note').hidden = true;
    loadConfig().then(function () { render(); return pollIds([...S.ent.keys()]); }).then(function () { schedule(); toast('Geräte neu geladen.'); })
      .catch(function (err) { onGiraError(err, 'session'); });
  });
  $('#set-add').addEventListener('click', function () {
    if (activeSystem() === 'ha') { haPage('/config/integrations/dashboard'); return; }
    setNote('Neue Geräte richtest du im Gira Project Assistant am Computer ein und überträgst sie auf den HomeServer. Danach tippst du hier auf „Geräte neu laden“.');
  });
  $('#set-areas').addEventListener('click', function () {
    if (activeSystem() === 'ha') { haPage('/config/areas/dashboard'); return; }
    setNote('Räume und ihre Geräte kommen aus dem Gira Project Assistant. Ändere sie dort und tippe danach auf „Geräte neu laden“.');
  });

  /* ---------- Bedienelemente ---------- */
  $('#search').addEventListener('input', function (ev) { S.q = ev.target.value; render(); });
  $('#btn-all').addEventListener('click', function () {
    if (!S.mode) { openSheet(); return; }
    if (S.room === ALL) { S.room = S.prev && S.prev !== ALL ? S.prev : null; }
    else { S.prev = S.room; S.room = ALL; }
    S.q = ''; $('#search').value = '';
    LS.set('z_room', S.room || '');
    render();
    $('#devices').scrollTop = 0;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (G.want && S.mode === 'gira') tick();
    if (H.want && S.mode === 'ha' && (!H.ws || H.ws.readyState > 1)) { H.retry = 0; connectHA(H.url, H.token); }
  });

  /* ---------- Start ---------- */
  setBackend(B, true);
  render();
  var mode = LS.get('z_mode');
  if (mode === 'demo') startDemo();
  else if (mode === 'gira' && LS.get('z_gurl') && LS.get('z_gtoken')) connectGira(LS.get('z_gurl'), LS.get('z_gtoken'));
  else if (mode === 'ha' && haUrl() && haToken()) connectHA(haUrl(), haToken());

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
