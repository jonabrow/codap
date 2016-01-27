// ==========================================================================
//                            DG.MapModel
//
//  Author:   William Finzer
//
//  Copyright ©2014 Concord Consortium
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

sc_require('components/graph_map_common/data_display_model');

/** @class  DG.MapModel - The model for a map.

 @extends DG.DataDisplayModel
 */
DG.MapModel = DG.DataDisplayModel.extend(
  /** @scope DG.MapModel.prototype */
  {
    /**
     * These two properties are from the Leaflet Map and are kept in synch for save and restore
     * by my view.
     */
    center: null,
    zoom: null,

    /**
     * This is the name of the layer used as an argument to L.esri.basemapLayer
     * {@property String}
     */
    baseMapLayerName: null,

    /**
     * Reflects (and determines) whether the mapPointView subview is showing
     * {@property Boolean}
     */
    pointsShouldBeVisible: true,

    /**
     * Reflects (and determines) whether the points are to be connected by lines
     * {@property Boolean}
     */
    linesShouldBeVisible: false,

    /**
     * {@property DG.MapGridModel}
     */
    gridModel: null,

    areaColor: DG.PlotUtilities.kMapAreaNoLegendColor,
    areaTransparency: DG.PlotUtilities.kDefaultMapFillOpacity,
    areaStrokeColor: DG.PlotUtilities.kDefaultMapStrokeColor,
    areaStrokeTransparency: DG.PlotUtilities.kDefaultMapStrokeOpacity,

    /**
     * @property {DG.ConnectingLineModel}
     */
    connectingLineModel: null,

    /**
     * Set to true during restore as flag to use to know whether to fit bounds or not
     */
    centerAndZoomBeingRestored: false,

    dataConfigurationClass: function() {
      return DG.MapDataConfiguration;
    }.property(),

    caseValueAnimator: null,  // Used to animate points back to start

    latVarID: function() {
      return this.getPath('dataConfiguration.latAttributeID');
    }.property('*dataConfiguration.latAttributeID'),

    longVarID: function() {
      return this.getPath('dataConfiguration.longAttributeID');
    }.property('dataConfiguration.longAttributeID'),

    areaVarID: function() {
      return this.getPath('dataConfiguration.areaAttributeDescription.attributeID');
    }.property('dataConfiguration.areaAttributeDescription.attributeID'),

    /**
     Prepare dependencies.
     */
    init: function() {
      sc_super();

      // base class doesn't do this because GraphModel has other initialization to do first
      this.invalidate();

      this.set('center', [37.84, -122.10]); // San Francisco
      this.set('zoom', 5);  // Reasonable default
      this.set('baseMapLayerName', 'Topographic');

      this.set('gridModel', DG.MapGridModel.create({ dataConfiguration: this.get('dataConfiguration')}));
      this.set('connectingLineModel', DG.ConnectingLineModel.create( {
        plotModel: this.get('dataConfiguration'),
        sortOnXValues: false,
        isVisible: false
      }));
    },

    handleLegendAttrChange: function() {
      var tLegendAttrDesc = this.getPath('dataConfiguration.legendAttributeDescription');
      if( tLegendAttrDesc) {
        tLegendAttrDesc.set('offsetMinProportion', DG.PlotUtilities.kMapColorRangeOffset);
        tLegendAttrDesc.invalidateCaches();
      }
    }.observes('dataConfiguration.legendAttributeDescription.attribute'),

    handleOneDataContextChange: function( iNotifier, iChange) {
      sc_super();

      var tOperation = iChange && iChange.operation;

      if( tOperation === 'deleteCases')
        this.get('dataConfiguration').synchHiddenCases();
      else if( tOperation == 'deleteAttributes') {
        if( this.getPath('dataConfiguration.legendAttributeDescription.attribute') ===
                iChange.attrs[0].attribute)
          this.removeLegendAttribute();
      }

      // We must invalidate before we build indices because the change may
      // have affected the set of included cases, which affects indices.
      // It would be better not to be dealing with indices at all, but
      // that refactoring is left for another day.
      this.get('dataConfiguration').invalidateCaches( null, iChange);
      iChange.indices = this.buildIndices( iChange);
      this.dataRangeDidChange( this, 'revision', this, iChange.indices);
      this.set('lastChange', iChange);

      var tGridModel = this.get('gridModel');
      if( tGridModel)
        tGridModel.handleDataContextChange( iChange);
    },

    /**
      @param {Number} The index of the case to be selected.
      @param {Boolean} Should the current selection be extended?
    */
    selectCaseByIndex: function( iIndex, iExtend) {
      var tCases = this.get('cases'),
          tCase = tCases[ iIndex],
          tSelection = this.get('selection'),
          tChange = {
            operation: 'selectCases',
            collection: this.get('collectionClient'),
            cases: [ tCase ],
            select: true,
            extend: iExtend
          };

      if( tSelection.get('length') !== 0) {
        if( tSelection.contains( tCase)) {  // Case is already selected
          if( iExtend) {
            tChange.select = false;
          }
          // clicking on a selected case leaves it selected
          else return;
        }
        else {
          tChange.select = true;
        }
      }

      this.get('dataContext').applyChange( tChange);
      if( tChange.select)
        DG.logUser("caseSelected: %@", iIndex);
      else
        DG.logUser("caseDeselected: %@", iIndex);
    },

    hasLatLongAttributes: function() {
      return this.getPath('dataConfiguration.hasLatLongAttributes');
    }.property('dataConfiguration.hasLatLongAttributes').cacheable(),

    /**
     * We can rescale if we have some data to rescale to.
     * @return {Boolean}
     */
    canRescale: function() {
      return this.get('hasLatLongAttributes') || this.getPath('dataConfiguration.hasAreaAttribute');
    }.property('hasNumericAxis', 'plot'),

    /**
     * For now, we'll assume all changes affect us
     * @param iChange
     */
    isAffectedByChange: function( iChange) {
      return true;
    },

    animateSelectionBackToStart: function( iAttrIDs, iDeltas) {
      if( SC.none( this.caseValueAnimator))
        this.caseValueAnimator = DG.CaseValueAnimator.create();
      else  // We must end the animation before setting animator properties
        this.caseValueAnimator.endAnimation();

      this.caseValueAnimator.set( 'dataContext', this.get('dataContext'));
      this.caseValueAnimator.set( 'cases', DG.copy( this.get('selection')));
      this.caseValueAnimator.set( 'attributeIDs', iAttrIDs);
      this.caseValueAnimator.set( 'deltas', iDeltas);

      this.caseValueAnimator.animate();
    },

    _observedDataConfiguration: null,

    checkboxDescriptions: function() {
      var this_ = this,
          tItems = [];
      if( this.get('hasLatLongAttributes')) {
        tItems = tItems.concat([
          {
            title: 'DG.Inspector.mapGrid',
            value: this_.getPath('gridModel.visible'),
            classNames: 'map-grid-check'.w(),
            valueDidChange: function () {
              this_.toggleGrid();
            }.observes('value')
          },
          {
            title: 'DG.Inspector.mapPoints',
            value: this_.get('pointsShouldBeVisible'),
            classNames: 'map-points-check'.w(),
            valueDidChange: function () {
              this_.togglePoints();
            }.observes('value')
          },
          {
            title: 'DG.Inspector.mapLines',
            value: this_.get('linesShouldBeVisible'),
            classNames: 'map-lines-check'.w(),
            valueDidChange: function () {
              this_.toggleLines();
            }.observes('value')
          }
        ]);
      }
      return tItems;
    }.property(),

    toggleGrid: function() {
      var mapModel = this;
      DG.UndoHistory.execute(DG.Command.create({
        name: "map.toggleGrid",
        undoString: 'DG.Undo.map.showGrid',
        redoString: 'DG.Redo.map.showGrid',
        _firstTime: true,
        execute: function() {
          var tGrid = mapModel.get('gridModel');
          tGrid.set('visible', !tGrid.get( 'visible'));
          this.log = 'mapAction: {mapAction: %@ }'.fmt(tGrid.get('visible') ? 'showGrid' : 'hideGrid');
          if (this._firstTime) {
            this._firstTime = false;
            var visible = tGrid.get('visible');
            this.set('name', visible ? 'map.showGrid' : 'map.hideGrid');
            this.set('undoString', visible ? 'DG.Undo.map.showGrid' : 'DG.Undo.map.hideGrid');
            this.set('redoString', visible ? 'DG.Redo.map.showGrid' : 'DG.Redo.map.hideGrid');
          }
        },
        undo: function() {
          this.execute();
        }
      }));
    },

    togglePoints: function() {
      var mapModel = this;
      DG.UndoHistory.execute(DG.Command.create({
        name: "map.togglePoints",
        undoString: 'DG.Undo.map.showPoints',
        redoString: 'DG.Redo.map.showPoints',
        _firstTime: true,
        execute: function() {
          var tPointsVisible = mapModel.get('pointsShouldBeVisible');
          if( tPointsVisible !== false)
            tPointsVisible = true;
          mapModel.set('pointsShouldBeVisible', !tPointsVisible);
          this.log = 'mapAction: {mapAction: %@}'.fmt(mapModel.get('pointsShouldBeVisible') ? 'showPoints' : 'hidePoints');
          if (this._firstTime) {
            this._firstTime = false;
            this.set('name', !tPointsVisible ? 'map.showPoints' : 'map.hidePoints');
            this.set('undoString', !tPointsVisible ? 'DG.Undo.map.showPoints' : 'DG.Undo.map.hidePoints');
            this.set('redoString', !tPointsVisible ? 'DG.Redo.map.showPoints' : 'DG.Redo.map.hidePoints');
          }
        },
        undo: function() {
          this.execute();
        }
      }));
    },

    toggleLines: function() {
      var mapModel = this;
      DG.UndoHistory.execute(DG.Command.create({
        name: "map.toggleLines",
        undoString: 'DG.Undo.map.showLines',
        redoString: 'DG.Redo.map.showLines',
        _firstTime: true,
        execute: function() {
          var tLinesVisible = mapModel.get('linesShouldBeVisible');
          mapModel.set('linesShouldBeVisible', !tLinesVisible);
          mapModel.setPath('connectingLineModel.isVisible', !tLinesVisible);
          this.log = 'mapAction: {mapAction: %@}'.fmt(mapModel.get('linesShouldBeVisible') ? 'showLines' : 'hideLines');
          if (this._firstTime) {
            this._firstTime = false;
            this.set('name', !tLinesVisible ? 'map.showLines' : 'map.hideLines');
            this.set('undoString', !tLinesVisible ? 'DG.Undo.map.showLines' : 'DG.Undo.map.hideLines');
            this.set('redoString', !tLinesVisible ? 'DG.Redo.map.showLines' : 'DG.Redo.map.hideLines');
          }
        },
        undo: function() {
          this.execute();
        }
      }));
    },

    createStorage: function() {
      var tStorage = {};
      tStorage.center = this.get('center');
      tStorage.zoom = this.get('zoom');
      tStorage.baseMapLayerName = this.get('baseMapLayerName');
      var tPointsVisible = this.get('pointsShouldBeVisible');
      if( tPointsVisible !== null)
        tStorage.pointsShouldBeVisible = tPointsVisible;
      tStorage.linesShouldBeVisible = this.get('linesShouldBeVisible');
      tStorage.grid = this.get('gridModel').createStorage();

      tStorage.areaColor = this.get('areaColor');
      tStorage.areaTransparency = this.get('areaTransparency');
      tStorage.areaStrokeColor = this.get('areaStrokeColor');
      tStorage.areaStrokeTransparency = this.get('areaStrokeTransparency');

      return tStorage;
    },

    restoreStorage: function( iStorage) {
      sc_super();

      var tLegendAttrRef = this.instantiateAttributeRefFromStorage(iStorage, 'legendColl', 'legendAttr'),
          tDataConfig = this.get('dataConfiguration');
      tDataConfig.setAttributeAndCollectionClient('legendAttributeDescription', tLegendAttrRef,
          iStorage.legendRole, iStorage.legendAttributeType);

      if( iStorage.mapModelStorage) {
        this.set('center', iStorage.mapModelStorage.center);
        this.set('zoom', iStorage.mapModelStorage.zoom);
        this.set('baseMapLayerName', iStorage.mapModelStorage.baseMapLayerName);
        this.set('centerAndZoomBeingRestored', true);
        if( !SC.none( iStorage.mapModelStorage.pointsShouldBeVisible))
          this.set('pointsShouldBeVisible', iStorage.mapModelStorage.pointsShouldBeVisible);
        if( !SC.none( iStorage.mapModelStorage.linesShouldBeVisible))
          this.set('linesShouldBeVisible', iStorage.mapModelStorage.linesShouldBeVisible);

        if( iStorage.mapModelStorage.areaColor)
          this.set('areaColor', iStorage.mapModelStorage.areaColor);
        if( iStorage.mapModelStorage.areaTransparency)
          this.set('areaTransparency', iStorage.mapModelStorage.areaTransparency);
        if( iStorage.mapModelStorage.areaStrokeColor)
          this.set('areaStrokeColor', iStorage.mapModelStorage.areaStrokeColor);
        if( iStorage.mapModelStorage.areaStrokeTransparency)
          this.set('areaStrokeTransparency', iStorage.mapModelStorage.areaStrokeTransparency);

        this.get('gridModel').restoreStorage( iStorage.mapModelStorage.grid);
      }
    }

  } );

