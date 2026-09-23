/**
 * App Panel controller for review-widget-webflow (Designer Extension iframe).
 * Credentials (site id + admin token) arrive in the OAuth redirect fragment or via the Connect form,
 * and are kept in localStorage. Every API call is sent with `Authorization: Bearer <admin token>`.
 */
(function () {
  "use strict";

  var API_BASE = window.location.origin.replace(/\/designer-extension.*/, "");
  var PRESETS = {
    classic:  { label: "Classic list", layout: "list", cardsPerRow: 1, starColor: "#f5a623", theme: "light" },
    grid:     { label: "Card grid", layout: "list", cardsPerRow: 3, starColor: "#f5a623", theme: "light" },
    carousel: { label: "Carousel", layout: "carousel", cardsPerRow: 3, starColor: "#ff6b6b", theme: "light" },
    midnight: { label: "Midnight", layout: "list", cardsPerRow: 2, starColor: "#ffd166", theme: "dark" }
  };
  var state = { site: null, token: null, info: null, config: null, filter: "all" };

  function $(id) { return document.getElementById(id); }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    return null;
  }
  function toast(msg, isErr) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isErr ? " err" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  function api(path, method, body) {
    return fetch(API_BASE + "/api/admin" + path, {
      method: method || "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.token },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error(b.error || r.statusText);
        return b;
      });
    });
  }
  function fail(e) { toast(e.message || String(e), true); }

  // ---------- connection ----------
  function readCredentials() {
    var frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (frag.get("site") && frag.get("token")) {
      store("rw_site", frag.get("site"));
      store("rw_token", frag.get("token"));
      history.replaceState(null, "", window.location.pathname);
    }
    state.site = store("rw_site");
    state.token = store("rw_token");
  }
  function showConnect() {
    $("connect-card").hidden = false;
    $("main").hidden = true;
    if (window.webflow && window.webflow.getSiteInfo) {
      window.webflow.getSiteInfo().then(function (i) { if (i && i.siteId && !$("conn-site").value) $("conn-site").value = i.siteId; }).catch(function () {});
    }
  }
  $("conn-save").addEventListener("click", function () {
    var s = $("conn-site").value.trim(), t = $("conn-token").value.trim();
    if (!s || !t) return toast("Site ID and admin token are required.", true);
    store("rw_site", s); store("rw_token", t);
    state.site = s; state.token = t;
    start();
  });
  $("setup-disconnect").addEventListener("click", function () {
    store("rw_site", null); store("rw_token", null);
    state.token = null;
    showConnect();
  });

  // ---------- tabs ----------
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
    tab.addEventListener("click", function () {
      Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) { t.classList.toggle("active", t === tab); });
      ["queue", "replies", "style", "setup"].forEach(function (n) { $("pane-" + n).hidden = n !== tab.dataset.tab; });
      if (tab.dataset.tab === "replies") loadReplies();
      if (tab.dataset.tab === "style") renderStyle();
      if (tab.dataset.tab === "setup") loadSetup();
    });
  });

  // ---------- moderation queue ----------
  function starText(n) { return new Array(n + 1).join("★") + new Array(6 - n).join("☆"); }

  Array.prototype.forEach.call(document.querySelectorAll("#queue-filter .btn"), function (b) {
    b.addEventListener("click", function () {
      state.filter = b.dataset.filter;
      Array.prototype.forEach.call(document.querySelectorAll("#queue-filter .btn"), function (x) { x.classList.toggle("active", x === b); });
      loadQueue();
    });
  });
  $("queue-refresh").addEventListener("click", function () { loadQueue(); refreshInfo(); });

  function loadQueue() {
    return api("/queue?filter=" + state.filter).then(function (out) {
      var list = $("queue-list");
      list.innerHTML = "";
      if (!out.reviews.length) return list.appendChild(el("div", { class: "empty", text: "Nothing waiting for moderation." }));
      out.reviews.forEach(function (r) { list.appendChild(queueCard(r)); });
    }).catch(fail);
  }

  function queueCard(r) {
    var author = el("input", { value: r.authorName, "aria-label": "Author" });
    var rating = el("select", { "aria-label": "Rating" });
    for (var i = 5; i >= 1; i--) { var o = el("option", { value: String(i), text: i + " stars" }); if (i === r.rating) o.selected = true; rating.appendChild(o); }
    var title = el("input", { value: r.title, "aria-label": "Title", placeholder: "Title" });
    var body = el("textarea", { rows: "3", "aria-label": "Body" });
    body.value = r.body;
    var edits = function () { return { authorName: author.value, rating: Number(rating.value), title: title.value, body: body.value }; };
    var card = el("div", { class: "review" + (r.flagged ? " flagged" : "") }, [
      el("div", { class: "head" }, [
        el("span", { class: "stars", text: starText(r.rating) }),
        el("span", {}, [
          r.flagged ? el("span", { class: "badge warn", text: "Flagged " + r.spamScore }) : el("span", { class: "badge", text: "Pending" }),
          r.verifiedPurchase ? el("span", { class: "badge ok", text: "Verified" }) : null
        ])
      ]),
      el("div", { class: "muted", text: (r.productName || r.productId) + " · " + new Date(r.createdAt).toLocaleString() }),
      r.spamReasons.length ? el("div", { class: "reasons", text: "Spam signals: " + r.spamReasons.join("; ") }) : null,
      el("div", { class: "row" }, [author, rating]), title, body,
      el("div", { class: "actions" }, [
        el("button", { class: "btn primary", text: "Approve & publish", onclick: function () {
          api("/reviews/" + r.id + "/approve", "POST", { edits: edits() }).then(function () { toast("Approved and published to the CMS."); loadQueue(); refreshInfo(); }).catch(fail);
        } }),
        el("button", { class: "btn danger", text: "Reject", onclick: function () {
          api("/reviews/" + r.id + "/reject", "POST").then(function () { toast("Rejected (kept for spam learning)."); loadQueue(); refreshInfo(); }).catch(fail);
        } })
      ])
    ]);
    return card;
  }

  // ---------- replies ----------
  function loadReplies() {
    return api("/reviews?status=approved").then(function (out) {
      var list = $("replies-list");
      list.innerHTML = "";
      if (!out.reviews.length) return list.appendChild(el("div", { class: "empty", text: "No approved reviews yet." }));
      out.reviews.forEach(function (r) {
        var ta = el("textarea", { rows: "2", maxlength: "2000", placeholder: "Write a public reply..." });
        ta.value = r.ownerReply;
        list.appendChild(el("div", { class: "review" }, [
          el("div", { class: "head" }, [el("span", { class: "stars", text: starText(r.rating) }), el("strong", { text: r.authorName })]),
          el("div", { text: (r.title ? r.title + " — " : "") + r.body }),
          ta,
          el("div", { class: "actions" }, [el("button", { class: "btn primary", text: "Save reply", onclick: function () {
            api("/reviews/" + r.id + "/reply", "PUT", { reply: ta.value }).then(function () { toast("Reply saved."); }).catch(fail);
          } })])
        ]));
      });
    }).catch(fail);
  }

  // ---------- widget configurator ----------
  function readForm() {
    return {
      preset: state.config.preset,
      layout: $("cfg-layout").value, theme: $("cfg-theme").value, starColor: $("cfg-star").value,
      cardsPerRow: Number($("cfg-cards").value) || 1, pageSize: Number($("cfg-page").value) || 6,
      defaultSort: $("cfg-sort").value, showForm: $("cfg-form").checked
    };
  }
  function fillForm(c) {
    $("cfg-layout").value = c.layout; $("cfg-theme").value = c.theme; $("cfg-star").value = c.starColor;
    $("cfg-cards").value = c.cardsPerRow; $("cfg-page").value = c.pageSize; $("cfg-sort").value = c.defaultSort;
    $("cfg-form").checked = !!c.showForm;
  }
  function renderStyle() {
    var box = $("preset-buttons");
    box.innerHTML = "";
    Object.keys(PRESETS).forEach(function (k) {
      box.appendChild(el("button", { class: "btn", text: PRESETS[k].label, onclick: function () {
        var p = PRESETS[k];
        state.config.preset = k;
        fillForm(Object.assign({}, readForm(), { layout: p.layout, cardsPerRow: p.cardsPerRow, starColor: p.starColor, theme: p.theme }));
        refreshStyle();
      } }));
    });
    refreshStyle();
  }
  function refreshStyle() {
    var c = readForm();
    var q = new URLSearchParams({
      layout: c.layout, starColor: c.starColor, cardsPerRow: String(c.cardsPerRow), pageSize: String(c.pageSize),
      sort: c.defaultSort, theme: c.theme, showForm: String(c.showForm)
    });
    $("preview").src = API_BASE + "/widget/preview.html?" + q.toString();
    renderSnippet(c);
  }
  function renderSnippet(c) {
    var attrs = ['data-review-widget', 'data-key="' + state.info.publicKey + '"', 'data-product-id="' + ($("snip-product").value.trim() || "PRODUCT_ITEM_ID") + '"'];
    if ($("snip-explicit").checked) {
      attrs.push('data-layout="' + c.layout + '"', 'data-star-color="' + c.starColor + '"', 'data-cards-per-row="' + c.cardsPerRow + '"',
        'data-page-size="' + c.pageSize + '"', 'data-sort="' + c.defaultSort + '"', 'data-theme="' + c.theme + '"', 'data-show-form="' + c.showForm + '"');
    }
    $("snippet").textContent = "<div " + attrs.join(" ") + "></div>\n<script src=\"" + state.info.appUrl + "/widget/reviews.js\" defer></script>";
  }
  ["cfg-layout", "cfg-theme", "cfg-star", "cfg-cards", "cfg-page", "cfg-sort", "cfg-form", "snip-explicit"].forEach(function (id) {
    $(id).addEventListener("change", function () { if (state.config) refreshStyle(); });
  });
  $("snip-product").addEventListener("input", function () { if (state.config) renderSnippet(readForm()); });
  $("cfg-save").addEventListener("click", function () {
    api("/config", "PUT", readForm()).then(function (c) { state.config = c; $("cfg-status").textContent = "Saved."; toast("Widget defaults saved."); }).catch(fail);
  });
  $("snip-copy").addEventListener("click", function () {
    var text = $("snippet").textContent;
    var done = function () { toast("Snippet copied."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("Copy failed; select the snippet manually.", true); });
    else toast("Copy is unavailable here; select the snippet manually.", true);
  });

  // ---------- setup ----------
  function loadSetup() {
    $("setup-conn").textContent = "Site " + state.site + " · widget key " + state.info.publicKey;
    $("setup-reviews").textContent = state.info.reviewsCollectionId ? "Reviews collection ID: " + state.info.reviewsCollectionId : "Not created yet.";
    api("/collections").then(function (out) {
      var sel = $("setup-products");
      sel.innerHTML = "";
      out.collections.filter(function (c) { return c.id !== state.info.reviewsCollectionId; }).forEach(function (c) {
        var o = el("option", { value: c.id, text: c.displayName });
        if (c.id === state.info.productsCollectionId) o.selected = true;
        sel.appendChild(o);
      });
      $("setup-products-status").textContent = state.info.productsCollectionId ? "Currently linked: " + state.info.productsCollectionId : "No collection linked.";
    }).catch(fail);
  }
  $("setup-bootstrap").addEventListener("click", function () {
    api("/bootstrap", "POST").then(function () { toast("Reviews collection is ready."); return refreshInfo().then(loadSetup); }).catch(fail);
  });
  $("setup-link").addEventListener("click", function () {
    var id = $("setup-products").value;
    if (!id) return toast("Pick a collection first.", true);
    api("/products-collection", "POST", { collectionId: id }).then(function () { toast("Products collection linked."); return refreshInfo().then(loadSetup); }).catch(fail);
  });
  $("setup-sync").addEventListener("click", function () {
    api("/sync", "POST").then(function (r) { $("setup-sync-status").textContent = "Checked " + r.checked + ", updated " + r.updated + ", removed " + r.removed + "."; }).catch(fail);
  });

  // ---------- boot ----------
  function refreshInfo() {
    return api("/site").then(function (i) {
      state.info = i;
      var n = i.pending + i.flagged;
      $("queue-count").textContent = n ? String(n) : "";
    });
  }
  function start() {
    if (!state.token) return showConnect();
    refreshInfo().then(function () {
      $("connect-card").hidden = true;
      $("main").hidden = false;
      return api("/config");
    }).then(function (c) {
      state.config = c;
      fillForm(c);
      return loadQueue();
    }).catch(function (e) { fail(e); showConnect(); });
  }

  readCredentials();
  start();
})();
