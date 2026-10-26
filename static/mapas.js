// Mapas de las tarjetas «03 · Provincias» (Peru por provincias) y «04 · Distritos de Lima».
// dashboard.js llama a window.__MAPA_APD(tipo, filas, año) al dibujar cada tarjeta; las filas son las de
// XL_grp (label, n, a, f, c, r, ev, es, er). Al hacer clic en una provincia o distrito se muestran sus cifras.
// Los trazos estan en geo.js (window.__GEO_APD): d = trazo SVG, c = punto para la etiqueta, b = caja.
(function () {
    var ultimo = {};      // filas y año del ultimo dibujo, por tipo
    var elegido = {};     // nombre seleccionado, por tipo
    var zoom = { lima: "urb" };
    var enganchado = false;

    var TXT = {
        peru: { una: "provincia", varias: "provincias", titulo: "Perú por provincias" },
        lima: { una: "distrito", varias: "distritos", titulo: "Provincia de Lima por distritos" }
    };
    // Distritos fuera del area urbana; la vista «Lima urbana» encuadra el resto.
    var PERIFERIA = ["ANCON", "SANTA ROSA", "CARABAYLLO", "LURIGANCHO", "CHACLACAYO", "CIENEGUILLA", "PACHACAMAC", "LURIN",
        "PUNTA HERMOSA", "PUNTA NEGRA", "SAN BARTOLO", "SANTA MARIA DEL MAR", "PUCUSANA", "PUENTE PIEDRA"];
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
    function titulo(t) { return String(t).toLowerCase().replace(/(^|\s)(\S)/g, function (z, p, q) { return p + q.toUpperCase(); }).replace(/ (De|Del|La|Las|Los|Y) /g, function (z) { return z.toLowerCase(); }); }

    // Color por cobertura (salas atendidas / salas autorizadas).
    var TRAMOS = [[0.2, .22], [0.4, .4], [0.6, .58], [0.8, .78], [1.01, 1]];
    function relleno(q) {
        if (!q || !q.n) return "fill:var(--ln)";
        if (!q.a) return "fill:var(--c);fill-opacity:.38";
        var p = q.a / q.n, op = 1;
        for (var i = 0; i < TRAMOS.length; i++) if (p < TRAMOS[i][0]) { op = TRAMOS[i][1]; break; }
        return "fill:var(--f);fill-opacity:" + op;
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

    function barra(q, partes) {
        return '<div class="mp-bar">' + partes.map(function (p) {
            return q[p[0]] ? '<i style="width:' + (q[p[0]] / q.n * 100) + "%;background:" + p[1] + '"></i>' : "";
        }).join("") + "</div>";
    }
    function fila(sw, txt, v, n) {
        return '<div class="mp-row"><span>' + (sw ? '<i class="mp-sw" style="background:' + sw + '"></i>' : "") + txt +
            "</span><b>" + num(v) + "<small>" + pct(v, n) + "</small></b></div>";
    }

    function ficha(tipo, k, ix, G, anio, puestos) {
        var t = TXT[tipo], q = ix[k], g = null;
        G.items.forEach(function (it) { if (clave(it.n) === k) g = it; });
        if (!g && !q) return '<div class="mp-vacio">Haga clic en una ' + t.una + " del mapa para ver sus cifras.</div>";
        var nombre = titulo(g ? g.n : q.label);
        var cab = '<div class="mp-nom">' + esc(nombre) + (tipo === "peru" && g ? "<span>" + esc(titulo(g.dep)) + "</span>" : "") + "</div>";
        if (!q || !q.n) return cab + '<p class="mp-nota">Sin salas autorizadas registradas en esta ' + t.una + ".</p>";
        var html = cab +
            (puestos[k] ? '<div class="mp-puesto">Puesto ' + puestos[k] + " de " + puestos._n + " " + t.varias + " por salas atendidas</div>" : "") +
            '<div class="mp-tri"><div><b>' + num(q.n) + "</b><span>Salas autorizadas</span></div>" +
            "<div><b>" + num(q.a) + "</b><span>Atendidas en " + esc(anio) + "</span></div>" +
            '<div class="' + (q.a ? "" : "mp-alerta") + '"><b>' + pct(q.a, q.n) + "</b><span>Cobertura</span></div></div>" +
            '<div class="mp-sec">Atención en ' + esc(anio) + "</div>" +
            barra(q, [["f", "var(--f)"], ["c", "var(--c)"], ["r", "var(--a)"]]) +
            fila("var(--f)", "Fiscalizadas", q.f, q.n) + fila("var(--c)", "Cerradas", q.c, q.n) +
            fila("var(--a)", "Revocadas", q.r, q.n) + fila("var(--ln)", "Sin atender", q.n - q.a, q.n) +
            '<div class="mp-sec">Estado de la autorización</div>' +
            fila("", "Vigentes", q.ev, q.n) + fila("", "Suspendidas", q.es, q.n) + fila("", "Revocadas", q.er, q.n);
        if (tipo === "peru" && k === "LIMA") html += '<p class="mp-nota">El detalle por distrito está en la tarjeta «04 · Distritos de Lima».</p>';
        return html;
    }

    function dibujar(tipo) {
        var G = window.__GEO_APD && window.__GEO_APD[tipo];
        var u = ultimo[tipo];
        if (!G || !u) return "";
        var t = TXT[tipo], ix = indice(u.filas), sel = elegido[tipo], selG = null, enMapa = {};
        var conSalas = Object.keys(ix).filter(function (k) { return ix[k].n; });
        var tot = { n: 0, a: 0 };
        conSalas.forEach(function (k) { tot.n += ix[k].n; tot.a += ix[k].a; });
        var orden = conSalas.slice().sort(function (x, y) { return ix[y].a - ix[x].a || ix[y].n - ix[x].n; });
        var puestos = { _n: orden.length };
        orden.forEach(function (k, i) { puestos[k] = i + 1; });
        var pend = conSalas.filter(function (k) { return !ix[k].a; }).sort(function (x, y) { return ix[y].n - ix[x].n; });
        var salasPend = pend.reduce(function (s, k) { return s + ix[k].n; }, 0);

        // Encuadre: todo el mapa, o en Lima solo el area urbana.
        var vb = [-4, -4, G.w + 8, G.h + 8];
        if (tipo === "lima" && zoom.lima === "urb") {
            var bx = [1e9, 1e9, -1e9, -1e9];
            G.items.forEach(function (g) {
                if (PERIFERIA.indexOf(clave(g.n)) >= 0) return;
                bx = [Math.min(bx[0], g.b[0]), Math.min(bx[1], g.b[1]), Math.max(bx[2], g.b[2]), Math.max(bx[3], g.b[3])];
            });
            var pad = 6;
            vb = [bx[0] - pad, bx[1] - pad, bx[2] - bx[0] + 2 * pad, bx[3] - bx[1] + 2 * pad];
        }
        var esc1 = vb[2] / 480;   // unidades del mapa por pixel aproximado

        var paths = G.items.map(function (g) {
            var k = clave(g.n), q = ix[k];
            enMapa[k] = 1;
            if (sel === k) selG = g;
            var tip = titulo(g.n) + (q && q.n ? ": " + num(q.a) + " de " + num(q.n) + " salas atendidas (" + pct(q.a, q.n) + ")" : ": sin salas");
            return '<path d="' + g.d + '" data-mp="' + esc(k) + '" style="' + relleno(q) + ";stroke-width:" + (0.8 * esc1).toFixed(2) +
                '" tabindex="0" role="button" aria-label="' + esc(tip) + '"><title>' + esc(tip) + "</title></path>";
        });
        if (selG) paths.push('<path d="' + selG.d + '" class="mp-borde" style="stroke-width:' + (2.6 * esc1).toFixed(2) + '" aria-hidden="true"></path>');
        // Etiquetas: las 5 con mas salas atendidas y la seleccionada.
        var etq = orden.slice(0, 5);
        if (sel && etq.indexOf(sel) < 0 && ix[sel]) etq.push(sel);
        var fs = 13 * esc1;
        var labels = etq.map(function (k) {
            var g = null;
            G.items.forEach(function (it) { if (clave(it.n) === k) g = it; });
            if (!g) return "";
            var x = g.c[0], y = g.c[1];
            if (x < vb[0] || x > vb[0] + vb[2] || y < vb[1] || y > vb[1] + vb[3]) return "";
            return '<g class="mp-lbl" aria-hidden="true"><circle cx="' + x + '" cy="' + y + '" r="' + (2.6 * esc1).toFixed(2) + '" style="stroke-width:' + (0.8 * esc1).toFixed(2) + 'px"/>' +
                '<text x="' + (x + 5 * esc1).toFixed(1) + '" y="' + (y - 3 * esc1).toFixed(1) + '" style="font-size:' + fs.toFixed(2) + 'px;stroke-width:' + (3 * esc1).toFixed(2) + 'px">' + esc(titulo(g.n)) +
                '<tspan x="' + (x + 5 * esc1).toFixed(1) + '" dy="' + (fs * 1.15).toFixed(2) + '" class="mp-lv">' + pct(ix[k].a, ix[k].n) + " · " + num(ix[k].a) + "/" + num(ix[k].n) + "</tspan></text></g>";
        }).join("");

        var fuera = Object.keys(ix).filter(function (k) { return !enMapa[k]; });
        var leyenda = '<div class="mp-ley"><span class="mp-lt">Cobertura</span>' +
            '<span><i style="background:var(--c);opacity:.38"></i>0 %</span>' +
            TRAMOS.map(function (tr, i) {
                var de = i ? TRAMOS[i - 1][0] * 100 : 0, a = Math.min(tr[0], 1) * 100;
                return '<span><i style="background:var(--f);opacity:' + tr[1] + '"></i>' + (de || "1") + "–" + a + " %</span>";
            }).join("") + '<span><i style="background:var(--ln)"></i>Sin salas</span></div>';
        var botones = tipo === "lima" ? '<div class="mp-zoom" role="group" aria-label="Encuadre">' +
            '<button data-mp-zoom="urb" class="' + (zoom.lima === "urb" ? "on" : "") + '">Lima urbana</button>' +
            '<button data-mp-zoom="todo" class="' + (zoom.lima === "todo" ? "on" : "") + '">Toda la provincia</button></div>' : "";

        var kpis = '<div class="mp-kpi">' +
            "<div><b>" + num(tot.n) + "</b><span>Salas autorizadas en " + orden.length + " " + t.varias + "</span></div>" +
            '<div class="mp-k-f"><b>' + pct(tot.a, tot.n) + "</b><span>Cobertura " + esc(u.anio) + " · " + num(tot.a) + " salas atendidas</span></div>" +
            '<div class="mp-k-c"><b>' + pend.length + "</b><span>" + titulo(t.varias) + " sin ninguna atención · " + num(salasPend) + " salas</span></div>" +
            "</div>";
        var prio = pend.length ? '<div class="mp-prio"><div class="mp-sec">Prioridad: ' + t.varias + " sin atención</div>" +
            pend.slice(0, 6).map(function (k) {
                return '<button data-mp-ir="' + esc(k) + '" class="' + (sel === k ? "on" : "") + '"><span>' + esc(titulo(ix[k].label)) + "</span><b>" + num(ix[k].n) + " salas</b></button>";
            }).join("") + "</div>" : "";

        return '<div class="mp" data-mp-tipo="' + tipo + '">' + kpis +
            '<div class="mp-g"><div class="mp-mapa"><div class="mp-top"><h4>' + t.titulo + "</h4>" + botones + "</div>" + leyenda +
            '<div class="mp-svg"><svg viewBox="' + vb.map(function (v) { return v.toFixed(1); }).join(" ") + '" role="group" aria-label="Mapa: ' + t.titulo + '">' +
            paths.join("") + labels + "</svg></div>" +
            '<p class="mp-nota">Haga clic en una ' + t.una + " para ver su detalle." +
            (fuera.length ? " No se ubicaron en el mapa: " + fuera.map(function (k) { return esc(ix[k].label) + " (" + num(ix[k].n) + ")"; }).join(", ") + "." : "") + "</p></div>" +
            '<div class="mp-lado"><div class="mp-info" aria-live="polite">' + ficha(tipo, sel, ix, G, u.anio, puestos) + "</div>" + prio + "</div></div></div>";
    }

    var CSS = ".mp{margin-top:4px}" +
        ".mp-kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:0 0 20px}" +
        ".mp-kpi div{border:1px solid var(--ln);border-left:4px solid var(--ink);border-radius:8px;padding:10px 14px;background:var(--bg)}" +
        ".mp-kpi .mp-k-f{border-left-color:var(--f)}.mp-kpi .mp-k-c{border-left-color:var(--c)}" +
        ".mp-kpi b{display:block;font-size:28px;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}" +
        ".mp-kpi span{font-size:12.5px;color:var(--mu)}" +
        ".mp-g{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(280px,1fr);gap:24px;align-items:start}" +
        "@media (max-width:900px){.mp-g{grid-template-columns:minmax(0,1fr)}}" +
        ".mp-top{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}.mp-top h4{margin:0!important}" +
        ".mp-zoom{display:inline-flex;border:1px solid var(--ln);border-radius:7px;overflow:hidden}" +
        ".mp-zoom button{border:0;background:var(--panel);color:var(--mu);font-size:12.5px;font-weight:600;padding:6px 12px}" +
        ".mp-zoom button.on{background:var(--ink);color:var(--panel)}" +
        ".mp-ley{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:12px;color:var(--mu);margin:0 0 8px}" +
        ".mp-ley .mp-lt{font-weight:700;color:var(--ink)}" +
        ".mp-ley i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:5px;vertical-align:-2px}" +
        ".mp-svg{border:1px solid var(--ln);border-radius:10px;background:var(--panel);padding:8px}" +
        ".mp-svg svg{display:block;width:100%;height:auto;max-height:680px}" +
        ".mp-svg path{stroke:var(--panel);stroke-linejoin:round;cursor:pointer;outline:none}" +
        ".mp-svg path:hover,.mp-svg path:focus-visible{stroke:var(--ink)}" +
        ".mp-svg path.mp-borde{fill:none!important;stroke:var(--ink);pointer-events:none}" +
        ".mp-lbl{pointer-events:none}.mp-lbl circle{fill:var(--ink);stroke:var(--panel)}" +
        ".mp-lbl text{fill:var(--ink);font-weight:700;paint-order:stroke;stroke:var(--panel);stroke-linejoin:round}" +
        ".mp-lbl .mp-lv{font-weight:600;fill:var(--mu)}" +
        ".mp-lado{position:sticky;top:12px;display:grid;gap:14px}" +
        ".mp-info{border:1px solid var(--ln);border-top:4px solid var(--f);border-radius:10px;background:var(--panel);padding:16px 18px}" +
        ".mp-vacio{color:var(--mu);font-size:13.5px;padding:18px 0;text-align:center}" +
        ".mp-nom{font-size:20px;font-weight:700;line-height:1.2}.mp-nom span{display:block;font-size:11.5px;font-weight:700;color:var(--mu);letter-spacing:.08em;text-transform:uppercase;margin-top:2px}" +
        ".mp-puesto{font-size:12.5px;color:var(--mu);margin-top:4px}" +
        ".mp-tri{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 4px}" +
        ".mp-tri div{background:var(--bg);border-radius:8px;padding:8px 10px}.mp-tri b{display:block;font-size:20px;line-height:1.15;font-variant-numeric:tabular-nums}" +
        ".mp-tri span{font-size:11.5px;color:var(--mu)}.mp-tri .mp-alerta b{color:var(--c)}" +
        ".mp-sec{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--mu);font-weight:700;margin:14px 0 6px}" +
        ".mp-row{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13.5px;padding:4px 0;border-bottom:1px solid var(--ln)}" +
        ".mp-row b{font-variant-numeric:tabular-nums}.mp-row small{font-weight:500;color:var(--mu);margin-left:8px;display:inline-block;min-width:52px;text-align:right}" +
        ".mp-sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:7px}" +
        ".mp-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--ln);margin:0 0 6px}.mp-bar i{display:block;height:100%}" +
        ".mp-prio{border:1px solid var(--ln);border-top:4px solid var(--c);border-radius:10px;background:var(--panel);padding:4px 18px 12px}" +
        ".mp-prio button{display:flex;justify-content:space-between;width:100%;gap:10px;border:0;border-bottom:1px solid var(--ln);background:none;color:var(--ink);font-size:13.5px;padding:6px 0;text-align:left}" +
        ".mp-prio button:hover,.mp-prio button.on{color:var(--c)}.mp-prio b{font-variant-numeric:tabular-nums;white-space:nowrap}" +
        ".mp-nota{font-size:12.5px;color:var(--mu);margin:10px 0 0}" +
        "@media print{.mp-zoom,.mp-prio{display:none}.mp-lado{position:static}}";

    function enganchar() {
        if (enganchado) return;
        var host = document.getElementById("dash"), root = host && host.shadowRoot;
        if (!root) return;
        enganchado = true;
        var st = document.createElement("style");
        st.textContent = CSS;
        root.appendChild(st);
        var redibujar = function (box, tipo, foco) {
            var tmp = document.createElement("div");
            tmp.innerHTML = dibujar(tipo);
            box.replaceWith(tmp.firstChild);
            if (foco) { var el = root.querySelector('.mp[data-mp-tipo="' + tipo + '"] ' + foco); if (el) el.focus(); }
        };
        var accion = function (ev) {
            var el = ev.target.closest && ev.target.closest("path[data-mp],[data-mp-ir],[data-mp-zoom]");
            if (!el) return;
            var box = el.closest(".mp"), tipo = box && box.getAttribute("data-mp-tipo");
            if (!tipo) return;
            if (el.hasAttribute("data-mp-zoom")) { zoom[tipo] = el.getAttribute("data-mp-zoom"); return redibujar(box, tipo); }
            var k = el.getAttribute("data-mp") || el.getAttribute("data-mp-ir");
            elegido[tipo] = k;
            if (tipo === "lima" && PERIFERIA.indexOf(k) >= 0) zoom.lima = "todo";   // queda fuera de «Lima urbana»
            redibujar(box, tipo, ev.type === "keydown" ? 'path[data-mp="' + k.replace(/"/g, '\\"') + '"]' : "");
        };
        root.addEventListener("click", accion);
        root.addEventListener("keydown", function (ev) {
            if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches && ev.target.matches("path[data-mp]")) { ev.preventDefault(); accion(ev); }
        });
    }

    window.__MAPA_APD = function (tipo, filas, anio) {
        if (!TXT[tipo] || !window.__GEO_APD || window.__GEO_APD.v !== 2) return "";
        ultimo[tipo] = { filas: filas || [], anio: anio };
        // Por defecto se muestra la mas fiscalizada (la primera por salas atendidas).
        if (!elegido[tipo]) {
            var top = (filas || []).filter(function (q) { return clave(q.label) !== "SIN DATO"; })
                .sort(function (x, y) { return y.a - x.a || y.n - x.n; })[0];
            if (top) elegido[tipo] = clave(top.label);
        }
        setTimeout(enganchar, 0);
        // Si el mapa falla (p. ej. un geo.js viejo), se devuelve "" y la tarjeta vuelve a las barras sin romper el panel.
        try { return dibujar(tipo); } catch (e) { console.error("[mapas]", e); return ""; }
    };
})();
