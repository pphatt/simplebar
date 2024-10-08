import type { DebouncedFunc } from 'lodash-es';
import { debounce, throttle } from 'lodash-es';
import scrollbarWidth from './scrollbar-width';
import * as helpers from './helpers';

interface Options {
  forceVisible: boolean | Axis;
  clickOnTrack: boolean;
  scrollbarMinSize: number;
  scrollbarMaxSize: number;
  classNames: Partial<ClassNames>;
  ariaLabel: string;
  tabIndex: number;
  scrollableNode: HTMLElement | null;
  contentNode: HTMLElement | null;
  autoHide: boolean;
}

export interface SimpleBarOptions extends Partial<Options> {}

type ClassNames = {
  contentEl: string;
  contentWrapper: string;
  offset: string;
  mask: string;
  wrapper: string;
  placeholder: string;
  scrollbar: string;
  track: string;
  heightAutoObserverWrapperEl: string;
  heightAutoObserverEl: string;
  visible: string;
  horizontal: string;
  vertical: string;
  dragging: string;
  scrollable: string;
};

type Axis = 'x' | 'y';
type AxisProps = {
  scrollOffsetAttr: 'scrollLeft' | 'scrollTop';
  sizeAttr: 'width' | 'height';
  scrollSizeAttr: 'scrollWidth' | 'scrollHeight';
  offsetSizeAttr: 'offsetWidth' | 'offsetHeight';
  offsetAttr: 'left' | 'top';
  overflowAttr: 'overflowX' | 'overflowY';
  dragOffset: number;
  isOverflowing: boolean;
  forceVisible: boolean;
  track: {
    size: any;
    el: HTMLElement | null;
    rect: DOMRect | null;
    isVisible: boolean;
  };
  scrollbar: {
    size: any;
    el: HTMLElement | null;
    rect: DOMRect | null;
    isVisible: boolean;
  };
};
type RtlHelpers = {
  // determines if the scrolling is responding with negative values
  isScrollOriginAtZero: boolean;
  // determines if the origin scrollbar position is inverted or not (positioned on left or right)
  isScrollingToNegative: boolean;
} | null;
type DefaultOptions = Options & typeof SimpleBarCore.defaultOptions;

const {
  getElementWindow,
  getElementDocument,
  getOptions,
  addClasses,
  removeClasses,
  classNamesToQuery,
} = helpers;

export default class SimpleBarCore {
  el: HTMLElement;
  options: DefaultOptions;
  classNames: ClassNames;
  axis: {
    x: AxisProps;
    y: AxisProps;
  };
  draggedAxis?: Axis;
  removePreventClickId: null | number = null;
  minScrollbarWidth = 20;
  stopScrollDelay = 1300;
  isScrolling = false;
  isMouseEntering = false;
  isDragging = false;
  scrollXTicking = false;
  scrollYTicking = false;
  wrapperEl: HTMLElement | null = null;
  contentWrapperEl: HTMLElement | null = null;
  contentEl: HTMLElement | null = null;
  offsetEl: HTMLElement | null = null;
  maskEl: HTMLElement | null = null;
  placeholderEl: HTMLElement | null = null;
  heightAutoObserverWrapperEl: HTMLElement | null = null;
  heightAutoObserverEl: HTMLElement | null = null;
  rtlHelpers: RtlHelpers = null;
  scrollbarWidth: number = 0;
  resizeObserver: ResizeObserver | null = null;
  mutationObserver: MutationObserver | null = null;
  elStyles: CSSStyleDeclaration | null = null;
  isRtl: boolean | null = null;
  mouseX: number = 0;
  mouseY: number = 0;
  onMouseMove: DebouncedFunc<any> | (() => void) = () => {};
  onWindowResize: DebouncedFunc<any> | (() => void) = () => {};
  onStopScrolling: DebouncedFunc<any> | (() => void) = () => {};
  onMouseEntered: DebouncedFunc<any> | (() => void) = () => {};

  static rtlHelpers: RtlHelpers = null;

  static defaultOptions: Options = {
    forceVisible: false,
    clickOnTrack: true,
    scrollbarMinSize: 25,
    scrollbarMaxSize: 0,
    ariaLabel: 'scrollable content',
    tabIndex: 0,
    classNames: {
      contentEl: 'simplebar-content',
      contentWrapper: 'simplebar-content-wrapper',
      wrapper: 'simplebar-scroll-content',
      placeholder: 'simplebar-placeholder',
      scrollbar: 'simplebar-scrollbar',
      track: 'simplebar-track',
      heightAutoObserverWrapperEl: 'simplebar-height-auto-observer-wrapper',
      heightAutoObserverEl: 'simplebar-height-auto-observer',
      visible: 'visible',
      horizontal: 'horizontal',
      vertical: 'vertical',
      dragging: 'dragging',
      scrollable: 'scrollable-area--suppress-scroll',
    },
    scrollableNode: null,
    contentNode: null,
    autoHide: true,
  };

  constructor(element: HTMLElement, options: Partial<Options> = {}) {
    this.el = element;
    this.options = { ...SimpleBarCore.defaultOptions, ...options };
    this.classNames = {
      ...SimpleBarCore.defaultOptions.classNames,
      ...options.classNames,
    } as ClassNames;
    this.axis = {
      x: {
        scrollOffsetAttr: 'scrollLeft',
        sizeAttr: 'width',
        scrollSizeAttr: 'scrollWidth',
        offsetSizeAttr: 'offsetWidth',
        offsetAttr: 'left',
        overflowAttr: 'overflowX',
        dragOffset: 0,
        isOverflowing: true,
        forceVisible: false,
        track: { size: null, el: null, rect: null, isVisible: false },
        scrollbar: { size: null, el: null, rect: null, isVisible: false },
      },
      y: {
        scrollOffsetAttr: 'scrollTop',
        sizeAttr: 'height',
        scrollSizeAttr: 'scrollHeight',
        offsetSizeAttr: 'offsetHeight',
        offsetAttr: 'top',
        overflowAttr: 'overflowY',
        dragOffset: 0,
        isOverflowing: true,
        forceVisible: false,
        track: { size: null, el: null, rect: null, isVisible: false },
        scrollbar: { size: null, el: null, rect: null, isVisible: false },
      },
    };

    if (typeof this.el !== 'object' || !this.el.nodeName) {
      throw new Error(
        `Argument passed to SimpleBar must be an HTML element instead of ${this.el}`,
      );
    }

    this.onMouseMove = throttle(this._onMouseMove, 64);
    this.onWindowResize = debounce(this._onWindowResize, 64, { leading: true });
    this.onStopScrolling = debounce(
      this._onStopScrolling,
      this.stopScrollDelay,
    );
    this.onMouseEntered = debounce(this._onMouseEntered, this.stopScrollDelay);

    this.init();
  }

  /**
   * Static functions
   */

  static getOptions = getOptions;
  static helpers = helpers;

  /**
   * Helper to fix browsers inconsistency on RTL:
   *  - Firefox inverts the scrollbar initial position
   *  - IE11 inverts both scrollbar position and scrolling offset
   * Directly inspired by @KingSora's OverlayScrollbars https://github.com/KingSora/OverlayScrollbars/blob/master/js/OverlayScrollbars.js#L1634
   */
  static getRtlHelpers() {
    if (SimpleBarCore.rtlHelpers) {
      return SimpleBarCore.rtlHelpers;
    }

    const dummyDiv = document.createElement('div');
    dummyDiv.innerHTML =
      '<div class="simplebar-dummy-scrollbar-size"><div></div></div>';

    const scrollbarDummyEl = dummyDiv.firstElementChild;
    const dummyChild = scrollbarDummyEl?.firstElementChild;

    if (!dummyChild) return null;

    document.body.appendChild(scrollbarDummyEl);

    scrollbarDummyEl.scrollLeft = 0;

    const dummyContainerOffset = SimpleBarCore.getOffset(scrollbarDummyEl);
    const dummyChildOffset = SimpleBarCore.getOffset(dummyChild);

    scrollbarDummyEl.scrollLeft = -999;
    const dummyChildOffsetAfterScroll = SimpleBarCore.getOffset(dummyChild);

    document.body.removeChild(scrollbarDummyEl);

    SimpleBarCore.rtlHelpers = {
      // determines if the scrolling is responding with negative values
      isScrollOriginAtZero: dummyContainerOffset.left !== dummyChildOffset.left,
      // determines if the origin scrollbar position is inverted or not (positioned on left or right)
      isScrollingToNegative:
        dummyChildOffset.left !== dummyChildOffsetAfterScroll.left,
    };

    return SimpleBarCore.rtlHelpers;
  }

  getScrollbarWidth() {
    // Try/catch for FF 56 throwing on undefined computedStyles
    try {
      // Detect browsers supporting CSS scrollbar styling and do not calculate
      if (
        (this.contentWrapperEl &&
          getComputedStyle(this.contentWrapperEl, '::-webkit-scrollbar')
            .display === 'none') ||
        'scrollbarWidth' in document.documentElement.style ||
        '-ms-overflow-style' in document.documentElement.style
      ) {
        return 0;
      } else {
        return scrollbarWidth();
      }
    } catch (e) {
      return scrollbarWidth();
    }
  }

  static getOffset(el: Element) {
    const rect = el.getBoundingClientRect();
    const elDocument = getElementDocument(el);
    const elWindow = getElementWindow(el);

    return {
      top:
        rect.top +
        (elWindow.pageYOffset || elDocument.documentElement.scrollTop),
      left:
        rect.left +
        (elWindow.pageXOffset || elDocument.documentElement.scrollLeft),
    };
  }

  init() {
    // We stop here on server-side
    if (helpers.canUseDOM) {
      this.initDOM();

      this.rtlHelpers = SimpleBarCore.getRtlHelpers();
      this.scrollbarWidth = this.getScrollbarWidth();

      this.recalculate();

      this.initListeners();
    }
  }

  initDOM() {
    // assume that element has his DOM already initiated
    this.wrapperEl = this.el.querySelector(
      classNamesToQuery(this.classNames.wrapper),
    );
    this.contentWrapperEl =
      this.options.scrollableNode ||
      this.el.querySelector(classNamesToQuery(this.classNames.contentWrapper));
    this.contentEl =
      this.options.contentNode ||
      this.el.querySelector(classNamesToQuery(this.classNames.contentEl));

    this.placeholderEl = this.findChild(
      this.wrapperEl,
      classNamesToQuery(this.classNames.placeholder),
    );

    this.heightAutoObserverWrapperEl = this.el.querySelector(
      classNamesToQuery(this.classNames.heightAutoObserverWrapperEl),
    );
    this.heightAutoObserverEl = this.el.querySelector(
      classNamesToQuery(this.classNames.heightAutoObserverEl),
    );
    this.axis.x.track.el = this.findChild(
      this.el,
      `${classNamesToQuery(this.classNames.track)}${classNamesToQuery(
        this.classNames.horizontal,
      )}`,
    );
    this.axis.y.track.el = this.findChild(
      this.el,
      `${classNamesToQuery(this.classNames.track)}${classNamesToQuery(
        this.classNames.vertical,
      )}`,
    );

    this.axis.x.scrollbar.el =
      this.axis.x.track.el?.querySelector(
        classNamesToQuery(this.classNames.scrollbar),
      ) || null;
    this.axis.y.scrollbar.el =
      this.axis.y.track.el?.querySelector(
        classNamesToQuery(this.classNames.scrollbar),
      ) || null;

    if (!this.options.autoHide) {
      addClasses(this.axis.x.scrollbar.el, this.classNames.visible);
      addClasses(this.axis.y.scrollbar.el, this.classNames.visible);
    }
  }

  initListeners() {
    const elWindow = getElementWindow(this.el);
    // Event listeners

    this.el.addEventListener('mouseenter', this.onMouseEnter);

    this.el.addEventListener('pointerdown', this.onPointerEvent, true);

    this.el.addEventListener('mousemove', this.onMouseMove);
    this.el.addEventListener('mouseleave', this.onMouseLeave);

    this.contentWrapperEl?.addEventListener('scroll', this.onScroll);

    // Browser zoom triggers a window resize
    elWindow.addEventListener('resize', this.onWindowResize);

    if (!this.contentEl) return;

    if (window.ResizeObserver) {
      // Hack for https://github.com/WICG/ResizeObserver/issues/38
      let resizeObserverStarted = false;
      const resizeObserver = elWindow.ResizeObserver || ResizeObserver;
      this.resizeObserver = new resizeObserver(() => {
        if (!resizeObserverStarted) return;

        elWindow.requestAnimationFrame(() => {
          this.recalculate();
        });
      });

      this.resizeObserver.observe(this.el);
      this.resizeObserver.observe(this.contentEl);

      elWindow.requestAnimationFrame(() => {
        resizeObserverStarted = true;
      });
    }

    // This is required to detect horizontal scroll. Vertical scroll only needs the resizeObserver.
    this.mutationObserver = new elWindow.MutationObserver(() => {
      elWindow.requestAnimationFrame(() => {
        this.recalculate();
      });
    });

    this.mutationObserver.observe(this.contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  recalculate() {
    if (
      !this.heightAutoObserverEl ||
      !this.contentEl ||
      !this.contentWrapperEl ||
      !this.wrapperEl
    )
      return;

    const elWindow = getElementWindow(this.el);
    this.elStyles = elWindow.getComputedStyle(this.el);
    this.isRtl = this.elStyles.direction === 'rtl';

    const contentElOffsetWidth = this.contentEl.offsetWidth;

    const isHeightAuto = this.heightAutoObserverEl.offsetHeight <= 1;
    const isWidthAuto =
      this.heightAutoObserverEl.offsetWidth <= 1 || contentElOffsetWidth > 0;

    const contentWrapperElOffsetWidth = this.contentWrapperEl.offsetWidth;

    const elOverflowX = this.elStyles.overflowX;
    const elOverflowY = this.elStyles.overflowY;

    // this.contentEl.style.padding = `${this.elStyles.paddingTop} ${this.elStyles.paddingRight} ${this.elStyles.paddingBottom} ${this.elStyles.paddingLeft}`;
    // this.wrapperEl.style.margin = `-${this.elStyles.paddingTop} -${this.elStyles.paddingRight} -${this.elStyles.paddingBottom} -${this.elStyles.paddingLeft}`;

    const contentElScrollHeight = this.contentEl.scrollHeight;
    const contentElScrollWidth = this.contentEl.scrollWidth;

    this.contentWrapperEl.style.height = isHeightAuto ? 'auto' : '100%';

    // check this for some components need and some don't
    if (this.placeholderEl) {
      this.placeholderEl.style.width = isWidthAuto
        ? `${contentElOffsetWidth || contentElScrollWidth}px`
        : 'auto';
      this.placeholderEl.style.height = `${contentElScrollHeight}px`;
    }

    const contentWrapperElOffsetHeight = this.contentWrapperEl.offsetHeight;

    this.axis.x.isOverflowing =
      contentElOffsetWidth !== 0 && contentElScrollWidth > contentElOffsetWidth;
    this.axis.y.isOverflowing =
      contentElScrollHeight > contentWrapperElOffsetHeight;

    // Set isOverflowing to false if user explicitely set hidden overflow
    this.axis.x.isOverflowing =
      elOverflowX === 'hidden' ? false : this.axis.x.isOverflowing;
    this.axis.y.isOverflowing =
      elOverflowY === 'hidden' ? false : this.axis.y.isOverflowing;

    this.axis.x.forceVisible =
      this.options.forceVisible === 'x' || this.options.forceVisible === true;
    this.axis.y.forceVisible =
      this.options.forceVisible === 'y' || this.options.forceVisible === true;

    // Set isOverflowing to false if scrollbar is not necessary (content is shorter than offset)
    const offsetForXScrollbar = this.axis.x.isOverflowing
      ? this.scrollbarWidth
      : 0;
    const offsetForYScrollbar = this.axis.y.isOverflowing
      ? this.scrollbarWidth
      : 0;

    this.axis.x.isOverflowing =
      this.axis.x.isOverflowing &&
      contentElScrollWidth > contentWrapperElOffsetWidth - offsetForYScrollbar;
    this.axis.y.isOverflowing =
      this.axis.y.isOverflowing &&
      contentElScrollHeight >
        contentWrapperElOffsetHeight - offsetForXScrollbar;

    this.axis.x.scrollbar.size = this.getScrollbarSize('x');
    this.axis.y.scrollbar.size = this.getScrollbarSize('y');

    if (this.axis.x.scrollbar.el)
      this.axis.x.scrollbar.el.style.width = `${this.axis.x.scrollbar.size}px`;
    if (this.axis.y.scrollbar.el)
      this.axis.y.scrollbar.el.style.height = `${this.axis.y.scrollbar.size}px`;

    this.positionScrollbar('x');
    this.positionScrollbar('y');

    this.toggleTrackVisibility('x');
    this.toggleTrackVisibility('y');
  }

  /**
   * Calculate scrollbar size
   */
  getScrollbarSize(axis: Axis = 'y') {
    if (!this.axis[axis].isOverflowing || !this.contentEl) {
      return 0;
    }

    const contentSize = this.contentEl[this.axis[axis].scrollSizeAttr];
    const trackSize =
      this.axis[axis].track.el?.[this.axis[axis].offsetSizeAttr] ?? 0;
    const scrollbarRatio = trackSize / contentSize;

    let scrollbarSize;

    // Calculate new height/position of drag handle.
    scrollbarSize = Math.max(
      ~~(scrollbarRatio * trackSize),
      this.options.scrollbarMinSize,
    );

    if (this.options.scrollbarMaxSize) {
      scrollbarSize = Math.min(scrollbarSize, this.options.scrollbarMaxSize);
    }

    return scrollbarSize;
  }

  positionScrollbar(axis: Axis = 'y') {
    const scrollbar = this.axis[axis].scrollbar;

    if (
      !this.axis[axis].isOverflowing ||
      !this.contentWrapperEl ||
      !scrollbar.el ||
      !this.elStyles
    ) {
      return;
    }

    const contentSize = this.contentWrapperEl[this.axis[axis].scrollSizeAttr];
    const trackSize =
      this.axis[axis].track.el?.[this.axis[axis].offsetSizeAttr] || 0;
    const hostSize = parseInt(this.elStyles[this.axis[axis].sizeAttr], 10);

    let scrollOffset = this.contentWrapperEl[this.axis[axis].scrollOffsetAttr];

    scrollOffset =
      axis === 'x' &&
      this.isRtl &&
      SimpleBarCore.getRtlHelpers()?.isScrollOriginAtZero
        ? -scrollOffset
        : scrollOffset;

    if (axis === 'x' && this.isRtl) {
      scrollOffset = SimpleBarCore.getRtlHelpers()?.isScrollingToNegative
        ? scrollOffset
        : -scrollOffset;
    }

    const scrollPourcent = scrollOffset / (contentSize - hostSize);

    let handleOffset = ~~((trackSize - scrollbar.size) * scrollPourcent);
    handleOffset =
      axis === 'x' && this.isRtl
        ? -handleOffset + (trackSize - scrollbar.size)
        : handleOffset;

    if (axis === 'x') {
      scrollbar.el.style.left = `${handleOffset}px`;
    } else {
      if (handleOffset === 0) {
        scrollbar.el.style.top = `2px`;
      } else {
        scrollbar.el.style.top = `${handleOffset}px`;
      }
    }
  }

  toggleTrackVisibility(axis: Axis = 'y') {
    const track = this.axis[axis].track.el;
    const scrollbar = this.axis[axis].scrollbar.el;

    if (!track || !scrollbar || !this.contentWrapperEl) return;
    if (this.axis[axis].isOverflowing || this.axis[axis].forceVisible) {
      track.style.visibility = 'visible';
      this.contentWrapperEl.style[this.axis[axis].overflowAttr] = 'scroll';
      this.el.classList.add(`${this.classNames.scrollable}-${axis}`);
    } else {
      track.style.visibility = 'hidden';
      this.contentWrapperEl.style[this.axis[axis].overflowAttr] = 'hidden';
      this.el.classList.remove(`${this.classNames.scrollable}-${axis}`);
    }

    // Even if forceVisible is enabled, scrollbar itself should be hidden
    if (this.axis[axis].isOverflowing) {
      scrollbar.style.display = 'block';
    } else {
      scrollbar.style.display = 'none';
    }
  }

  showScrollbar(axis: Axis = 'y') {
    if (this.axis[axis].isOverflowing && !this.axis[axis].scrollbar.isVisible) {
      addClasses(this.axis[axis].scrollbar.el, this.classNames.visible);
      this.axis[axis].scrollbar.isVisible = true;
    }
  }

  hideScrollbar(axis: Axis = 'y') {
    if (this.isDragging) return;
    if (this.axis[axis].isOverflowing && this.axis[axis].scrollbar.isVisible) {
      removeClasses(this.axis[axis].scrollbar.el, this.classNames.visible);
      this.axis[axis].scrollbar.isVisible = false;
    }
  }

  /**
   * On scroll event handling
   */
  onScroll = () => {
    const elWindow = getElementWindow(this.el);

    if (!this.scrollXTicking) {
      elWindow.requestAnimationFrame(this.scrollX);
      this.scrollXTicking = true;
    }

    if (!this.scrollYTicking) {
      elWindow.requestAnimationFrame(this.scrollY);
      this.scrollYTicking = true;
    }

    if (!this.isScrolling) {
      this.isScrolling = true;
    }

    this.showScrollbar('x');
    this.showScrollbar('y');

    this.onStopScrolling();
  };

  scrollX = () => {
    if (this.axis.x.isOverflowing) {
      this.positionScrollbar('x');
    }

    this.scrollXTicking = false;
  };

  scrollY = () => {
    if (this.axis.y.isOverflowing) {
      this.positionScrollbar('y');
    }

    this.scrollYTicking = false;
  };

  _onStopScrolling = () => {
    if (this.options.autoHide) {
      this.hideScrollbar('x');
      this.hideScrollbar('y');
    }

    this.isScrolling = false;
  };

  onMouseEnter = () => {
    if (!this.isMouseEntering) {
      this.showScrollbar('x');
      this.showScrollbar('y');
      this.isMouseEntering = true;
    }

    this.onMouseEntered();
  };

  /*
   * _onMouseEntered would wait a stopScrollDelay of time to resolve the debounce.
   *
   * For instance, despite you "enter" in and "leave" at the same time the _onMouseEntered would not be fired after a stopScrollDelay of time
   * so the this.isMouseEntering cannot be re-assigned which make the onMouseEnter() cannot show the scrollbar("y") which make it UX experience
   * decline.
   *
   * So the fix is adding a "this.isMouseEntering = false" in onMouseLeave
   * */
  _onMouseEntered = () => {
    if (this.options.autoHide) {
      this.hideScrollbar('x');
      this.hideScrollbar('y');
    }

    this.isMouseEntering = false;
  };

  _onMouseMove = (e: any) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;

    if (this.axis.x.isOverflowing || this.axis.x.forceVisible) {
      this.onMouseMoveForAxis('x');
    }

    if (this.axis.y.isOverflowing || this.axis.y.forceVisible) {
      this.onMouseMoveForAxis('y');
    }
  };

  onMouseMoveForAxis(axis: Axis = 'y') {
    const currentAxis = this.axis[axis];
    if (!currentAxis.track.el || !currentAxis.scrollbar.el) return;

    currentAxis.track.rect = currentAxis.track.el.getBoundingClientRect();
    currentAxis.scrollbar.rect =
      currentAxis.scrollbar.el.getBoundingClientRect();
  }

  onMouseLeave = () => {
    (this.onMouseMove as DebouncedFunc<any>).cancel();

    this.mouseX = -1;
    this.mouseY = -1;

    this.isMouseEntering = false;
  };

  _onWindowResize = () => {
    // Recalculate scrollbarWidth in case it's a zoom
    this.scrollbarWidth = this.getScrollbarWidth();
  };

  onPointerEvent = (e: any) => {
    if (
      !this.axis.x.track.el ||
      !this.axis.y.track.el ||
      !this.axis.x.scrollbar.el ||
      !this.axis.y.scrollbar.el
    )
      return;

    let isWithinTrackXBounds, isWithinTrackYBounds;

    this.axis.x.track.rect = this.axis.x.track.el.getBoundingClientRect();
    this.axis.y.track.rect = this.axis.y.track.el.getBoundingClientRect();

    if (this.axis.x.isOverflowing || this.axis.x.forceVisible) {
      isWithinTrackXBounds = this.isWithinBounds(this.axis.x.track.rect);
    }

    if (this.axis.y.isOverflowing || this.axis.y.forceVisible) {
      isWithinTrackYBounds = this.isWithinBounds(this.axis.y.track.rect);
    }

    // If any pointer event is called on the scrollbar
    if (isWithinTrackXBounds || isWithinTrackYBounds) {
      // Prevent event leaking
      e.stopPropagation();

      if (e.type === 'pointerdown' && e.pointerType !== 'touch') {
        if (isWithinTrackXBounds) {
          this.axis.x.scrollbar.rect =
            this.axis.x.scrollbar.el.getBoundingClientRect();

          if (this.isWithinBounds(this.axis.x.scrollbar.rect)) {
            this.onDragStart(e, 'x');
          }
        }

        if (isWithinTrackYBounds) {
          this.axis.y.scrollbar.rect =
            this.axis.y.scrollbar.el.getBoundingClientRect();

          if (this.isWithinBounds(this.axis.y.scrollbar.rect)) {
            this.onDragStart(e, 'y');
          }
        }
      }
    }
  };

  /**
   * on scrollbar handle drag movement starts
   */
  onDragStart(e: any, axis: Axis = 'y') {
    this.isDragging = true;
    const elDocument = getElementDocument(this.el);
    const elWindow = getElementWindow(this.el);
    const scrollbar = this.axis[axis].scrollbar;

    // Measure how far the user's mouse is from the top of the scrollbar drag handle.
    const eventOffset = axis === 'y' ? e.pageY : e.pageX;
    this.axis[axis].dragOffset =
      eventOffset - (scrollbar.rect?.[this.axis[axis].offsetAttr] || 0);
    this.draggedAxis = axis;

    addClasses(this.el, this.classNames.dragging);

    elDocument.addEventListener('mousemove', this.drag, true);
    elDocument.addEventListener('mouseup', this.onEndDrag, true);
    if (this.removePreventClickId === null) {
      elDocument.addEventListener('click', this.preventClick, true);
      elDocument.addEventListener('dblclick', this.preventClick, true);
    } else {
      elWindow.clearTimeout(this.removePreventClickId);
      this.removePreventClickId = null;
    }
  }

  /**
   * Drag scrollbar handle
   */
  drag = (e: any) => {
    if (!this.draggedAxis || !this.contentWrapperEl) return;

    let eventOffset;
    const track = this.axis[this.draggedAxis].track;
    const trackSize = track.rect?.[this.axis[this.draggedAxis].sizeAttr] ?? 0;
    const scrollbar = this.axis[this.draggedAxis].scrollbar;
    const contentSize =
      this.contentWrapperEl?.[this.axis[this.draggedAxis].scrollSizeAttr] ?? 0;
    const hostSize = parseInt(
      this.elStyles?.[this.axis[this.draggedAxis].sizeAttr] ?? '0px',
      10,
    );

    e.preventDefault();
    e.stopPropagation();

    if (this.draggedAxis === 'y') {
      eventOffset = e.pageY;
    } else {
      eventOffset = e.pageX;
    }

    // Calculate how far the user's mouse is from the top/left of the scrollbar (minus the dragOffset).
    let dragPos =
      eventOffset -
      (track.rect?.[this.axis[this.draggedAxis].offsetAttr] ?? 0) -
      this.axis[this.draggedAxis].dragOffset;
    dragPos =
      this.draggedAxis === 'x' && this.isRtl
        ? (track.rect?.[this.axis[this.draggedAxis].sizeAttr] ?? 0) -
          scrollbar.size -
          dragPos
        : dragPos;
    // Convert the mouse position into a percentage of the scrollbar height/width.
    const dragPerc = dragPos / (trackSize - scrollbar.size);

    // Scroll the content by the same percentage.
    let scrollPos = dragPerc * (contentSize - hostSize);

    // Fix browsers inconsistency on RTL
    if (this.draggedAxis === 'x' && this.isRtl) {
      scrollPos = SimpleBarCore.getRtlHelpers()?.isScrollingToNegative
        ? -scrollPos
        : scrollPos;
    }

    this.contentWrapperEl[this.axis[this.draggedAxis].scrollOffsetAttr] =
      scrollPos;
  };

  /**
   * End scroll handle drag
   */
  onEndDrag = (e: any) => {
    this.isDragging = false;
    const elDocument = getElementDocument(this.el);
    const elWindow = getElementWindow(this.el);
    e.preventDefault();
    e.stopPropagation();

    removeClasses(this.el, this.classNames.dragging);
    this.onStopScrolling();

    elDocument.removeEventListener('mousemove', this.drag, true);
    elDocument.removeEventListener('mouseup', this.onEndDrag, true);
    this.removePreventClickId = elWindow.setTimeout(() => {
      // Remove these asynchronously so we still suppress click events
      // generated simultaneously with mouseup.
      elDocument.removeEventListener('click', this.preventClick, true);
      elDocument.removeEventListener('dblclick', this.preventClick, true);
      this.removePreventClickId = null;
    });
  };

  /**
   * Handler to ignore click events during drag
   */
  preventClick = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Getter for content element
   */
  getContentElement() {
    return this.contentEl;
  }

  /**
   * Getter for original scrolling element
   */
  getScrollElement() {
    return this.contentWrapperEl;
  }

  removeListeners() {
    const elWindow = getElementWindow(this.el);
    // Event listeners
    this.el.removeEventListener('mouseenter', this.onMouseEnter);

    this.el.removeEventListener('pointerdown', this.onPointerEvent, true);

    this.el.removeEventListener('mousemove', this.onMouseMove);
    this.el.removeEventListener('mouseleave', this.onMouseLeave);

    if (this.contentWrapperEl) {
      this.contentWrapperEl.removeEventListener('scroll', this.onScroll);
    }

    elWindow.removeEventListener('resize', this.onWindowResize);

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // Cancel all debounced functions
    (this.onMouseMove as DebouncedFunc<any>).cancel();
    (this.onWindowResize as DebouncedFunc<any>).cancel();
    (this.onStopScrolling as DebouncedFunc<any>).cancel();
    (this.onMouseEntered as DebouncedFunc<any>).cancel();
  }

  /**
   * Remove all listeners from DOM nodes
   */
  unMount() {
    this.removeListeners();
  }

  /**
   * Check if mouse is within bounds (inside the track)
   */
  isWithinBounds(bbox: DOMRect) {
    return (
      this.mouseX >= bbox.left &&
      this.mouseX <= bbox.left + bbox.width &&
      this.mouseY >= bbox.top &&
      this.mouseY <= bbox.top + bbox.height
    );
  }

  /**
   * Find element children matches query
   */
  findChild(el: any, query: any) {
    const matches =
      el.matches ||
      el.webkitMatchesSelector ||
      el.mozMatchesSelector ||
      el.msMatchesSelector;
    return Array.prototype.filter.call(el.children, (child) =>
      matches.call(child, query),
    )[0];
  }
}
