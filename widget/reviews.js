/**
 * review-widget-webflow embeddable widget (vanilla JS, no dependencies).
 *
 *   <div data-review-widget data-key="PUBLIC_KEY" data-product-id="CMS_ITEM_ID"></div>
 *   <script src="https://YOUR-APP/widget/reviews.js" defer></script>
 *
 * See README.md for the full data-attribute reference.
 */
(function () {
  "use strict";

  var script = document.currentScript || Array.prototype.slice.call(document.scripts).filter(function (s) { return /reviews\.js/.test(s.src); }).pop();
  var BASE = (script && script.src ? new URL(script.src).origin : window.location.origin);

  var SAMPLE = [
    { id: "s1", authorName: "Maya R.", rating: 5, title: "Exactly what I needed", body: "Great quality and fast delivery. I would happily buy again.", verifiedPurchase: true, helpfulCount: 12, ownerReply: "Thank you Maya, enjoy!", ownerReplyAt: "2026-08-01T10:00:00Z", createdAt: "2026-07-28T10:00:00Z" },
    { id: "s2", authorName: "Tom H.", rating: 4, title: "Very good", body: "Solid product. Packaging could be better but the item itself is excellent.", verifiedPurchase: true, helpfulCount: 5, ownerReply: "", ownerReplyAt: null, createdAt: "2026-07-20T10:00:00Z" },
    { id: "s3", authorName: "Priya S.", rating: 5, title: "Love it", body: "Bought it as a gift and it was a hit.", verifiedPurchase: false, helpfulCount: 3, ownerReply: "", ownerReplyAt: null, createdAt: "2026-07-11T10:00:00Z" },
    { id: "s4", authorName: "Alex D.", rating: 3, title: "Decent", body: "Does the job. Nothing special but no complaints.", verifiedPurchase: false, helpfulCount: 1, ownerReply: "", ownerReplyAt: null, createdAt: "2026-06-30T10:00:00Z" },
    { id: "s5", authorName: "Lena K.", rating: 2, title: "Not for me", body: "Smaller than I expected.", verifiedPurchase: true, helpfulCount: 0, ownerReply: "Sorry to hear that, please contact support.", ownerReplyAt: "2026-06-25T10:00:00Z", createdAt: "2026-06-22T10:00:00Z" }
  ];

  var CSS = [
    ".rw{--rw-star:#f5a623;--rw-bg:#fff;--rw-fg:#1b1b1f;--rw-muted:#6b6b76;--rw-border:#e3e3ea;--rw-card:#fafafc;--rw-cols:1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--rw-fg);background:var(--rw-bg);padding:16px;border-radius:12px;line-height:1.5;box-sizing:border-box}",
    ".rw *{box-sizing:border-box}",
    ".rw[data-theme=dark]{--rw-bg:#15151a;--rw-fg:#f2f2f5;--rw-muted:#a0a0ad;--rw-border:#2c2c35;--rw-card:#1e1e25}",
    ".rw-stars{color:var(--rw-star);letter-spacing:2px;white-space:nowrap}",
    ".rw-stars .rw-off{opacity:.25}",
    ".rw-summary{display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin-bottom:16px}",
    ".rw-avg{text-align:center}.rw-avg b{font-size:40px;display:block;line-height:1}",
    ".rw-dist{flex:1;min-width:200px}",
    ".rw-row{display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0;color:var(--rw-muted)}",
    ".rw-bar{flex:1;height:8px;background:var(--rw-border);border-radius:4px;overflow:hidden}",
    ".rw-fill{height:100%;background:var(--rw-star);border-radius:4px}",
    ".rw-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 0 12px;flex-wrap:wrap}",
    ".rw select,.rw input,.rw textarea{font:inherit;padding:8px 10px;border:1px solid var(--rw-border);border-radius:8px;background:var(--rw-bg);color:var(--rw-fg);width:100%}",
    ".rw-toolbar select{width:auto}",
    ".rw-list{display:grid;grid-template-columns:repeat(var(--rw-cols),minmax(0,1fr));gap:12px}",
    ".rw-carousel{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding-bottom:8px}",
    ".rw-carousel .rw-card{flex:0 0 calc((100% - (var(--rw-cols) - 1) * 12px) / var(--rw-cols));scroll-snap-align:start}",
    ".rw-card{border:1px solid var(--rw-border);background:var(--rw-card);border-radius:10px;padding:14px;min-width:0}",
    ".rw-card h4{margin:4px 0;font-size:15px}.rw-card p{margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}",
    ".rw-meta{font-size:12px;color:var(--rw-muted);display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".rw-badge{background:#e6f6ec;color:#17693a;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600}",
    ".rw[data-theme=dark] .rw-badge{background:#173a26;color:#7bdc9f}",
    ".rw-reply{margin-top:10px;padding:8px 10px;border-left:3px solid var(--rw-star);background:var(--rw-bg);border-radius:0 8px 8px 0;font-size:13px}",
    ".rw-reply b{display:block;font-size:12px;color:var(--rw-muted)}",
    ".rw-btn{font:inherit;font-size:13px;border:1px solid var(--rw-border);background:var(--rw-bg);color:var(--rw-fg);border-radius:8px;padding:6px 12px;cursor:pointer}",
    ".rw-btn:disabled{opacity:.5;cursor:default}.rw-btn.rw-primary{background:var(--rw-star);border-color:var(--rw-star);color:#1b1b1f;font-weight:600}",
    ".rw-pager{display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;font-size:13px}",
    ".rw-form{margin-top:20px;border-top:1px solid var(--rw-border);padding-top:16px;display:grid;gap:10px}",
    ".rw-form h3{margin:0}.rw-form label{font-size:12px;color:var(--rw-muted);display:grid;gap:4px}",
    ".rw-input-stars{display:flex;gap:2px}",
    ".rw-input-stars button{background:none;border:0;font-size:28px;line-height:1;cursor:pointer;color:var(--rw-border);padding:0 2px}",
    ".rw-input-stars button.rw-on{color:var(--rw-star)}",
    ".rw-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}",
    ".rw-msg{font-size:13px;padding:8px 10px;border-radius:8px}.rw-msg.rw-ok{background:#e6f6ec;color:#17693a}.rw-msg.rw-err{background:#fdeaea;color:#a12222}",
    ".rw-empty{color:var(--rw-muted);text-align:center;padding:16px}"
  ].join("");

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }

  function stars(n) {
    var s = h("span", { class: "rw-stars", role: "img", "aria-label": n + " out of 5 stars" });
    for (var i = 1; i <= 5; i++) s.appendChild(h("span", { class: i <= Math.round(n) ? "" : "rw-off", text: "★" }));
    return s;
  }

  function storage(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
    return null;
  }
  function clientToken() {
    var t = storage("rw_client_token");
    if (!t) {
      t = Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
      storage("rw_client_token", t);
    }
    return t;
  }
  function votedSet() {
    try { return JSON.parse(storage("rw_voted") || "[]"); } catch (e) { return []; }
  }

  function bool(v, d) { return v === undefined || v === null || v === "" ? d : v === "true" || v === "1"; }

  function Widget(el) {
    var self = this;
    var d = el.dataset;
    this.el = el;
    this.key = d.key || "";
    this.preview = bool(d.preview, false);
    this.api = (d.api || BASE) + "/api";
    this.state = { productId: d.productId || "", productName: d.productName || "", page: 1, sort: null, data: null, loaded: [], requestToken: null, prefill: {}, verified: false };
    this.opts = {
      layout: d.layout, starColor: d.starColor, cardsPerRow: d.cardsPerRow, pageSize: d.pageSize,
      sort: d.sort, theme: d.theme, showForm: d.showForm
    };
    this.cfg = { layout: "list", starColor: "#f5a623", cardsPerRow: 1, pageSize: 6, defaultSort: "newest", theme: "light", showForm: true };

    var q = new URL(window.location.href).searchParams.get("rw_request");
    var boot = Promise.resolve();
    if (q && !this.preview) {
      boot = fetch(this.api + "/review-request?token=" + encodeURIComponent(q))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (info) {
          if (!info) return;
          if (!self.key) self.key = info.key;
          if (!self.state.productId) self.state.productId = info.productId;
          self.state.productName = self.state.productName || info.productName;
          self.state.requestToken = q;
          self.state.prefill = { authorName: info.authorName };
          self.state.verified = info.verified;
        }).catch(function () {});
    }
    boot.then(function () {
      if (self.preview) return null;
      return fetch(self.api + "/config?key=" + encodeURIComponent(self.key)).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }).then(function (remote) {
      if (remote) Object.keys(remote).forEach(function (k) { self.cfg[k] = remote[k]; });
      var o = self.opts;
      if (o.layout) self.cfg.layout = o.layout;
      if (o.starColor) self.cfg.starColor = o.starColor;
      if (o.cardsPerRow) self.cfg.cardsPerRow = parseInt(o.cardsPerRow, 10) || 1;
      if (o.pageSize) self.cfg.pageSize = parseInt(o.pageSize, 10) || 6;
      if (o.sort) self.cfg.defaultSort = o.sort;
      if (o.theme) self.cfg.theme = o.theme;
      if (o.showForm !== undefined) self.cfg.showForm = bool(o.showForm, true);
      self.state.sort = self.cfg.defaultSort;
      self.mount();
      self.load(1, false);
    });
  }

  Widget.prototype.mount = function () {
    var root = this.el;
    root.innerHTML = "";
    root.classList.add("rw");
    root.setAttribute("data-theme", this.cfg.theme);
    root.style.setProperty("--rw-star", this.cfg.starColor);
    root.style.setProperty("--rw-cols", String(Math.min(4, Math.max(1, this.cfg.cardsPerRow))));
    this.summaryEl = h("div", { class: "rw-summary" });
    this.toolbarEl = h("div", { class: "rw-toolbar" });
    this.listEl = h("div");
    this.pagerEl = h("div", { class: "rw-pager" });
    this.formEl = h("div");
    root.appendChild(this.summaryEl);
    root.appendChild(this.toolbarEl);
    root.appendChild(this.listEl);
    root.appendChild(this.pagerEl);
    root.appendChild(this.formEl);
    this.renderToolbar();
    if (this.cfg.showForm || this.state.requestToken) this.renderForm();
  };

  Widget.prototype.fetchPage = function (page) {
    var s = this.state, size = this.cfg.pageSize;
    if (this.preview) {
      var all = SAMPLE.slice();
      if (s.sort === "highest") all.sort(function (a, b) { return b.rating - a.rating; });
      else if (s.sort === "helpful") all.sort(function (a, b) { return b.helpfulCount - a.helpfulCount; });
      var dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, sum = 0;
      SAMPLE.forEach(function (r) { dist[r.rating]++; sum += r.rating; });
      return Promise.resolve({ reviews: all.slice((page - 1) * size, page * size), summary: { count: SAMPLE.length, average: Math.round(sum / SAMPLE.length * 10) / 10, distribution: dist }, total: SAMPLE.length });
    }
    var url = this.api + "/reviews?key=" + encodeURIComponent(this.key) + "&product=" + encodeURIComponent(s.productId) +
      "&sort=" + encodeURIComponent(s.sort) + "&page=" + page + "&pageSize=" + size;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Could not load reviews");
      return r.json();
    });
  };

  Widget.prototype.load = function (page, append) {
    var self = this;
    this.fetchPage(page).then(function (data) {
      self.state.page = page;
      self.state.data = data;
      self.state.loaded = append ? self.state.loaded.concat(data.reviews) : data.reviews;
      self.renderSummary();
      self.renderList();
      self.renderPager();
    }).catch(function (e) {
      self.listEl.innerHTML = "";
      self.listEl.appendChild(h("div", { class: "rw-empty", text: e.message || "Could not load reviews" }));
    });
  };

  Widget.prototype.renderSummary = function () {
    var sm = this.state.data.summary;
    this.summaryEl.innerHTML = "";
    var avg = h("div", { class: "rw-avg" }, [h("b", { text: sm.count ? sm.average.toFixed(1) : "-" }), stars(sm.average), h("div", { class: "rw-meta", text: sm.count + (sm.count === 1 ? " review" : " reviews") })]);
    var dist = h("div", { class: "rw-dist" });
    for (var i = 5; i >= 1; i--) {
      var pct = sm.count ? Math.round((sm.distribution[i] / sm.count) * 100) : 0;
      var fill = h("div", { class: "rw-fill" });
      fill.style.width = pct + "%";
      dist.appendChild(h("div", { class: "rw-row" }, [h("span", { text: i + " ★" }), h("div", { class: "rw-bar" }, [fill]), h("span", { text: String(sm.distribution[i]) })]));
    }
    this.summaryEl.appendChild(avg);
    this.summaryEl.appendChild(dist);
  };

  Widget.prototype.renderToolbar = function () {
    var self = this;
    var sel = h("select", { "aria-label": "Sort reviews", onchange: function () { self.state.sort = sel.value; self.load(1, false); } });
    [["newest", "Newest"], ["highest", "Highest rated"], ["helpful", "Most helpful"]].forEach(function (o) {
      var opt = h("option", { value: o[0], text: o[1] });
      if (o[0] === self.state.sort) opt.selected = true;
      sel.appendChild(opt);
    });
    this.toolbarEl.appendChild(h("span", { class: "rw-meta", text: "Customer reviews" }));
    this.toolbarEl.appendChild(sel);
  };

  Widget.prototype.card = function (r) {
    var self = this;
    var meta = h("div", { class: "rw-meta" }, [h("strong", { text: r.authorName }), r.verifiedPurchase ? h("span", { class: "rw-badge", text: "Verified purchase" }) : null, h("span", { text: new Date(r.createdAt).toLocaleDateString() })]);
    var voted = votedSet().indexOf(r.id) !== -1;
    var btn = h("button", { class: "rw-btn", type: "button", text: "Helpful (" + r.helpfulCount + ")" });
    btn.disabled = voted;
    btn.addEventListener("click", function () { self.vote(r, btn); });
    var card = h("div", { class: "rw-card" }, [stars(r.rating), r.title ? h("h4", { text: r.title }) : null, h("p", { text: r.body }), meta]);
    if (r.ownerReply) card.appendChild(h("div", { class: "rw-reply" }, [h("b", { text: "Reply from the owner" }), h("span", { text: r.ownerReply })]));
    card.appendChild(h("div", { style: "margin-top:10px" }, [btn]));
    return card;
  };

  Widget.prototype.vote = function (r, btn) {
    var self = this;
    btn.disabled = true;
    var done = function (count) {
      r.helpfulCount = count;
      btn.textContent = "Helpful (" + count + ")";
      var v = votedSet();
      if (v.indexOf(r.id) === -1) { v.push(r.id); storage("rw_voted", JSON.stringify(v)); }
    };
    if (this.preview) return done(r.helpfulCount + 1);
    fetch(this.api + "/reviews/" + encodeURIComponent(r.id) + "/helpful", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: this.key, clientToken: clientToken() })
    }).then(function (res) { return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; }); })
      .then(function (out) {
        if (out.ok || out.status === 409) done(typeof out.body.helpfulCount === "number" ? out.body.helpfulCount : r.helpfulCount);
        else btn.disabled = false;
      }).catch(function () { btn.disabled = false; });
    void self;
  };

  Widget.prototype.renderList = function () {
    var self = this;
    this.listEl.innerHTML = "";
    var items = this.state.loaded;
    if (!items.length) return void this.listEl.appendChild(h("div", { class: "rw-empty", text: "No reviews yet. Be the first to write one." }));
    var carousel = this.cfg.layout === "carousel";
    var wrap = h("div", { class: carousel ? "rw-carousel" : "rw-list" });
    items.forEach(function (r) { wrap.appendChild(self.card(r)); });
    this.listEl.appendChild(wrap);
    if (carousel) {
      var step = function (dir) { wrap.scrollBy({ left: dir * wrap.clientWidth * 0.9, behavior: "smooth" }); };
      this.listEl.appendChild(h("div", { class: "rw-pager" }, [
        h("button", { class: "rw-btn", type: "button", "aria-label": "Previous", text: "‹", onclick: function () { step(-1); } }),
        h("button", { class: "rw-btn", type: "button", "aria-label": "Next", text: "›", onclick: function () { step(1); } })
      ]));
    }
  };

  Widget.prototype.renderPager = function () {
    var self = this, s = this.state, size = this.cfg.pageSize;
    this.pagerEl.innerHTML = "";
    var pages = Math.max(1, Math.ceil(s.data.total / size));
    if (this.cfg.layout === "carousel") {
      if (s.page < pages) this.pagerEl.appendChild(h("button", { class: "rw-btn", type: "button", text: "Load more reviews", onclick: function () { self.load(s.page + 1, true); } }));
      return;
    }
    if (pages <= 1) return;
    this.pagerEl.appendChild(h("button", { class: "rw-btn", type: "button", text: "Previous", disabled: s.page <= 1 ? "disabled" : null, onclick: function () { self.load(s.page - 1, false); } }));
    this.pagerEl.appendChild(h("span", { text: "Page " + s.page + " of " + pages }));
    this.pagerEl.appendChild(h("button", { class: "rw-btn", type: "button", text: "Next", disabled: s.page >= pages ? "disabled" : null, onclick: function () { self.load(s.page + 1, false); } }));
  };

  Widget.prototype.renderForm = function () {
    var self = this;
    var rating = 0;
    var starBtns = [];
    var paint = function (n) { starBtns.forEach(function (b, i) { b.className = i < n ? "rw-on" : ""; }); };
    var starsRow = h("div", { class: "rw-input-stars", role: "radiogroup", "aria-label": "Your rating" });
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = h("button", { type: "button", role: "radio", "aria-checked": "false", "aria-label": n + " star" + (n > 1 ? "s" : ""), text: "★" });
      b.addEventListener("mouseenter", function () { paint(n); });
      b.addEventListener("mouseleave", function () { paint(rating); });
      b.addEventListener("focus", function () { paint(n); });
      b.addEventListener("click", function () { rating = n; paint(n); starBtns.forEach(function (x, idx) { x.setAttribute("aria-checked", idx === n - 1 ? "true" : "false"); }); });
      starBtns.push(b);
      starsRow.appendChild(b);
    })(i);

    var name = h("input", { type: "text", maxlength: "80", autocomplete: "name", value: this.state.prefill.authorName || "" });
    var email = h("input", { type: "email", maxlength: "200", autocomplete: "email" });
    var title = h("input", { type: "text", maxlength: "120" });
    var body = h("textarea", { rows: "4", maxlength: "5000" });
    var hp = h("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    var msg = h("div");
    var submit = h("button", { class: "rw-btn rw-primary", type: "submit", text: "Submit review" });

    var form = h("form", { class: "rw-form", novalidate: "novalidate" }, [
      h("h3", { text: "Write a review" }),
      h("label", null, ["Your rating", starsRow]),
      h("label", null, ["Name", name]),
      h("label", null, ["Email (optional, never shown; used to verify your purchase)", email]),
      h("label", null, ["Title", title]),
      h("label", null, ["Review", body]),
      h("div", { class: "rw-hp" }, [h("label", null, ["Website", hp])]),
      msg, submit
    ]);
    var say = function (text, ok) { msg.className = "rw-msg " + (ok ? "rw-ok" : "rw-err"); msg.textContent = text; };

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!rating) return say("Please choose a star rating.", false);
      if (!name.value.trim()) return say("Please enter your name.", false);
      if (body.value.trim().length < 10) return say("Please write at least 10 characters.", false);
      if (email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) return say("Please enter a valid email address.", false);
      submit.disabled = true;
      if (self.preview) { say("Preview only: nothing was submitted.", true); submit.disabled = false; return; }
      fetch(self.api + "/reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: self.key, productId: self.state.productId, productName: self.state.productName, rating: rating,
          authorName: name.value, email: email.value, title: title.value, body: body.value,
          website: hp.value, requestToken: self.state.requestToken
        })
      }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
        .then(function (out) {
          if (!out.ok) { submit.disabled = false; return say(out.body.error || "Something went wrong.", false); }
          say(out.body.message || "Thanks! Your review is awaiting moderation.", true);
          form.reset(); rating = 0; paint(0);
        }).catch(function () { submit.disabled = false; say("Network error. Please try again.", false); });
    });
    this.formEl.innerHTML = "";
    this.formEl.appendChild(form);
  };

  function init() {
    if (!document.getElementById("rw-styles")) {
      var st = document.createElement("style");
      st.id = "rw-styles";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-review-widget]"), function (el) {
      if (el.__rw) return;
      el.__rw = new Widget(el);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
