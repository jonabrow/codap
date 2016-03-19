// ==========================================================================
//                              DG.Drag
//
//  Author:   William Finzer
//
//  Copyright (c) 2014 by The Concord Consortium, Inc. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// ==========================================================================

/*
 * We override SC.Drag for the single purpose of dealing with overlapping drop targets
 * in the graph. Different browsers seem to produce different results with the SC.Drag
 * implementation. Namely, for one browser, the AxisMultiTarget will allow a drop while
 * for another browser it won't.
 */

/** @class  Override the private method _findDropTarget

*/
DG.Drag = SC.Drag.extend({

  /** @private
   This will actually start the drag process. Called by SC.Drag.start().
   [Finzer - Concord Consortium] We override to get a previous behavior with regard dragStarted for views
        that are not visible.
   */
  startDrag: function () {
    if (this.get('sourceIsDraggable')) {
      // create the ghost view
      this._createGhostView();
    }

    var evt = this.event;

    // compute the ghost offset from the original start location

    var loc = { x: evt.pageX, y: evt.pageY };
    this.set('location', loc);

    if (this.get('sourceIsDraggable')) {
      var dv = this._getDragView();
      var pv = dv.get('parentView');

      // convert to global coordinates
      var origin = pv ? pv.convertFrameToView(dv.get('frame'), null) : dv.get('frame');

      if (this.get('ghost')) {
        // Hide the dragView
        this._dragViewWasVisible = dv.get('isVisible');
        dv.set('isVisible', NO);
      }

      if (this.ghostActsLikeCursor) this.ghostOffset = { x: 14, y: 14 };
      else this.ghostOffset = { x: (loc.x - origin.x), y: (loc.y - origin.y) };

      // position the ghost view
      if (!this._ghostViewHidden) this._positionGhostView(evt);

      if (evt.makeTouchResponder) {
        // Should use invokeLater if I can figure it out
        var self = this;
        SC.Timer.schedule({
          target: evt,
          action: function () {
            if (!evt.hasEnded) evt.makeTouchResponder(self, YES);
          },
          interval: 1
        });
      }
      else {
        // notify root responder that a drag is in process
        this.ghostView.rootResponder.dragDidStart(this, evt);
      }
    }

    var source = this.source;
    if (source && source.dragDidBegin) source.dragDidBegin(this, loc);

    // let all drop targets know that a drag has started
    var ary = this._dropTargets();

    for (var idx = 0, len = ary.length; idx < len; idx++) {
      var target = ary[idx];
      // This change to ignore views that are not visible was introduced post SC 1.9.
      // We rely on get dragStarted in the various axis views and there is no easy alternative.
      // If the target is not visible, it is not valid.
      //if (!target.get('isVisibleInWindow')) continue;

      target.tryToPerform('dragStarted', this, evt);
    }
  },

  _findDropTarget: function( iEvent) {
    var tTargets = this._dropTargets(),
        tLoc = { x: iEvent.pageX, y: iEvent.pageY },
        tResult = null;
    tTargets.forEach( function( iTarget) {
      if( (iTarget.constructor === DG.AxisMultiTarget) || (iTarget.get('orientation') === 'vertical2')) {
        var tFrame = iTarget.parentView.convertFrameToView( iTarget.get('frame'), null);
        if( SC.pointInRect( tLoc, tFrame)) {
          tResult = iTarget;
        }
      }
    });
    if( !SC.none( tResult))
      return tResult;
    else
      return sc_super();
  },

  /** @private Called instead of _destroyGhostView if slideBack is YES.
   *  Overridden to get a better destination for the slideBack than SC provides
   * */
  _slideGhostViewBack: function () {
    if( !this.origin)
        sc_super();
    else if (this.ghostView) {
      var slidebackLayout = { top: this.origin.y, left: this.origin.x };

      // Animate the ghost view back to its original position; destroy after.
      this.ghostView.animate(slidebackLayout, 0.5, this, function () {
        this.invokeNext(function() {
          // notify the source that slideback has completed
          var source = this.get('source');
          if (this.get('slideBack') && source && source.dragSlideBackDidEnd)
            source.dragSlideBackDidEnd(this);
          this._endDrag();
        });
      });

    }
    else {
      this._endDrag();
    }
  }
});
