import { getSelectedOperation } from '../../selectedOp';
import { clearAllLinks } from '../../ui/operation';
import wX from '../../wX';
import { AutoDraw } from './tools';

import { WasabeeMarker } from '../../model';

import { displayError, displayInfo } from '../../error';
import { greatCircleArcIntersectByLatLngs } from '../../geo';
import { getAllPortalsOnScreen } from '../../ui/portal';
import { selectAngleInterval, sortPortalsByAngle } from './algorithm';

function fastFan(anchor, two, three, portalsSorted, offset, revSortAngle) {
  const res = [];
  const inserted = [two, three];
  if (revSortAngle.get(two.id) > revSortAngle.get(three.id)) inserted.reverse();
  for (let i = offset; i < portalsSorted.length; i++) {
    const p = portalsSorted[i];
    if (!revSortAngle.has(p.id)) continue;
    let prev = inserted.length - 1;
    let next = 0;
    while (
      prev >= 0 &&
      revSortAngle.get(inserted[prev].id) > revSortAngle.get(p.id)
    )
      prev--;
    while (
      next < inserted.length &&
      revSortAngle.get(inserted[next].id) < revSortAngle.get(p.id)
    )
      next++;
    if (
      !greatCircleArcIntersectByLatLngs(
        anchor,
        p,
        inserted[prev],
        inserted[next],
      )
    ) {
      res.push([p, inserted[prev], inserted[next]]);
      inserted.splice(prev + 1, 0, p);
    }
  }
  return res;
}

function countAdditionalAnchors(anchor, best, candidatePortals) {
  const sequencePortals = best.steps.map((s) => s[0]);
  const linkedPortals = sequencePortals.concat([best.two, best.three]);
  const linkedIds = new Set(linkedPortals.map((p) => p.id));
  let count = 0;

  for (const a of candidatePortals) {
    if (a.id === anchor.id) continue;
    if (linkedIds.has(a.id)) continue;

    let match = true;

    // check distance order
    for (const [p, p1, p2] of best.steps) {
      if (
        window.map.distance(a.latLng, p.latLng) >
          window.map.distance(a.latLng, p1.latLng) ||
        window.map.distance(a.latLng, p.latLng) >
          window.map.distance(a.latLng, p2.latLng)
      ) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    // check angle order
    const sortedAngle = sortPortalsByAngle(a, linkedPortals);
    const interval = selectAngleInterval(a, sortedAngle, best.two, best.three);
    if (interval.length !== linkedPortals.length) continue;

    const angleSort = interval.map((p) => p.id);
    let i = 0,
      j = 0;
    while (i < angleSort.length && j < best.angleSort.length) {
      if (best.angleSort[j] === angleSort[i]) i++;
      j++;
    }
    match = i === angleSort.length;

    if (match) count++;
  }

  return count;
}

const FlipFlopPlusDialog = AutoDraw.extend({
  statics: {
    TYPE: 'flipflopPlusDialog',
  },

  initialize: function (options) {
    AutoDraw.prototype.initialize.call(this, options);
  },

  addHooks: function () {
    AutoDraw.prototype.addHooks.call(this);
    this._displayDialog();
    this._updatePortalSet();
  },

  _buildContent: function () {
    const container = L.DomUtil.create('div', 'container');
    const description = L.DomUtil.create('div', 'desc', container);
    description.textContent = wX('FLIP_FLOP_PLUS_DESC');

    const description2 = L.DomUtil.create('div', 'desc', container);
    description2.textContent = wX('FLIP_FLOP_PLUS_INSTRUCTION');

    this._addSelectSet(wX('AUTODRAW_PORTALS_SET'), 'set', container, 'all');

    L.DomUtil.create('label', null, container).textContent = '#SBUL';
    this._nbSbul = L.DomUtil.create('input', null, container);
    this._nbSbul.type = 'number';
    this._nbSbul.value = 2;
    this._nbSbul.size = 1;
    this._nbSbul.min = 0;
    this._nbSbul.max = 4;

    // Progress display
    this._progressDisplay = L.DomUtil.create('div', 'desc', container);
    this._progressDisplay.textContent = '';

    // Results display
    this._resultsDisplay = L.DomUtil.create('div', 'desc', container);
    this._resultsDisplay.textContent = '';

    // Go button
    const button = L.DomUtil.create('button', 'drawb', container);
    button.textContent = wX('autodraw.common.draw_button');
    L.DomEvent.on(button, 'click', () => {
      this.doFlipFlopPlus();
    });

    return container;
  },

  _displayDialog: function () {
    const container = this._buildContent();

    const buttons = {};
    buttons[wX('CLOSE')] = () => {
      this.closeDialog();
    };
    buttons[wX('CLEAR LINKS')] = () => {
      clearAllLinks(getSelectedOperation());
    };

    this.createDialog({
      title: wX('FLIP_FLOP_PLUS_TITLE'),
      html: container,
      width: 'auto',
      dialogClass: 'flipflop',
      buttons: buttons,
      id: 'flipflopPlus',
    });
  },

  findBestFanForAnchor: function (anchor, portals, maxSteps) {
    const distances = new Map(
      portals.map((p) => [p.id, window.map.distance(p.latLng, anchor.latLng)]),
    );
    const sorted = portals
      .filter((p) => p.id !== anchor.id)
      .sort((a, b) => distances.get(b.id) - distances.get(a.id));

    const sortedAngle = sortPortalsByAngle(anchor, sorted);

    const best = {
      two: null,
      three: null,
      steps: [],
      angleSort: [],
    };

    for (let i = 0; i < sorted.length; i++) {
      const pTwo = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const pThree = sorted[j];
        const interval = selectAngleInterval(anchor, sortedAngle, pTwo, pThree);
        const revAngleSort = new Map(interval.map((p, i) => [p.id, i]));
        const res = fastFan(anchor, pTwo, pThree, sorted, j + 1, revAngleSort);
        if (!best.two || best.steps.length < res.length) {
          best.steps = res;
          best.two = pTwo;
          best.three = pThree;
          best.angleSort = interval.map((p) => p.id);
          if (best.steps.length >= maxSteps) break;
        }
      }
      if (best.steps.length >= maxSteps) break;
    }

    if (best.steps.length > maxSteps)
      best.steps = best.steps.slice(0, maxSteps);

    return best;
  },

  createFanLinks: function (one, two, three, steps, order = 0) {
    this._operation.addLink(two, three, {
      description: 'flipflop origin',
      order: order + 1,
    });
    for (const [p, a, b] of steps) {
      this._operation.addLink(p, a, {
        description: 'flipflop origin',
        order: order + 1,
      });
      this._operation.addLink(p, b, {
        description: 'flipflop origin',
        order: order + 1,
      });
    }

    order++;
    this._operation.addLink(one, two, {
      description: 'flipflop fire',
      order: ++order,
    });
    this._operation.addLink(one, three, {
      description: 'flipflop fire',
      order: ++order,
    });
    for (const s of steps) {
      const p = s[0];
      this._operation.addLink(one, p, {
        description: 'flipflop fire',
        order: ++order,
      });
    }
  },

  doFlipFlopPlus: function () {
    this._operation = getSelectedOperation();
    const portals = this._portalSets['set'].portals;

    if (portals.length < 3) {
      displayError(wX('INVALID REQUEST'));
      return;
    }

    const nbSbul =
      +this._nbSbul.value < 0
        ? 0
        : +this._nbSbul.value > 4
          ? 4
          : +this._nbSbul.value;

    const maxSteps = 8 * (nbSbul + 1) - 2;

    // All portals on screen are candidates for additional anchors
    const allPortals = getAllPortalsOnScreen(this._operation);

    this._progressDisplay.textContent = wX('FLIP_FLOP_PLUS_SEARCHING');

    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      this._runSearch(portals, allPortals, maxSteps);
    }, 50);
  },

  _runSearch: function (portals, allPortals, maxSteps) {
    let bestResult = null;
    let bestAnchorCount = -1;
    let bestAnchor = null;
    let bestAnchors = [];

    for (let idx = 0; idx < portals.length; idx++) {
      const anchor = portals[idx];
      const fan = this.findBestFanForAnchor(anchor, portals, maxSteps);

      if (!fan.two) continue;

      // Only evaluate fans that meet minimum size
      if (fan.steps.length + 2 < maxSteps + 2) {
        // fan is too small if we require full use of SBULs
        // allow it if it has at least some steps
        if (fan.steps.length < 1) continue;
      }

      const anchorCount = countAdditionalAnchors(anchor, fan, allPortals);

      if (anchorCount > bestAnchorCount) {
        bestAnchorCount = anchorCount;
        bestResult = fan;
        bestAnchor = anchor;
      }
    }

    if (!bestResult || !bestResult.two) {
      this._progressDisplay.textContent = '';
      displayError(wX('INVALID REQUEST'));
      return;
    }

    // Find the actual additional anchors for the winning configuration
    const sequencePortals = bestResult.steps.map((s) => s[0]);
    const linkedPortals = sequencePortals.concat([
      bestResult.two,
      bestResult.three,
    ]);

    for (const a of allPortals) {
      if (a.id === bestAnchor.id) continue;
      if (linkedPortals.some((p) => p.id === a.id)) continue;

      let match = true;
      for (const [p, p1, p2] of bestResult.steps) {
        if (
          window.map.distance(a.latLng, p.latLng) >
            window.map.distance(a.latLng, p1.latLng) ||
          window.map.distance(a.latLng, p.latLng) >
            window.map.distance(a.latLng, p2.latLng)
        ) {
          match = false;
          break;
        }
      }
      if (!match) continue;

      const sortedAngle = sortPortalsByAngle(a, linkedPortals);
      const interval = selectAngleInterval(
        a,
        sortedAngle,
        bestResult.two,
        bestResult.three,
      );
      if (interval.length !== linkedPortals.length) continue;

      const angleSort = interval.map((p) => p.id);
      let i = 0,
        j = 0;
      while (i < angleSort.length && j < bestResult.angleSort.length) {
        if (bestResult.angleSort[j] === angleSort[i]) i++;
        j++;
      }
      if (i === angleSort.length) bestAnchors.push(a);
    }

    // Draw the fan
    this._operation.startBatchMode();
    this.createFanLinks(
      bestAnchor,
      bestResult.two,
      bestResult.three,
      bestResult.steps,
      this._operation.nextOrder - 1,
    );

    // Mark the primary anchor
    this._operation.addMarker(
      WasabeeMarker.constants.MARKER_TYPE_LINK,
      bestAnchor,
      { comment: 'flipflop primary anchor' },
    );

    // Mark additional anchors
    for (const a of bestAnchors) {
      this._operation.addMarker(WasabeeMarker.constants.MARKER_TYPE_LINK, a, {
        comment: 'flipflop anchor',
      });
    }

    this._operation.endBatchMode();

    const totalLinks = bestResult.steps.length + 2;
    this._progressDisplay.textContent = '';
    this._resultsDisplay.textContent = wX('FLIP_FLOP_PLUS_RESULT', {
      links: totalLinks,
      anchors: bestAnchors.length + 1,
    });
    displayInfo(
      wX('FLIP_FLOP_PLUS_RESULT', {
        links: totalLinks,
        anchors: bestAnchors.length + 1,
      }),
    );
  },
});

export default FlipFlopPlusDialog;
