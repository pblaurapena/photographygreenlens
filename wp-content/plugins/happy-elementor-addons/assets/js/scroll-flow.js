"use strict";

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
(function ($, w) {
  "use strict";

  $(w).on("elementor/frontend/init", function () {
    if (typeof gsap === "undefined" || typeof Observer === "undefined") {
      return;
    }
    gsap.registerPlugin(Observer);
    var MIN_PANELS = 2;
    var REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

    // Every live Scroll Flow on the page. Used to hand a gesture to the flow
    // that currently owns the viewport instead of whichever wrapper the
    // pointer happens to be over.
    var flows = [];

    /*
     * The section takes over the wheel as soon as a gesture starts over it.
     * If it is not aligned with the viewport yet, the page is scrolled into
     * place first so every transition runs full-screen, exactly like the
     * reference demo (which relies on `position: fixed` sections).
     */
    var ALIGN_EPS = 2;
    function toNumber(value, fallback) {
      var number = parseFloat(value);
      return isNaN(number) ? fallback : number;
    }
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
    function toBool(value, fallback) {
      if (value === "yes" || value === true || value === 1 || value === "1") {
        return true;
      }
      if (value === "no" || value === false || value === 0 || value === "0" || value === "") {
        return false;
      }
      return fallback;
    }

    /*
     * Themes often set `scroll-behavior: smooth`, which would turn the
     * internal realignment/release into an animation. Force an instant jump.
     */
    function scrollInstantly(top) {
      var root = document.documentElement;
      var previous = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      w.scrollTo(0, top);
      root.style.scrollBehavior = previous;
    }
    function scrollByInstantly(delta) {
      var root = document.documentElement;
      var previous = root.style.scrollBehavior;
      var current = w.pageYOffset || root.scrollTop || 0;
      root.style.scrollBehavior = "auto";
      w.scrollTo(0, current + delta);
      root.style.scrollBehavior = previous;
    }
    var HappyScrollFlow = elementorModules.frontend.handlers.Base.extend({
      currentIndex: -1,
      animating: false,
      observer: null,
      timeline: null,
      panels: [],
      hostEl: null,
      config: null,
      lastDevice: null,
      resizeTimer: null,
      animTimer: null,
      captureTimer: null,
      released: false,
      stageTop: 0,
      onInit: function onInit() {
        elementorModules.frontend.handlers.Base.prototype.onInit.apply(this, arguments);
        this.build();
      },
      bindEvents: function bindEvents() {
        var _this = this;
        elementorModules.frontend.handlers.Base.prototype.bindEvents.apply(this, arguments);
        this.lastDevice = this.getDeviceMode();
        this.eventNamespace = ".haSf" + (this.$element.attr("data-id") || Math.random().toString(36).slice(2, 8));
        var ns = this.eventNamespace;
        $(w).on("resize" + ns + " orientationchange" + ns, function () {
          clearTimeout(_this.resizeTimer);
          _this.resizeTimer = setTimeout(function () {
            var device = _this.getDeviceMode();
            if (device !== _this.lastDevice) {
              _this.lastDevice = device;
              _this.build();
              return;
            }
            _this.updateStageMetrics();
          }, 250);
        });

        // Only used to re-arm the observer after a boundary release.
        $(w).on("scroll" + ns, function () {
          return _this.onScroll();
        });
      },
      onElementChange: function onElementChange() {
        this.build();
      },
      onDestroy: function onDestroy() {
        clearTimeout(this.resizeTimer);
        clearTimeout(this.animTimer);
        clearTimeout(this.captureTimer);
        $(w).off(this.eventNamespace || ".haSf");
        this.destroy();
        elementorModules.frontend.handlers.Base.prototype.onDestroy.apply(this, arguments);
      },
      /**
       * Resolve a (possibly responsive) setting for the current device.
       */
      getResponsiveSetting: function getResponsiveSetting(settings, key) {
        var device = this.getDeviceMode();
        if ("desktop" !== device) {
          var deviceKey = key + "_" + device;
          if (settings[deviceKey] !== undefined && settings[deviceKey] !== "") {
            return settings[deviceKey];
          }
        }
        return settings[key];
      },
      getDeviceMode: function getDeviceMode() {
        if (typeof elementorFrontend !== "undefined" && typeof elementorFrontend.getCurrentDeviceMode === "function") {
          return elementorFrontend.getCurrentDeviceMode();
        }
        return "desktop";
      },
      isEditMode: function isEditMode() {
        return typeof elementorFrontend !== "undefined" && elementorFrontend.isEditMode();
      },
      isDisabledOnMobile: function isDisabledOnMobile() {
        var settings = this.getElementSettings() || {};
        if ("yes" === settings.ha_sf_enable_on_mobile) {
          return false;
        }
        var device = this.getDeviceMode();
        return device === "mobile" || device === "mobile_extra";
      },
      prefersReducedMotion: function prefersReducedMotion() {
        return !!(w.matchMedia && w.matchMedia(REDUCED_MOTION).matches);
      },
      /**
       * The element that directly holds the panels. Boxed Elementor
       * containers wrap their children in `.e-con-inner` and legacy
       * sections in `.elementor-container`, so resolve that first.
       */
      getHost: function getHost() {
        var $boxed = this.$element.children(".e-con-inner");
        if ($boxed.length) {
          return $boxed.first();
        }
        var $container = this.$element.children(".elementor-container");
        if ($container.length) {
          return $container.first();
        }
        return this.$element;
      },
      /**
       * Sanitized settings payload rendered by PHP, used as a fallback.
       */
      getServerSettings: function getServerSettings() {
        var raw = this.$element.attr("data-ha-sf-data");
        if (!raw) {
          return {};
        }
        try {
          var parsed = JSON.parse(raw);
          return parsed && "object" === _typeof(parsed) ? parsed : {};
        } catch (error) {
          return {};
        }
      },
      getConfig: function getConfig(settings) {
        var server = this.getServerSettings();
        var mode = String(this.getResponsiveSetting(settings, "ha_sf_mode") || server.mode || "slide");
        var ease = String(this.getResponsiveSetting(settings, "ha_sf_easing_function") || server.ease || "power1.inOut");
        return {
          mode: mode,
          ease: ease,
          duration: clamp(toNumber(this.getResponsiveSetting(settings, "ha_sf_duration"), toNumber(server.duration, 1.25)), 0.1, 5),
          bgMove: clamp(toNumber(this.getResponsiveSetting(settings, "ha_sf_bg_move"), toNumber(server.bgMove, 15)), 0, 60),
          wheelSpeed: clamp(toNumber(this.getResponsiveSetting(settings, "ha_sf_wheel_speed"), toNumber(server.wheelSpeed, -1)), -3, 3),
          tolerance: clamp(toNumber(this.getResponsiveSetting(settings, "ha_sf_tolerance"), toNumber(server.tolerance, 10)), 0, 50),
          triggerPoint: clamp(toNumber(this.getResponsiveSetting(settings, "ha_sf_trigger_point"), toNumber(server.triggerPoint, 0)), -1000, 2000),
          loop: toBool(this.getResponsiveSetting(settings, "ha_sf_loop"), toBool(server.loop, true))
        };
      },
      build: function build() {
        var _this2 = this;
        var settings = this.getElementSettings() || {};
        if ("yes" !== settings.ha_sf_switcher || this.isEditMode() || this.isDisabledOnMobile() || this.prefersReducedMotion()) {
          this.destroy();
          return;
        }
        var $host = this.getHost();
        var panels = $host.length ? Array.prototype.slice.call($host[0].children) : [];
        if (panels.length < MIN_PANELS) {
          this.destroy();
          return;
        }
        this.destroy();
        this.config = this.getConfig(settings);
        this.panels = panels;
        this.hostEl = $host[0];
        this.currentIndex = -1;
        this.animating = false;
        this.released = false;
        this.lastScrollTop = null;
        this.$element.addClass("ha-sf-active");
        this.hostEl.classList.add("ha-sf-host");
        this.panels.forEach(function (panel) {
          return panel.classList.add("ha-sf-panel");
        });
        gsap.set(this.panels, {
          autoAlpha: 0,
          zIndex: 0
        });
        this.updateStageMetrics();
        this.createObserver();
        this.gotoSection(0, 1);
        if (flows.indexOf(this) === -1) {
          flows.push(this);
        }

        /*
         * Happy Addons keeps its animation timelines paused until their
         * own ScrollTrigger fires. Capture them while they are still in
         * GSAP's cache so they can be replayed later, even after they
         * have finished once.
         */
        clearTimeout(this.captureTimer);
        this.captureTimer = setTimeout(function () {
          return _this2.capturePanelAnimations();
        }, 600);
      },
      destroy: function destroy() {
        var _this3 = this;
        this.killObserver();
        clearTimeout(this.captureTimer);
        var registered = flows.indexOf(this);
        if (registered !== -1) {
          flows.splice(registered, 1);
        }
        if (this.timeline) {
          this.timeline.kill();
          this.timeline = null;
        }
        var panels = this.panels || [];
        if (panels.length) {
          gsap.set(panels, {
            clearProps: "transform,opacity,visibility,zIndex,backgroundPositionY,clipPath,webkitClipPath"
          });
          panels.forEach(function (panel) {
            var content = _this3.getPanelContent(panel);
            if (content) {
              gsap.set(content, {
                clearProps: "transform"
              });
            }
          });
        }
        panels.forEach(function (panel) {
          if (panel && panel.classList) {
            panel.classList.remove("ha-sf-panel");
          }
        });
        if (this.hostEl && this.hostEl.classList) {
          this.hostEl.classList.remove("ha-sf-host");
        }
        this.$element.removeClass("ha-sf-active");
        this.panels = [];
        this.hostEl = null;
        this.config = null;
        this.currentIndex = -1;
        this.animating = false;
        this.released = false;
        this.lastScrollTop = null;
      },
      createObserver: function createObserver() {
        var _this4 = this;
        this.killObserver();
        var config = this.config;
        this.observer = Observer.create({
          target: this.$element[0],
          type: "wheel,touch",
          wheelSpeed: config.wheelSpeed,
          tolerance: config.tolerance,
          preventDefault: true,
          onDown: function onDown(self) {
            return _this4.onGesture(self, false);
          },
          onUp: function onUp(self) {
            return _this4.onGesture(self, true);
          }
        });
      },
      killObserver: function killObserver() {
        if (this.observer) {
          this.observer.kill();
          this.observer = null;
        }
      },
      onGesture: function onGesture(self, forward) {
        if (!this.config || !this.panels.length) {
          return;
        }
        var engaged = this.getEngagedFlow();
        if (engaged && engaged !== this) {
          var mine = this.$element[0];
          var theirs = engaged.$element[0];

          /*
           * Nested flows receive the same bubbled gesture; the flow that
           * already owns it must not process it twice.
           */
          if (mine && theirs && (mine.contains(theirs) || theirs.contains(mine))) {
            return;
          }

          /*
           * Only a sliver of this flow is under the pointer while another
           * flow owns the viewport. Hand the gesture over instead of
           * aligning/transitioning the wrong flow.
           */
          engaged.handleGesture(self, forward, true);
          return;
        }
        this.handleGesture(self, forward, false);
      },
      handleGesture: function handleGesture(self, forward, delegated) {
        if (!this.config || !this.panels.length || this.animating) {
          return;
        }
        if (!delegated && this.shouldIgnore(self)) {
          return;
        }
        var step = forward ? 1 : -1;

        /*
         * At a boundary (Loop off) the flow already handed the page
         * over; keep feeding it the gesture instead of re-aligning and
         * snapping back to the section.
         */
        if (this.released) {
          this.release(step > 0 ? this.panels.length : -1, self);
          return;
        }

        /*
         * Make sure the section fills the viewport before transitioning
         * so the animation matches the demo. The gesture that aligns the
         * page is consumed; the next one transitions.
         */
        if (!this.isAligned()) {
          this.align();
          return;
        }
        var next = this.currentIndex + step;
        if (this.canGo(next)) {
          this.gotoSection(next, step);
        } else {
          this.release(next, self);
        }
      },
      /**
       * The flow that currently owns the viewport (its box straddles the
       * vertical center). With several Scroll Flows on a page this is the
       * one a gesture should drive.
       */
      getEngagedFlow: function getEngagedFlow() {
        var viewportHeight = w.innerHeight || document.documentElement.clientHeight || 0;
        var center = viewportHeight / 2;
        var engaged = null;
        var closest = Infinity;
        flows.forEach(function (flow) {
          var element = flow.$element && flow.$element[0];
          if (!element || !flow.config || !flow.panels.length) {
            return;
          }
          var rect = element.getBoundingClientRect();
          if (rect.top > center || rect.bottom < center) {
            return;
          }
          var distance = Math.abs((rect.top + rect.bottom) / 2 - center);
          if (distance < closest) {
            closest = distance;
            engaged = flow;
          }
        });
        return engaged;
      },
      /**
       * Ignore gestures that originate from a nested Scroll Flow wrapper
       * so only the innermost instance reacts.
       */
      shouldIgnore: function shouldIgnore(self) {
        var event = self && self.event;
        var target = event && event.target;
        if (!target || !target.closest) {
          return false;
        }
        var owner = target.closest("[data-ha-sf]");
        return owner !== null && owner !== this.$element[0];
      },
      canGo: function canGo(index) {
        if (!this.panels.length) {
          return false;
        }
        if (this.config.loop) {
          return true;
        }
        return index >= 0 && index < this.panels.length;
      },
      getScrollTop: function getScrollTop() {
        return w.pageYOffset || document.documentElement.scrollTop || 0;
      },
      updateStageMetrics: function updateStageMetrics() {
        var element = this.$element[0];
        if (!element) {
          return;
        }
        var rect = element.getBoundingClientRect();
        this.stageTop = rect.top + this.getScrollTop();
      },
      /**
       * The document position at which the stage fills the viewport. A
       * stage near the bottom of a short page may not be able to reach the
       * viewport top, so the furthest reachable position is used instead.
       *
       * The optional trigger point shifts that position: a value of 100
       * engages the flow while the section top is still 100px below the
       * viewport top.
       */
      alignTarget: function alignTarget() {
        var doc = document.documentElement;
        var body = document.body;
        var height = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
        var maxScroll = Math.max(0, height - (w.innerHeight || doc.clientHeight || 0));
        var offset = this.config ? this.config.triggerPoint : 0;
        return clamp(Math.min(this.stageTop - offset, maxScroll), 0, maxScroll);
      },
      isAligned: function isAligned() {
        this.updateStageMetrics();
        return Math.abs(this.getScrollTop() - this.alignTarget()) <= ALIGN_EPS;
      },
      align: function align() {
        scrollInstantly(this.alignTarget());
      },
      /**
       * True when there is page content left to scroll to in that direction.
       */
      hasScrollRoom: function hasScrollRoom(down) {
        var doc = document.documentElement;
        var body = document.body;
        var height = Math.max(doc ? doc.scrollHeight : 0, body ? body.scrollHeight : 0);
        var maxScroll = Math.max(0, height - (w.innerHeight || doc.clientHeight || 0));
        var target = this.alignTarget();
        if (down) {
          return target < maxScroll - ALIGN_EPS;
        }
        return target > ALIGN_EPS;
      },
      /**
       * Hand the gesture back to the page so the remaining content can be
       * reached once the first/last panel is reached with loop disabled.
       */
      release: function release(nextIndex, self) {
        var down = nextIndex >= this.panels.length;
        if (!this.hasScrollRoom(down)) {
          return;
        }
        var event = self && self.event;
        var delta = (down ? 1 : -1) * 120;
        if (event && "number" === typeof event.deltaY && 0 !== event.deltaY) {
          delta = event.deltaY;
        }
        this.released = true;
        if (this.observer) {
          this.observer.disable();
        }
        scrollByInstantly(delta);
      },
      /**
       * Re-arm the observer once the page is scrolled back onto the stage.
       */
      onScroll: function onScroll() {
        if (!this.config || !this.panels.length) {
          return;
        }
        var scrollTop = this.getScrollTop();
        var previous = "number" === typeof this.lastScrollTop ? this.lastScrollTop : scrollTop;
        this.lastScrollTop = scrollTop;
        if (!this.released) {
          return;
        }
        var target = this.alignTarget();
        var crossed = previous < target && scrollTop >= target || previous > target && scrollTop <= target;
        if (!crossed && Math.abs(scrollTop - target) > ALIGN_EPS) {
          return;
        }
        this.released = false;
        if (this.observer) {
          this.observer.enable();
        }
      },
      normalizeIndex: function normalizeIndex(index) {
        var total = this.panels.length;
        if (this.config.loop) {
          return gsap.utils.wrap(0, total)(index);
        }
        return clamp(index, 0, total - 1);
      },
      hasBackgroundImage: function hasBackgroundImage(panel) {
        var background = w.getComputedStyle(panel).backgroundImage || "";
        return background.indexOf("url(") !== -1;
      },
      /**
       * The layer that holds a panel's content. Boxed Elementor
       * containers use `.e-con-inner` and legacy sections
       * `.elementor-container`; full-width containers keep their
       * children at the top level, so those direct children are used
       * instead. The layer is only used for the small parallax drift.
       */
      getPanelContent: function getPanelContent(panel) {
        if (!panel) {
          return null;
        }
        var $inner = $(panel).children(".e-con-inner, .elementor-container").first();
        if ($inner.length) {
          return $inner[0];
        }
        var children = panel.children;
        if (!children || !children.length) {
          return null;
        }
        return Array.prototype.slice.call(children);
      },
      gotoSection: function gotoSection(rawIndex, direction) {
        var _this5 = this;
        if (this.animating || !this.panels.length) {
          return;
        }
        var config = this.config;
        var total = this.panels.length;
        if (!config.loop && (rawIndex < 0 || rawIndex >= total)) {
          return;
        }
        var index = this.normalizeIndex(rawIndex);
        if (index === this.currentIndex) {
          return;
        }
        var panels = this.panels;
        var fromTop = -1 === direction;
        var distanceFactor = fromTop ? -1 : 1;
        this.animating = true;
        if (this.timeline) {
          this.timeline.kill();
        }
        var timeline = gsap.timeline({
          defaults: {
            duration: config.duration,
            ease: config.ease
          },
          onComplete: function onComplete() {
            _this5.animating = false;
          }
        });
        if (this.currentIndex >= 0 && panels[this.currentIndex]) {
          var previous = panels[this.currentIndex];
          var previousContent = this.getPanelContent(previous);
          var previousParallax = (previous.offsetHeight || w.innerHeight || 0) * (config.bgMove / 100);
          gsap.set(previous, {
            zIndex: 0
          });

          /*
           * Match the demo: the outgoing layer drifts in the
           * opposite direction while the panel fades out.
           */
          if ("slide" === config.mode && config.bgMove) {
            if (this.hasBackgroundImage(previous)) {
              timeline.to(previous, {
                backgroundPositionY: 50 - config.bgMove * distanceFactor + "%"
              }, 0);
            }
            if (previousContent && previousParallax) {
              timeline.to(previousContent, {
                y: -previousParallax * distanceFactor
              }, 0);
            }
          }
          timeline.set(previous, {
            autoAlpha: 0
          }, config.duration);
        }
        gsap.set(panels[index], {
          autoAlpha: 1,
          zIndex: 1
        });
        if ("fade" === config.mode) {
          timeline.fromTo(panels[index], {
            yPercent: 0,
            autoAlpha: 0
          }, {
            yPercent: 0,
            autoAlpha: 1
          }, 0);
          if (config.bgMove && this.hasBackgroundImage(panels[index])) {
            timeline.fromTo(panels[index], {
              backgroundPositionY: 50 + config.bgMove * distanceFactor + "%"
            }, {
              backgroundPositionY: "50%"
            }, 0);
          }
        } else if ("zoom" === config.mode) {
          timeline.fromTo(panels[index], {
            scale: 1.15,
            yPercent: 0
          }, {
            scale: 1,
            yPercent: 0
          }, 0);
        } else {
          var panel = panels[index];
          var content = this.getPanelContent(panel);
          var panelHeight = panel.offsetHeight || w.innerHeight || 0;
          var parallax = panelHeight * (config.bgMove / 100);

          /*
           * Match the reference demo: the panel itself never
           * translates. Its box is revealed by a moving clip edge
           * (the demo's `.outer` wrapper) while the content layer
           * stays pinned and drifts with a small parallax (the
           * demo's `.inner` wrapper and `.bg` layer), so the
           * section is uncovered rather than dragged in as a block.
           */
          var hiddenClip = distanceFactor > 0 ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 100% 0%)";
          var shownClip = "inset(0% 0% 0% 0%)";
          timeline.fromTo(panel, {
            clipPath: hiddenClip,
            webkitClipPath: hiddenClip
          }, {
            clipPath: shownClip,
            webkitClipPath: shownClip
          }, 0);
          if (content && parallax) {
            timeline.fromTo(content, {
              y: parallax * distanceFactor
            }, {
              y: 0
            }, 0);
          }
          if (config.bgMove && this.hasBackgroundImage(panel)) {
            timeline.fromTo(panel, {
              backgroundPositionY: 50 + config.bgMove * distanceFactor + "%"
            }, {
              backgroundPositionY: "50%"
            }, 0);
          }
        }
        this.timeline = timeline;
        this.currentIndex = index;
        this.queuePanelAnimation(index);
      },
      /**
       * Replay the entrance animations of the panel that just became
       * active. Scroll based animations (Elementor entrance effects and
       * Happy Addons Appearing Image / Heading Text) never receive a real
       * scroll inside the section, so they would otherwise stay in their
       * initial (hidden) state.
       */
      queuePanelAnimation: function queuePanelAnimation(index) {
        var _this6 = this;
        var panel = this.panels[index];
        if (!panel) {
          return;
        }
        clearTimeout(this.animTimer);
        var delay = this.animationBootstrapped ? 60 : 350;
        this.animationBootstrapped = true;
        this.animTimer = setTimeout(function () {
          if (!_this6.panels.length || _this6.panels[index] !== panel) {
            return;
          }
          _this6.animatePanel(panel);
        }, delay);
      },
      animatePanel: function animatePanel(panel) {
        if (!panel) {
          return;
        }
        this.replayElementorAnimations(panel);
        this.replayHappyAnimations(panel);
      },
      readSettings: function readSettings(element) {
        var raw = element && element.getAttribute ? element.getAttribute("data-settings") : "";
        if (!raw) {
          return {};
        }
        try {
          var parsed = JSON.parse(raw);
          return parsed && "object" === _typeof(parsed) ? parsed : {};
        } catch (error) {
          return {};
        }
      },
      resolveResponsive: function resolveResponsive(settings, key) {
        var device = this.getDeviceMode();
        if ("desktop" !== device) {
          var deviceValue = settings[key + "_" + device];
          if (deviceValue !== undefined && deviceValue !== "") {
            return deviceValue;
          }
        }
        var value = settings[key];
        if (value && "object" === _typeof(value)) {
          return value[device] !== undefined ? value[device] : value.desktop;
        }
        return value;
      },
      replayElementorAnimations: function replayElementorAnimations(panel) {
        var _this7 = this;
        var nodes = panel.querySelectorAll(".elementor-invisible, .animated");
        Array.prototype.forEach.call(nodes, function (element) {
          var settings = _this7.readSettings(element);
          var animation = settings._animation || settings.animation || "";
          if (animation && "object" === _typeof(animation)) {
            animation = _this7.resolveResponsive({
              _animation: animation
            }, "_animation") || "";
          }
          if (!animation || "none" === animation) {
            element.classList.remove("elementor-invisible");
            return;
          }
          var animationDelay = settings._animation_delay || settings.animation_delay || 0;
          if (animationDelay && "object" === _typeof(animationDelay)) {
            animationDelay = _this7.resolveResponsive({
              _animation_delay: animationDelay
            }, "_animation_delay") || 0;
          }
          animationDelay = toNumber(animationDelay, 0);
          clearTimeout(element.__haSfAnimTimer);
          element.classList.remove("animated");
          element.classList.remove(animation);
          element.classList.add("elementor-invisible");

          // Force a reflow so the animation can restart.
          void element.offsetWidth;
          element.__haSfAnimTimer = setTimeout(function () {
            element.classList.remove("elementor-invisible");
            element.classList.add("animated", animation);
          }, animationDelay);
        });
      },
      replayHappyAnimations: function replayHappyAnimations(panel) {
        var _this8 = this;
        if (typeof gsap === "undefined") {
          return;
        }
        var nodes = panel.querySelectorAll('[data-settings*="ha_hta_switcher"], [data-settings*="ha_aia_switcher"]');
        Array.prototype.forEach.call(nodes, function (element) {
          var settings = _this8.readSettings(element);
          var isHeading = "yes" === settings.ha_hta_switcher;
          var isImage = "yes" === settings.ha_aia_switcher;
          if (!isHeading && !isImage) {
            return;
          }
          if (isHeading) {
            var triggerMode = _this8.resolveResponsive(settings, "ha_hta_trigger_mode");

            // Hover is mouse driven and scrubbed triggers follow the
            // page scroll, so neither should be replayed here.
            if ("hover" === triggerMode || "playwithscroll" === triggerMode) {
              return;
            }
          }
          var timelines = _this8.collectTimelines(element);
          if (timelines.length) {
            element.__haSfTimelines = timelines;
          } else if (element.__haSfTimelines && element.__haSfTimelines.length) {
            timelines = element.__haSfTimelines;
          }
          timelines.forEach(function (timeline) {
            if (!timeline || "function" !== typeof timeline.restart) {
              return;
            }
            try {
              timeline.restart(true);
            } catch (error) {
              // Timeline was rebuilt/killed elsewhere; ignore.
            }
          });
        });
      },
      /**
       * Capture the animations of every panel early, before Happy Addons'
       * timelines have a chance to finish and leave GSAP's cache.
       */
      capturePanelAnimations: function capturePanelAnimations() {
        var _this9 = this;
        if (!this.panels.length) {
          return;
        }
        this.panels.forEach(function (panel) {
          var nodes = panel.querySelectorAll('[data-settings*="ha_hta_switcher"], [data-settings*="ha_aia_switcher"]');
          Array.prototype.forEach.call(nodes, function (element) {
            var timelines = _this9.collectTimelines(element);
            if (timelines.length) {
              element.__haSfTimelines = timelines;
            }
          });
        });
      },
      /**
       * Collect GSAP timelines belonging to an element: ScrollTrigger
       * animations (Appearing Image / Heading Text "on scroll") plus paused
       * timelines found through the element's tweens (Heading Text, which
       * attaches its timeline to a bare ScrollTrigger).
       */
      collectTimelines: function collectTimelines(element) {
        var timelines = [];
        if (typeof ScrollTrigger !== "undefined" && ScrollTrigger.getAll) {
          ScrollTrigger.getAll().forEach(function (trigger) {
            var target = trigger.trigger;
            if (!target) {
              return;
            }
            if (!(target === element || element.contains(target) || target.contains(element))) {
              return;
            }
            if (trigger.vars && (trigger.vars.scrub || trigger.scrub)) {
              return;
            }
            if (trigger.animation && timelines.indexOf(trigger.animation) === -1) {
              timelines.push(trigger.animation);
            }
          });
        }
        if (gsap.getTweensOf) {
          var targets = [element];
          var descendants = element.querySelectorAll("*");
          for (var i = 0; i < descendants.length; i++) {
            targets.push(descendants[i]);
          }
          targets.forEach(function (target) {
            var tweens = [];
            try {
              tweens = gsap.getTweensOf(target) || [];
            } catch (error) {
              tweens = [];
            }
            tweens.forEach(function (tween) {
              var parent = tween.parent;
              if (parent && parent !== gsap.globalTimeline && timelines.indexOf(parent) === -1) {
                timelines.push(parent);
              }
            });
          });
        }
        return timelines;
      }
    });
    elementorFrontend.hooks.addAction("frontend/element_ready/container", function ($scope) {
      elementorFrontend.elementsHandler.addHandler(HappyScrollFlow, {
        $element: $scope
      });
    });
    elementorFrontend.hooks.addAction("frontend/element_ready/section", function ($scope) {
      elementorFrontend.elementsHandler.addHandler(HappyScrollFlow, {
        $element: $scope
      });
    });
  });
})(jQuery, window);