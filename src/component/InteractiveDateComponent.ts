import { elementClosest } from '../util/dom-manip'
import { getEvIsTouch, listenBySelector, listenToHoverBySelector } from '../util/dom-event'
import DateComponent from './DateComponent'
import GlobalEmitter from '../common/GlobalEmitter'
import { diffDayAndTime, diffWholeWeeks } from '../datelib/marker'
import { Duration, createDuration } from '../datelib/duration'
import { EventRenderRange } from '../reducers/event-rendering'


export default abstract class InteractiveDateComponent extends DateComponent {

  dateClickingClass: any
  dateSelectingClass: any
  eventPointingClass: any
  eventDraggingClass: any
  eventResizingClass: any
  externalDroppingClass: any

  dateClicking: any
  dateSelecting: any
  eventPointing: any
  eventDragging: any
  eventResizing: any
  externalDropping: any

  // self-config, overridable by subclasses
  segSelector: string = '.fc-event-container > *' // what constitutes an event element?

  // if defined, holds the unit identified (ex: "year" or "month") that determines the level of granularity
  // of the date areas. if not defined, assumes to be day and time granularity.
  // TODO: port isTimeScale into same system?
  largeUnit: any


  constructor(_view?, _options?) {
    super(_view, _options)

    if (this.dateSelectingClass) {
      this.dateClicking = new this.dateClickingClass(this)
    }

    if (this.dateSelectingClass) {
      this.dateSelecting = new this.dateSelectingClass(this)
    }

    if (this.eventPointingClass) {
      this.eventPointing = new this.eventPointingClass(this)
    }

    if (this.eventDraggingClass && this.eventPointing) {
      this.eventDragging = new this.eventDraggingClass(this, this.eventPointing)
    }

    if (this.eventResizingClass && this.eventPointing) {
      this.eventResizing = new this.eventResizingClass(this, this.eventPointing)
    }

    if (this.externalDroppingClass) {
      this.externalDropping = new this.externalDroppingClass(this)
    }
  }


  // Sets the container element that the view should render inside of, does global DOM-related initializations,
  // and renders all the non-date-related content inside.
  setElement(el) {
    super.setElement(el)

    if (this.dateClicking) {
      this.dateClicking.bindToEl(el)
    }

    if (this.dateSelecting) {
      this.dateSelecting.bindToEl(el)
    }

    this.bindAllSegHandlersToEl(el)
  }


  removeElement() {
    this.endInteractions()

    super.removeElement()
  }


  unrenderEvents() {
    this.endInteractions()

    super.unrenderEvents()
  }


  bindDateHandlerToEl(el, name, handler) {
    el.addEventListener(name, (ev) => {
      if (
        !elementClosest(
          ev.target,
          this.segSelector + ':not(.fc-helper),' + // on or within an event segment
          '.fc-more,' + // a "more.." link
          'a[data-goto]' // a clickable nav link
        )
      ) {
        return handler.call(this, ev)
      }
    })
  }


  bindAllSegHandlersToEl(el) {
    [
      this.eventPointing,
      this.eventDragging,
      this.eventResizing
    ].forEach(function(eventInteraction) {
      if (eventInteraction) {
        eventInteraction.bindToEl(el)
      }
    })
  }


  bindSegHandlerToEl(el, name, handler) {
    listenBySelector(
      el,
      name,
      this.segSelector,
      this.makeSegMouseHandler(handler)
    )
  }


  bindSegHoverHandlersToEl(el, onMouseEnter, onMouseLeave) {
    listenToHoverBySelector(
      el,
      this.segSelector,
      this.makeSegMouseHandler(onMouseEnter),
      this.makeSegMouseHandler(onMouseLeave)
    )
  }


  makeSegMouseHandler(handler) {
    return (ev, segEl) => {
      if (!segEl.classList.contains('fc-helper')) {
        let seg = (segEl as any).fcSeg // grab segment data. put there by View::renderEventsPayload
        if (seg && !this.shouldIgnoreEventPointing()) {
          return handler.call(this, seg, ev) // context will be the Grid
        }
      }
    }
  }


  shouldIgnoreMouse() {
    // HACK
    // This will still work even though bindDateHandlerToEl doesn't use GlobalEmitter.
    return GlobalEmitter.get().shouldIgnoreMouse()
  }


  shouldIgnoreTouch() {
    let view = this._getView()

    // On iOS (and Android?) when a new selection is initiated overtop another selection,
    // the touchend never fires because the elements gets removed mid-touch-interaction (my theory).
    // HACK: simply don't allow this to happen.
    // ALSO: prevent selection when an *event* is already raised.
    return view.isSelected || Boolean(view.selectedEventInstance)
  }


  shouldIgnoreEventPointing() {
    // only call the handlers if there is not a drag/resize in progress
    return (this.eventDragging && this.eventDragging.isDragging) ||
      (this.eventResizing && this.eventResizing.isResizing)
  }


  canStartSelection(seg, ev) {
    return getEvIsTouch(ev) &&
      !this.canStartResize(seg, ev) &&
      (this.isEventDefDraggable(seg.footprint.eventDef) ||
        this.isEventDefResizable(seg.footprint.eventDef))
  }


  canStartDrag(seg, ev) {
    return !this.canStartResize(seg, ev) &&
      this.isEventDefDraggable(seg.footprint.eventDef)
  }


  canStartResize(seg, ev) {
    let view = this._getView()
    let eventDef = seg.footprint.eventDef

    return (!getEvIsTouch(ev) || view.isEventDefSelected(eventDef)) &&
      this.isEventDefResizable(eventDef) &&
      ev.target.classList.contains('fc-resizer')
  }


  // Kills all in-progress dragging.
  // Useful for when public API methods that result in re-rendering are invoked during a drag.
  // Also useful for when touch devices misbehave and don't fire their touchend.
  endInteractions() {
    [
      this.dateClicking,
      this.dateSelecting,
      this.eventPointing,
      this.eventDragging,
      this.eventResizing
    ].forEach(function(interaction) {
      if (interaction) {
        interaction.end()
      }
    })
  }


  // Event Drag-n-Drop
  // ---------------------------------------------------------------------------------------------------------------


  // Computes if the given event is allowed to be dragged by the user
  isEventDefDraggable(eventDef) {
    return this.isEventDefStartEditable(eventDef)
  }


  isEventDefStartEditable(eventDef) {
    let isEditable = eventDef.isStartExplicitlyEditable()

    if (isEditable == null) {
      isEditable = this.opt('eventStartEditable')

      if (isEditable == null) {
        isEditable = this.isEventDefGenerallyEditable(eventDef)
      }
    }

    return isEditable
  }


  isEventDefGenerallyEditable(eventDef) {
    let isEditable = eventDef.isExplicitlyEditable()

    if (isEditable == null) {
      isEditable = this.opt('editable')
    }

    return isEditable
  }


  // EXTERNAL Drag-n-Drop
  // ---------------------------------------------------------------------------------------------------------------


  handlExternalDragStart(ev, el, skipBinding) {
    if (this.externalDropping) {
      this.externalDropping.handleDragStart(ev, el, skipBinding)
    }

    super.handlExternalDragStart(ev, el, skipBinding)
  }


  handleExternalDragMove(ev) {
    if (this.externalDropping) {
      this.externalDropping.handleDragMove(ev)
    }

    super.handleExternalDragMove(ev)
  }


  handleExternalDragStop(ev) {
    if (this.externalDropping) {
      this.externalDropping.handleDragStop(ev)
    }

    super.handleExternalDragStop(ev)
  }


  // Event Resizing
  // ---------------------------------------------------------------------------------------------------------------


  // Computes if the given event is allowed to be resized from its starting edge
  isEventDefResizableFromStart(eventDef) {
    return this.opt('eventResizableFromStart') && this.isEventDefResizable(eventDef)
  }


  // Computes if the given event is allowed to be resized from its ending edge
  isEventDefResizableFromEnd(eventDef) {
    return this.isEventDefResizable(eventDef)
  }


  // Computes if the given event is allowed to be resized by the user at all
  isEventDefResizable(eventDef) {
    let isResizable = eventDef.isDurationExplicitlyEditable()

    if (isResizable == null) {
      isResizable = this.opt('eventDurationEditable')

      if (isResizable == null) {
        isResizable = this.isEventDefGenerallyEditable(eventDef)
      }
    }
    return isResizable
  }


  // Event Mutation / Constraints
  // ---------------------------------------------------------------------------------------------------------------


  // Diffs the two dates, returning a duration, based on granularity of the grid
  // TODO: port isTimeScale into this system?
  diffDates(a, b): Duration {
    const dateEnv = this._getCalendar().dateEnv

    if (!this.largeUnit) {
      return diffDayAndTime(a, b) // returns a duration
    } else if (this.largeUnit === 'week') {
      return createDuration(diffWholeWeeks(a, b), 'week')
    } else if (this.largeUnit === 'month') {
      return createDuration(dateEnv.diffWholeMonths(a, b), 'month')
    } else if (this.largeUnit === 'year') {
      return createDuration(dateEnv.diffWholeYears(a, b), 'year')
    }
  }


  // is it allowed, in relation to the view's validRange?
  isEventRangesAllowed(eventRanges: EventRenderRange[]) {
    let view = this._getView()
    let dateProfile = this.dateProfile

    for (let eventRange of eventRanges) {
      if (!dateProfile.validUnzonedRange.containsRange(eventRange.range)) {
        return false
      }
    }

    return view.calendar.constraints.isEventRangesAllowed(eventRanges)
  }


  // NOTE: very similar to isEventRangesAllowed
  // when it's a completely anonymous external drag, no event.
  isExternalRangesAllowed(eventRanges: EventRenderRange[]) {
    let dateProfile = this.dateProfile

    for (let eventRange of eventRanges) {
      if (!dateProfile.validUnzonedRange.containsRange(eventRange.range)) {
        return false
      }
    }

    // let view = this._getView()
    //
    // for (let eventRange of eventRanges) {
    //   // treat it as a selection
    //   // TODO: pass in eventRanges instead
    //   //  because we don't want calendar's constraint system to depend on a component's
    //   //  determination of footprints.
    //   if (!view.calendar.constraints.isSelectionFootprintAllowed(WHAT)) {
    //     return false
    //   }
    // }

    return true
  }


  // TODO: constraint API

  isSelectionAllowed(selection) {
    return false
  }

  isRangeAllowed(range, overlap, constraint, eventDef, selection) {
    return false
  }

}
