// Mapas de las tarjetas «03 · Provincias» (Peru por provincias) y «04 · Distritos de Lima».
// dashboard.js llama a window.__MAPA_APD(tipo, filas, año) al dibujar cada tarjeta; las filas son las de
// XL_grp (label, n, a, f, c, r, ev, es, er). Al hacer clic en una provincia o distrito se muestran sus cifras.
// Los trazos estan en geo.js (window.__GEO_APD).
(function () {
    var ultimo = {};      // filas y año del ultimo dibujo, por tipo
    var elegido = {};     // nombre seleccionado, por tipo
    var enganchado = false;

    var TXT = {
        peru: { what: "provincia", titulo: "Mapa del Perú por provincias", vacio: "Haga clic en una provincia para ver sus cifras." },
        lima: { what: "distrito", titulo: "Mapa de la provincia de Lima por distritos", vacio: "Haga clic en un distrito para ver sus cifras." }
    };
    // Nombres que el Excel puede escribir distinto que el INEI.
    var ALIAS = {
        "NASCA": "NAZCA", "RAMON CASTILLA": "MARISCAL RAMON CASTILLA",
        "MAGDALENA VIEJA": "PUEBLO LIBRE", "CERCADO DE LIMA": "LIMA", "LIMA CERCADO": "LIMA", "CERCADO": "LIMA",
        "SURCO": "SANTIAGO DE SURCO", "SAN MARTIN DE PORRAS": "SAN MARTIN DE PORRES",
        "MAGDALENA": "MAGDALENA DEL MAR", "SAN JUAN LURIGANCHO": "SAN JUAN DE LURIGANCHO", "SAN JUAN MIRAFLORES": "SAN JUAN DE MIRAFLORES"
    };

    function clave(t) {
        var s = String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
            .replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        return ALIAS[s] || s;
    }
    function esc(t) {
        return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    }
    function num(n) { return Number(n || 0).toLocaleString("es-PE"); }
    function pct(a, n) { return n ? (a / n * 100).toFixed(1) + " %" : "—"; }

    // Color por cobertura (salas atendidas / salas autorizadas).
    var TRAMOS = [[0.2, .25], [0.4, .42], [0.6, .6], [0.8, .78], [1.01, .96]];
    function relleno(q) {
        if (!q || !q.n) return 'style="fill:var(--bg)"';
        if (!q.a) return 'style="fill:var(--c);fill-opacity:.32"';
        var p = q.a / q.n, op = TRAMOS[TRAMOS.length - 1][1];
        for (var i = 0; i < TRAMOS.length; i++) if (p < TRAMOS[i][0]) { op = TRAMOS[i][1]; break; }
        return 'style="fill:var(--f);fill-opacity:' + op + '"';
    }

    function indice(filas) {
        var ix = {};
        (filas || []).forEach(function (q) {
            var k = clave(q.label);
            if (!k || k === "SIN DATO") return;
            var o = ix[k];
            if (!o) { ix[k] = Object.assign({}, q); return; }
            ["n", "a", "f", "c", "r", "ev", "es", "er"].forEach(function (c) { o[c] = (o[c] || 0) + (q[c] || 0); });
        });
        return ix;
    }

    function ficha(tipo, g, q, anio) {
        var t = TXT[tipo];
        if (!g) return '<div class="mp-vacio">' + t.vacio + "</div>";
        var nombre = '<div class="mp-nom">' + esc(g.n) + (tipo === "peru" ? ' <span>' + esc(g.dep) + "</span>" : "") + "</div>";
        if (!q || !q.n) return nombre + '<p class="mp-nada">Sin salas autorizadas registradas en el Excel para esta ' + t.what + ".</p>";
        var sin = q.n - q.a;
        var html = nombre +
            '<div class="mp-big"><b>' + num(q.n) + "</b><span>salas autorizadas</span></div>" +
            '<div class="mp-sec">Estado de la autorización</div>' +
            '<div class="mp-row"><span>Vigentes</span><b>' + num(q.ev) + "</b></div>" +
            '<div class="mp-row"><span>Suspendidas</span><b>' + num(q.es) + "</b></div>" +
            '<div class="mp-row"><span>Revocadas</span><b>' + num(q.er) + "</b></div>" +
            '<div class="mp-sec">Atención en ' + esc(anio) + " · " + num(q.a) + " de " + num(q.n) + " (" + pct(q.a, q.n) + ")</div>" +
            '<div class="mp-bar">' +
            (q.f ? '<i style="width:' + q.f / q.n * 100 + '%;background:var(--f)"></i>' : "") +
            (q.c ? '<i style="width:' + q.c / q.n * 100 + '%;background:var(--c)"></i>' : "") +
            (q.r ? '<i style="width:' + q.r / q.n * 100 + '%;background:var(--a)"></i>' : "") + "</div>" +
            '<div class="mp-row"><span><i class="sw f"></i>Fiscalizadas</span><b>' + num(q.f) + "</b></div>" +
            '<div class="mp-row"><span><i class="sw c"></i>Cerradas</span><b>' + num(q.c) + "</b></div>" +
            '<div class="mp-row"><span><i class="sw a"></i>Revocadas</span><b>' + num(q.r) + "</b></div>" +
            '<div class="mp-row"><span><i class="sw" style="background:var(--ln)"></i>Sin atender</span><b>' + num(sin) + "</b></div>";
        if (tipo === "peru" && clave(g.n) === "LIMA") html += '<p class="mp-nota">Detalle por distrito en el mapa de la tarjeta «04 · Distritos de Lima».</p>';
        return html;
    }

    function dibujar(tipo) {
        var G = window.__GEO_APD && window.__GEO_APD[tipo];
        var u = ultimo[tipo];
        if (!G || !u) return "";
        var ix = indice(u.filas), sel = elegido[tipo], selG = null, enMapa = {};
        var paths = G.items.map(function (g) {
            var k = clave(g.n), q = ix[k], on = sel === k;
            enMapa[k] = 1;
            if (on) selG = g;
            var tip = g.n + (q && q.n ? ": " + num(q.a) + " de " + num(q.n) + " salas atendidas (" + pct(q.a, q.n) + ")" : ": sin salas");
            return '<path d="' + g.d + '" data-mp="' + esc(k) + '" ' + relleno(q) + ' class="' + (on ? "on" : "") +
                '" tabindex="0" role="button" aria-label="' + esc(tip) + '"><title>' + esc(tip) + "</title></path>";
        });
        // El seleccionado se dibuja al final para que su borde no quede tapado.
        if (selG) paths.push('<path d="' + selG.d + '" class="mp-borde" aria-hidden="true"></path>');
        var fuera = Object.keys(ix).filter(function (k) { return !enMapa[k]; });
        var leyenda = '<div class="mp-ley"><span><i style="background:var(--bg);border:1px solid var(--g)"></i>Sin salas</span>' +
            '<span><i style="background:var(--c);opacity:.32"></i>0 % atendidas</span>' +
            TRAMOS.map(function (t, i) {
                var de = i ? TRAMOS[i - 1][0] * 100 : 0, a = Math.min(t[0], 1) * 100;
                return '<span><i style="background:var(--f);opacity:' + t[1] + '"></i>' + (de ? de : "1") + "–" + a + " %</span>";
            }).join("") + "</div>";
        return '<div class="mp" data-mp-tipo="' + tipo + '"><h4>' + TXT[tipo].titulo + " · salas atendidas en " + esc(u.anio) + "</h4>" +
            leyenda + '<div class="mp-g"><div class="mp-svg"><svg viewBox="-4 -4 ' + (G.w + 8) + " " + (G.h + 8) +
            '" role="group" aria-label="' + TXT[tipo].titulo + '">' + paths.join("") + '</svg></div><div class="mp-info" aria-live="polite">' +
            ficha(tipo, selG, selG && ix[clave(selG.n)], u.anio) + "</div></div>" +
            (fuera.length ? '<p class="mp-nota">No se ubicaron en el mapa: ' + fuera.map(function (k) { return esc(ix[k].label) + " (" + num(ix[k].n) + ")"; }).join(", ") + ".</p>" : "") +
            "</div>";
    }

    var CSS = ".mp{margin-top:22px;padding-top:18px;border-top:1px solid var(--ln)}" +
        ".mp-ley{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--mu);margin:0 0 10px}" +
        ".mp-ley i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:5px;vertical-align:-2px}" +
        ".mp-g{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(240px,1fr);gap:24px;align-items:start}" +
        "@media (max-width:860px){.mp-g{grid-template-columns:minmax(0,1fr)}}" +
        ".mp-svg svg{display:block;width:100%;height:auto;max-height:620px}" +
        ".mp-svg path{stroke:var(--panel);stroke-width:.7;cursor:pointer;outline:none;transition:fill-opacity .12s}" +
        ".mp-svg path:hover,.mp-svg path:focus-visible{stroke:var(--ink);stroke-width:1.2}" +
        ".mp-svg path.mp-borde{fill:none!important;stroke:var(--ink);stroke-width:2.2;pointer-events:none}" +
        ".mp-info{border:1px solid var(--ln);border-radius:10px;background:var(--bg);padding:16px 18px;position:sticky;top:12px}" +
        ".mp-vacio{color:var(--mu);font-size:13.5px;padding:18px 0;text-align:center}" +
        ".mp-nom{font-size:18px;font-weight:700;line-height:1.25}.mp-nom span{display:block;font-size:12px;font-weight:600;color:var(--mu);letter-spacing:.06em}" +
        ".mp-big{display:flex;align-items:baseline;gap:8px;margin:10px 0 4px}.mp-big b{font-size:34px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.mp-big span{color:var(--mu);font-size:13px}" +
        ".mp-sec{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mu);font-weight:700;margin:14px 0 6px}" +
        ".mp-row{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:4px 0;border-bottom:1px dashed var(--ln)}" +
        ".mp-row b{font-variant-numeric:tabular-nums}.mp-row .sw{margin-right:6px}" +
        ".mp-bar{display:flex;height:12px;border-radius:3px;overflow:hidden;background:var(--ln);margin:0 0 6px}.mp-bar i{display:block;height:100%}" +
        ".mp-nada,.mp-nota{font-size:12.5px;color:var(--mu);margin:10px 0 0}";

    function enganchar() {
        if (enganchado) return;
        var host = document.getElementById("dash"), root = host && host.shadowRoot;
        if (!root) return;
        enganchado = true;
        var st = document.createElement("style");
        st.textContent = CSS;
        root.appendChild(st);
        var elegir = function (ev) {
            var p = ev.target.closest && ev.target.closest("path[data-mp]");
            if (!p) return;
            var box = p.closest(".mp"), tipo = box.getAttribute("data-mp-tipo");
            elegido[tipo] = p.getAttribute("data-mp");
            var tmp = document.createElement("div");
            tmp.innerHTML = dibujar(tipo);
            box.replaceWith(tmp.firstChild);
            var nuevo = root.querySelector('.mp[data-mp-tipo="' + tipo + '"] path[data-mp="' + elegido[tipo].replace(/"/g, '\\"') + '"]');
            if (nuevo && ev.type === "keydown") nuevo.focus();
        };
        root.addEventListener("click", elegir);
        root.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter" || ev.key === " ") { if (ev.target.matches && ev.target.matches("path[data-mp]")) { ev.preventDefault(); elegir(ev); } }
        });
    }

    window.__MAPA_APD = function (tipo, filas, anio) {
        if (!TXT[tipo] || !window.__GEO_APD) return "";
        ultimo[tipo] = { filas: filas || [], anio: anio };
        // Por defecto se muestra la mas fiscalizada (la primera por salas atendidas).
        if (!elegido[tipo]) {
            var top = (filas || []).filter(function (q) { return clave(q.label) !== "SIN DATO"; })
                .sort(function (x, y) { return y.a - x.a || y.n - x.n; })[0];
            if (top) elegido[tipo] = clave(top.label);
        }
        setTimeout(enganchar, 0);
        return dibujar(tipo);
    };
})();
