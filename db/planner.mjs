import { getCoord } from './db_util.mjs';

const apiKey = 'XXX';
const BASEURL = 'https://api.geoapify.com/v1';
const BASEURLV2 = 'https://api.geoapify.com/v2';

export async function routing(ids, db) {
  // this returns { is_success: ..., order_ids: [...], response: a GeoJSON object }
  let matrix_api_input = {
    mode: 'drive',
    sources: [],
    targets: [],
  }
  for (const id of ids) {
    const coord_result = getCoord(id, db);
    if (!coord_result.is_success) {
      return { is_success: false, order_ids: [], response: null };
    }
    const waypoint = {
      location: coord_result.coord
    };
    matrix_api_input.sources.push(waypoint);
    matrix_api_input.targets.push(waypoint);
  }
  let optimised = {}; // start: ..., end: ..., order: [1, 2, ..]
  let ok = true;
  try {
    const matrix_res = await fetch(`${BASEURL}/routematrix?apiKey=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matrix_api_input),
    });
    const response = await matrix_res.json();
    if (matrix_res.status !== 200) {
      ok = false;
    } else {
      const optimised_raw = optimiseWaypoint(response);
      if (!optimised_raw.is_success) {
        ok = false;
      }
      optimised.start = optimised_raw.start;
      optimised.end = optimised_raw.end;
      optimised.order = optimised_raw.order;
    }
  } catch (err) {
    console.log(err.message);
    ok = false;
  }
  if (!ok) {
    return { is_success: false, order_ids: [], response: null }; // this should be 500 server error
  }
  let waypoints = [];
  let waypoint_ids = []; // place id of each waypoint sent to the routing api
  for (const i of optimised.order) {
    const coordinate = matrix_api_input.sources[i].location; // [lon, lat]
    waypoints.push(`${coordinate[1].toString()},${coordinate[0].toString()}`); // routing api takes lat,lon
    waypoint_ids.push(ids[i]);
  }
  // optimize_stops=true is rejected by the api in transit mode (400: does not support multimodal costing)
  // transit fails with "No path could be found" when there is no service (e.g. at night), so walk is the fallback
  const modes = ['transit', 'drive', 'walk'];
  let api_response = undefined; // geojson object from api
  let status = 200;
  for (const mode of modes) {
    const route_api = `${BASEURL}/routing?apiKey=${apiKey}&waypoints=${waypoints.join('|')}&mode=${mode}`;
    try {
      const route_res = await fetch(route_api, {
        method: 'GET',
      });
      api_response = await route_res.json();
      status = route_res.status;
    } catch (err) {
      console.log(err.message);
      status = 500;
    }
    if (status === 200) {
      break;
    }
    console.log(`routing (${mode}) failed: ${api_response ? api_response.message : status}`);
  }
  if (status !== 200) {
    return { is_success: false, order_ids: [], response: null };
  }
  // the routing api may reorder the stops, its order has the highest priority
  let order_ids = [];
  for (const waypoint of api_response.features[0].properties.waypoints) {
    order_ids.push(waypoint_ids[waypoint.original_index]);
  }
  return { is_success: true, order_ids: order_ids, response: api_response };
}

function pm(arr, k, result_ref) {
  // heap method to generate permutation
  if (k == arr.length) {
    return result_ref.push(arr.slice());
  }
  for (let i = k; i < arr.length; i++) {
    [arr[k], arr[i]] = [arr[i], arr[k]];
    pm(arr, k + 1, result_ref);
    [arr[k], arr[i]] = [arr[i], arr[k]];
  }
}

export function optimiseWaypoint(input, { start, end } = { undefined, undefined }) {
  const n = input.sources.length;
  const rows = input.sources_to_targets;
  const cost = Array.from({ length: n }, () => Array(n).fill(null));
  const distance = Array.from({ length: n }, () => Array(n).fill(null));
  for (const row of rows) {
    for (const point of row) {
      cost[point.source_index][point.target_index] = point.time;
      distance[point.source_index][point.target_index] = point.distance;
    }
  }

  const permutations = [];
  pm([...Array(n).keys()], 0, permutations);

  let best = null;
  for (const p of permutations) {
    if (start && p[0] !== start) continue;
    if (end && p[n - 1] !== end) continue;

    let total = 0;
    let ok = true;
    for (let i = 0; i < n - 1; i++) {
      const c = cost[p[i]][p[i + 1]];
      if (c == null) {
        // unreachable
        ok = false;
        break;
      }
      total += c;
    }
    if (ok && (best === null || total < best.total)) {
      best = { order: p, total };
    }
  }
  if (!best) {
    return {
      is_success: false,
      message: 'No routable order found.',
      order: [], // [1, 0, 2, 3, ...]
      start: undefined,
      end: undefined,
      locations: [],
    }
  }
  const { order } = best;
  const route = order.slice(0, -1).map((from, i) => ({
      from,
      to: order[i + 1],
      time: cost[from][order[i + 1]],
      distance: distance[from][order[i + 1]],
    }));

  return {
    is_success: true,
    order, // [1, 0, 2, 3, ...]
    start: order[0],
    end: order[n - 1],
    locations: order.map(i => input.sources[i].location),
    // total_time: branch.reduce((s, l) => s + l.time, 0),
    // total_distance: branch.reduce((s, l) => s + l.distance, 0),
    route,
  };
}
