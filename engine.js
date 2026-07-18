/**
 * engine.js — SAT-Graph temporal resolution engine (single source of truth).
 *
 * Loaded by index.html via <script src="engine.js"> (browser globals) and by
 * test_engine.js via require() (CommonJS), so the CI exercises exactly the
 * code the viewer executes.
 *
 * Temporal contract (part of the API, applied BEFORE retrieval; authority
 * resolution is a separate post-retrieval policy layer):
 *  - Canonical form of `at`: RFC 3339 timestamp WITH an explicit UTC offset
 *    ('Z' or ±hh:mm). Offset-less date-times (e.g. '2019-11-07T00:00:00')
 *    are REJECTED: ECMAScript parses them as local time, which would make
 *    resolution environment-dependent.
 *  - Shorthand: a date-only value 'YYYY-MM-DD' is normalized to T00:00:00Z.
 *    This is a documented convention of this corpus, whose interval
 *    boundaries are normalized to UTC-day precision — not a claim that legal
 *    effectiveness universally begins at UTC midnight. Corpora with other
 *    conventions should declare them in dataset metadata (e.g.
 *    temporalGranularity / normalizationTimeZone).
 *  - validityInterval is half-open [start, end): a Version is valid at
 *    instant t iff start <= t < end; end === null means open-ended. A Version
 *    and its directly superseding successor are never simultaneously active
 *    at the transition instant; concurrent Versions remain possible where the
 *    graph explicitly represents overlays or interpretive branches.
 *  - getValidVersions result order is NOT part of the contract: compare as a
 *    set. getItemHistory is ordered by (eventTime, id); the id tiebreak makes
 *    the ordering deterministic even when two Actions share an eventTime.
 */

'use strict';

var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
var OFFSET_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRealCalendarDate(value) {
  // ECMAScript rolls impossible calendar dates over (2019-02-30 -> Mar 2)
  // instead of invalidating them, so the NaN check alone is insufficient.
  var y = +value.slice(0, 4), m = +value.slice(5, 7), d = +value.slice(8, 10);
  if (m < 1 || m > 12 || d < 1) return false;
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= dim[m - 1];
}

function parseQueryInstant(value) {
  var parsed;
  if (!isRealCalendarDate(String(value))) {
    throw new TypeError('Impossible calendar date: ' + value);
  }
  if (DATE_ONLY.test(value)) {
    parsed = new Date(value + 'T00:00:00Z');
  } else if (OFFSET_TIMESTAMP.test(value)) {
    parsed = new Date(value);
  } else {
    throw new TypeError(
      'Invalid temporal input: "' + value + '". Use YYYY-MM-DD or an ' +
      'RFC 3339 timestamp with an explicit offset (Z or ±hh:mm).');
  }
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError('Invalid ISO date or timestamp: ' + value);
  }
  return parsed;
}

/**
 * getValidVersions — implements GET /items/{itemId}/valid-versions?at={instant}
 * Returns every Version of the Item whose half-open validityInterval
 * [start, end) contains the query instant.
 */
function getValidVersions(itemId, at, dataset) {
  var instant = parseQueryInstant(at);
  return dataset.versions.filter(function (v) {
    if (v.itemId !== itemId) return false;
    var start = new Date(v.validityInterval[0]);
    var end = v.validityInterval[1] ? new Date(v.validityInterval[1]) : null;
    return instant >= start && (end === null || instant < end);
  });
}

/**
 * getItemHistory — implements GET /items/{itemId}/history
 * Returns Actions that produced or terminated Versions of this Item,
 * ordered by (eventTime, id).
 */
function getItemHistory(itemId, dataset) {
  var vids = new Set(
    dataset.versions.filter(function (v) { return v.itemId === itemId; })
      .map(function (v) { return v.id; })
  );
  return dataset.actions
    .filter(function (a) {
      return (a.producesVersionIds || []).some(function (id) { return vids.has(id); }) ||
             (a.terminatesVersionIds || []).some(function (id) { return vids.has(id); });
    })
    .sort(function (a, b) {
      return (new Date(a.eventTime) - new Date(b.eventTime)) ||
             (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseQueryInstant: parseQueryInstant,
    getValidVersions: getValidVersions,
    getItemHistory: getItemHistory
  };
}
